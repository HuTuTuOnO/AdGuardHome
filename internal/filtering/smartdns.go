package filtering

import (
	"cmp"
	"context"
	"fmt"
	"math/bits"
	"math/rand/v2"
	"net/netip"
	"path/filepath"
	"strings"

	"github.com/AdguardTeam/golibs/logutil/slogutil"
	"github.com/lionsoul2014/ip2region/binding/golang/service"
)

// RewriteRegion contains optional, exact-match client location conditions.
// Empty fields match any value. All populated fields must match.
type RewriteRegion struct {
	Country  string `yaml:"country,omitempty" json:"country,omitempty"`
	Province string `yaml:"province,omitempty" json:"province,omitempty"`
	City     string `yaml:"city,omitempty" json:"city,omitempty"`
	District string `yaml:"district,omitempty" json:"district,omitempty"`
	ISP      string `yaml:"isp,omitempty" json:"isp,omitempty"`
}

func (r RewriteRegion) fields() (fields [5]string) {
	return [5]string{r.Country, r.Province, r.City, r.District, r.ISP}
}

func (r RewriteRegion) normalized() (out RewriteRegion) {
	f := r.fields()
	for i, value := range f {
		f[i] = strings.TrimSpace(value)
	}
	return RewriteRegion{Country: f[0], Province: f[1], City: f[2], District: f[3], ISP: f[4]}
}

// rank first compares the number of matched fields, then their presence in
// country > province > city > district > isp order. A mismatch excludes a rule.
func (r RewriteRegion) rank(client RewriteRegion) (rank int, matches bool) {
	f := client.fields()
	mask := uint(0)
	for i, value := range r.fields() {
		if value == "" {
			continue
		}
		if !strings.EqualFold(value, f[i]) {
			return 0, false
		}
		mask |= 1 << (4 - i)
	}
	return bits.OnesCount(mask)*32 + int(mask), true
}

// SmartDNSConfig configures the local IPv4 and IPv6 ip2region databases.
// Relative paths are resolved from the AdGuard Home data directory.
type SmartDNSConfig struct {
	IPv4DB  string `yaml:"ipv4_db,omitempty" json:"ipv4_db,omitempty"`
	IPv6DB  string `yaml:"ipv6_db,omitempty" json:"ipv6_db,omitempty"`
	Enabled bool   `yaml:"enabled" json:"enabled"`
}

type regionLookup interface {
	Search(ip any) (string, error)
	Close()
}

func (d *DNSFilter) newRegionLookup() (lookup regionLookup, err error) {
	conf := d.conf.SmartDNS
	return newRegionLookup(conf, d.conf.DataDir)
}

func newRegionLookup(conf SmartDNSConfig, dataDir string) (lookup regionLookup, err error) {
	path := func(configured, defaultName string) string {
		configured = cmp.Or(configured, defaultName)
		if filepath.IsAbs(configured) {
			return configured
		}
		return filepath.Join(dataDir, configured)
	}
	v4, err := service.NewV4Config(service.VIndexCache, path(conf.IPv4DB, "ip2region_v4.xdb"), 20)
	if err != nil {
		return nil, fmt.Errorf("opening ipv4 database: %w", err)
	}
	v6, err := service.NewV6Config(service.VIndexCache, path(conf.IPv6DB, "ip2region_v6.xdb"), 20)
	if err != nil {
		return nil, fmt.Errorf("opening ipv6 database: %w", err)
	}
	return service.NewIp2Region(v4, v6)
}

func parseClientRegion(raw string) (region RewriteRegion) {
	f := strings.Split(raw, "|")
	// Extended databases: continent|country|province|city|district|isp|...
	// Standard ip2region databases: country|area|province|city|isp.
	switch {
	case len(f) >= 6:
		region = RewriteRegion{Country: f[1], Province: f[2], City: f[3], District: f[4], ISP: f[5]}
	case len(f) == 5:
		region = RewriteRegion{Country: f[0], Province: f[2], City: f[3], ISP: f[4]}
	default:
		return RewriteRegion{}
	}
	clean := func(s string) string {
		s = strings.TrimSpace(s)
		if s == "0" || s == "保留" {
			return ""
		}
		return s
	}
	return RewriteRegion{
		Country: clean(region.Country), Province: clean(region.Province),
		City: clean(region.City), District: clean(region.District), ISP: clean(region.ISP),
	}
}

