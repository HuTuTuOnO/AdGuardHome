package filtering

import (
	"errors"
	"net/netip"
	"testing"

	"github.com/miekg/dns"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testRegionLookup struct {
	raw string
	err error
}

func (l *testRegionLookup) Search(any) (string, error) { return l.raw, l.err }
func (*testRegionLookup) Close()                       {}

func TestParseClientRegion(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		raw  string
		want RewriteRegion
	}{
		{name: "extended", raw: "亚洲|中国|广东|深圳|宝安|电信|113.8|22.5", want: RewriteRegion{
			Country: "中国", Province: "广东", City: "深圳", District: "宝安", ISP: "电信",
		}},
		{name: "standard", raw: "中国|0|广东|深圳|电信", want: RewriteRegion{
			Country: "中国", Province: "广东", City: "深圳", ISP: "电信",
		}},
		{name: "unknown", raw: "保留|保留|保留|保留|||||"},
		{name: "empty", raw: ""},
		{name: "malformed", raw: "中国|广东"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, parseClientRegion(tc.raw))
		})
	}
}

func TestSelectSmartRewrites(t *testing.T) {
	t.Parallel()
	client := RewriteRegion{Country: "中国", Province: "北京", City: "北京", District: "海淀", ISP: "电信"}
	base := &LegacyRewrite{
		Domain: "example.org", Answer: "192.0.2.1", Type: dns.TypeA,
		IP: netip.MustParseAddr("192.0.2.1"), Enabled: true,
	}
	makeRule := func(region RewriteRegion, priority int32, weight uint32) *LegacyRewrite {
		rw := *base
		rw.RewriteRegion, rw.Priority, rw.Weight = region, priority, weight
		return &rw
	}
	full := makeRule(RewriteRegion{Country: "中国", Province: "北京", ISP: "电信"}, -100, 1)
	province := makeRule(RewriteRegion{Country: "中国", Province: "北京"}, -10, 1)
	isp := makeRule(RewriteRegion{Country: "中国", ISP: "电信"}, 100, 1)
	city := makeRule(RewriteRegion{City: "北京", District: "海淀", ISP: "电信"}, 100, 1)
	wrong := makeRule(RewriteRegion{Country: "中国", Province: "广东"}, 1000, 1)
	heavy := makeRule(province.RewriteRegion, province.Priority, 3)
	higher := makeRule(province.RewriteRegion, 1, 1)
	wildcard := makeRule(full.RewriteRegion, 1000, 1)
	wildcard.Domain = "*.org"
	specificWildcard := *wildcard
	specificWildcard.Domain = "*.example.org"
	wrongType := *full
	wrongType.Type = dns.TypeAAAA
	wrongType.IP = netip.MustParseAddr("2001:db8::1")
	tests := []struct {
		name  string
		rules []*LegacyRewrite
		draw  uint64
		want  *LegacyRewrite
	}{
		{name: "field_count_before_priority", rules: []*LegacyRewrite{isp, province, full}, want: full},
		{name: "province_before_isp", rules: []*LegacyRewrite{isp, province}, want: province},
		{name: "country_before_city", rules: []*LegacyRewrite{city, full}, want: full},
		{name: "all_fields_must_match", rules: []*LegacyRewrite{wrong, isp}, want: isp},
		{name: "priority_after_region", rules: []*LegacyRewrite{province, higher}, want: higher},
		{name: "weight_first_boundary", rules: []*LegacyRewrite{province, heavy}, draw: 0, want: province},
		{name: "weight_second_boundary", rules: []*LegacyRewrite{province, heavy}, draw: 1, want: heavy},
		{name: "weight_last_boundary", rules: []*LegacyRewrite{province, heavy}, draw: 3, want: heavy},
		{name: "fallback", rules: []*LegacyRewrite{wrong, base}, want: base},
		{name: "no_match", rules: []*LegacyRewrite{wrong}},
		{name: "exact_before_regional_wildcard", rules: []*LegacyRewrite{wildcard, base}, want: base},
		{name: "record_type_before_region", rules: []*LegacyRewrite{&wrongType, base}, want: base},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, matched := selectSmartRewrites(tc.rules, "example.org", dns.TypeA, client, func(n uint64) uint64 {
				require.Less(t, tc.draw, n)
				return tc.draw
			})
			if tc.want == nil {
				assert.False(t, matched)
				assert.Empty(t, got)
				return
			}
			require.True(t, matched)
			require.Len(t, got, 1)
			assert.Same(t, tc.want, got[0])
		})
	}
	// Deterministically exhaust the draw range: weights 1:3 yield exactly 1:3.
	counts := map[*LegacyRewrite]int{}
	for i := uint64(0); i < 4; i++ {
		got, _ := selectSmartRewrites([]*LegacyRewrite{province, heavy}, "example.org", dns.TypeA, client,
			func(uint64) uint64 { return i })
		counts[got[0]]++
	}
	assert.Equal(t, 1, counts[province])
	assert.Equal(t, 3, counts[heavy])
	got, matched := selectSmartRewrites([]*LegacyRewrite{wildcard, &specificWildcard},
		"node.example.org", dns.TypeA, client, func(uint64) uint64 { return 0 })
	require.True(t, matched)
	require.Len(t, got, 1)
	assert.Same(t, &specificWildcard, got[0])
	got, matched = selectSmartRewrites([]*LegacyRewrite{base},
		"example.org", dns.TypeAAAA, client, func(uint64) uint64 {
			t.Fatal("must not draw from empty candidates")
			return 0
		})
	assert.True(t, matched)
	assert.Empty(t, got)
}