func (d *DNSFilter) processClientRewrites(host string, qtype uint16, clientIP netip.Addr) (res Result) {
	d.confMu.RLock()
	defer d.confMu.RUnlock()
	if !d.conf.RewritesEnabled {
		return Result{}
	}
	ctx := context.TODO()
	entries := make([]*LegacyRewrite, 0, len(d.conf.Rewrites))
	if !d.conf.SmartDNS.Enabled {
		// Region-bound rules must never become global when smart DNS is off.
		for _, rw := range d.conf.Rewrites {
			if rw.RewriteRegion == (RewriteRegion{}) {
				entries = append(entries, rw)
			}
		}
		return d.processRewriteEntries(ctx, entries, host, qtype)
	}
	hasDomain := false
	for _, rw := range d.conf.Rewrites {
		if rw.Enabled && (rw.Domain == host || matchDomainWildcard(host, rw.Domain)) {
			hasDomain = true
			break
		}
	}
	if !hasDomain {
		return Result{}
	}
	region := RewriteRegion{}
	if d.regionLookup != nil && clientIP.IsValid() {
		raw, err := d.regionLookup.Search(clientIP.Unmap().AsSlice())
		if err != nil {
			d.logger.DebugContext(ctx, "client region lookup failed", slogutil.KeyError, err)
		} else {
			region = parseClientRegion(raw)
		}
	}
	// Restrict every link of a CNAME chain to this client's matching rules.
	for _, rw := range d.conf.Rewrites {
		if _, matches := rw.RewriteRegion.rank(region); matches {
			entries = append(entries, rw)
		}
	}
	find := func(name string) ([]*LegacyRewrite, bool) {
		return selectSmartRewrites(entries, name, qtype, region, rand.Uint64N)
	}
	rewrites, matched := find(host)
	if !matched {
		return Result{}
	}
	res.Reason = Rewritten
	return d.handleRewriteLoop(ctx, host, qtype, rewrites, matched, &res, find)
}

// selectSmartRewrites preserves exact-domain and most-specific wildcard
// precedence, then ranks region conditions, priority, and weighted selection.
func selectSmartRewrites(
	entries []*LegacyRewrite,
	host string,
	qtype uint16,
	region RewriteRegion,
	draw func(uint64) uint64,
) (selected []*LegacyRewrite, matched bool) {
	candidates := make([]*LegacyRewrite, 0, len(entries))
	bestDomain, bestRegion := -1, -1
	var bestPriority int32
	for _, rw := range entries {
		if !rw.Enabled || (rw.Domain != host && !matchDomainWildcard(host, rw.Domain)) {
			continue
		}
		rank, matches := rw.RewriteRegion.rank(region)
		if !matches {
			continue
		}
		matched = true
		if !rw.matchesQType(qtype) {
			continue
		}
		domainRank := len(rw.Domain)
		if !isWildcard(rw.Domain) {
			domainRank = int(^uint(0) >> 1)
		}
		betterDomain := domainRank > bestDomain
		betterRegion := domainRank == bestDomain && rank > bestRegion
		betterPriority := domainRank == bestDomain && rank == bestRegion && rw.Priority > bestPriority
		if betterDomain || betterRegion || betterPriority {
			candidates = candidates[:0]
			bestDomain, bestRegion, bestPriority = domainRank, rank, rw.Priority
		}
		if domainRank == bestDomain && rank == bestRegion && rw.Priority == bestPriority {
			candidates = append(candidates, rw)
		}
	}
	if len(candidates) == 0 {
		return nil, matched
	}
	var total uint64
	for _, rw := range candidates {
		total += uint64(cmp.Or(rw.Weight, 1))
	}
	choice := draw(total)
	for _, rw := range candidates {
		weight := uint64(cmp.Or(rw.Weight, 1))
		if choice < weight {
			return []*LegacyRewrite{rw}, true
		}
		choice -= weight
	}
	return nil, matched
}