func TestDNSFilter_CheckHost_smartDNS(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		enabled bool
		raw     string
		err     error
		want    string
	}{
		{name: "regional", enabled: true, raw: "亚洲|中国|北京|北京|海淀|电信|", want: "192.0.2.2"},
		{name: "other_region", enabled: true, raw: "亚洲|中国|广东|深圳|宝安|电信|", want: "192.0.2.1"},
		{name: "unknown", enabled: true, want: "192.0.2.1"},
		{name: "lookup_error", enabled: true, err: errors.New("read failed"), want: "192.0.2.1"},
		{name: "disabled_ignores_regional", want: "192.0.2.1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			d, settings := newForTest(t, nil, nil)
			t.Cleanup(d.Close)
			d.conf.SmartDNS.Enabled = tc.enabled
			d.regionLookup = &testRegionLookup{raw: tc.raw, err: tc.err}
			d.conf.Rewrites = []*LegacyRewrite{
				{Domain: "example.org", Answer: "192.0.2.1", Enabled: true},
				{Domain: "example.org", Answer: "192.0.2.2", Enabled: true, RewriteRegion: RewriteRegion{Province: "北京"}},
			}
			require.NoError(t, d.prepareRewrites(t.Context()))
			settings.ClientIP = netip.MustParseAddr("114.114.114.114")
			res, err := d.CheckHost("example.org", dns.TypeA, settings)
			require.NoError(t, err)
			assert.Equal(t, Rewritten, res.Reason)
			assert.Equal(t, []netip.Addr{netip.MustParseAddr(tc.want)}, res.IPList)
		})
	}
}

func TestDNSFilter_CheckHost_smartDNS_CNAME(t *testing.T) {
	d, settings := newForTest(t, nil, nil)
	t.Cleanup(d.Close)
	d.conf.SmartDNS.Enabled = true
	d.regionLookup = &testRegionLookup{raw: "亚洲|中国|北京|北京|海淀|电信|"}
	d.conf.Rewrites = []*LegacyRewrite{
		{Domain: "example.org", Answer: "node.example.org", Enabled: true},
		{Domain: "node.example.org", Answer: "192.0.2.1", Enabled: true},
		{Domain: "node.example.org", Answer: "192.0.2.2", Enabled: true, RewriteRegion: RewriteRegion{ISP: "电信"}},
	}
	require.NoError(t, d.prepareRewrites(t.Context()))
	settings.ClientIP = netip.MustParseAddr("114.114.114.114")
	res, err := d.CheckHost("example.org", dns.TypeA, settings)
	require.NoError(t, err)
	assert.Equal(t, "node.example.org", res.CanonName)
	assert.Equal(t, []netip.Addr{netip.MustParseAddr("192.0.2.2")}, res.IPList)
}
