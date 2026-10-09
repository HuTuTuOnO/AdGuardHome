//go:build integration

package dnsforward

import (
	"net/netip"
	"path/filepath"
	"testing"

	"github.com/AdguardTeam/AdGuardHome/internal/filtering"
	"github.com/AdguardTeam/dnsproxy/proxy"
	"github.com/AdguardTeam/golibs/logutil/slogutil"
	"github.com/AdguardTeam/golibs/testutil"
	"github.com/miekg/dns"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServer_SmartDNSWithCache(t *testing.T) {
	const domain = "smart.example.org"
	rule := func(answer string, region filtering.RewriteRegion, weight uint32) *filtering.LegacyRewrite {
		return &filtering.LegacyRewrite{
			Domain: domain, Answer: answer, Enabled: true,
			RewriteRegion: region, Weight: weight,
		}
	}
	zhejiang := filtering.RewriteRegion{Country: "中国", Province: "浙江"}
	guangdong := filtering.RewriteRegion{Country: "中国", Province: "广东", ISP: "电信"}
	s := createTestServer(t, &filtering.Config{
		BlockingMode:    filtering.BlockingModeDefault,
		DataDir:         filepath.Join("..", "..", "data"),
		SmartDNS:        filtering.SmartDNSConfig{Enabled: true},
		RewritesEnabled: true,
		Rewrites: []*filtering.LegacyRewrite{
			rule("192.0.2.1", zhejiang, 1),
			rule("192.0.2.2", zhejiang, 3),
			rule("192.0.2.3", guangdong, 1),
			rule("2001:db8::3", guangdong, 1),
			rule("192.0.2.4", filtering.RewriteRegion{}, 1),
		},
	}, ServerConfig{
		TLSConf: &TLSConfig{}, UpstreamMode: proxy.UpstreamModeLoadBalance,
		EDNSClientSubnet: &EDNSClientSubnet{}, ClientsContainer: EmptyClientsContainer{},
		ServePlainDNS: true, CacheEnabled: true, CacheSize: 4096,
	}, testTLSManager)
	ctx := testutil.ContextWithTimeout(t, testTimeout)
	ctx = slogutil.ContextWithLogger(ctx, testLogger)
	t.Cleanup(func() {
		s.Close(ctx)
		s.dnsFilter.Close()
	})
	tests := []struct {
		client string
		qtype  uint16
		want   []string
	}{
		{client: "223.5.5.5", qtype: dns.TypeA, want: []string{"192.0.2.1", "192.0.2.2"}},
		{client: "240e:3b7:3272:d8d0:db09:c067:8d59:539e", qtype: dns.TypeA, want: []string{"192.0.2.3"}},
		{client: "240e:3b7:3272:d8d0:db09:c067:8d59:539e", qtype: dns.TypeAAAA, want: []string{"2001:db8::3"}},
		{client: "127.0.0.1", qtype: dns.TypeA, want: []string{"192.0.2.4"}},
	}
	// Interleave client regions repeatedly with the cache enabled. Rewritten
	// answers must stay specific to each request and contain one address.
	for range 50 {
		for _, tc := range tests {
			pctx := &proxy.DNSContext{
				Proto: proxy.ProtoUDP,
				Req:   createTestMessageWithType(domain+".", tc.qtype),
				Addr:  netip.AddrPortFrom(netip.MustParseAddr(tc.client), 12345),
			}
			err := s.ServeDNS(ctx, s.dnsProxy, pctx)
			require.NoError(t, err)
			require.NotNil(t, pctx.Res)
			require.Len(t, pctx.Res.Answer, 1)
			var answer string
			switch rr := pctx.Res.Answer[0].(type) {
			case *dns.A:
				answer = rr.A.String()
			case *dns.AAAA:
				answer = rr.AAAA.String()
			default:
				t.Fatalf("unexpected answer: %T", rr)
			}
			assert.Contains(t, tc.want, answer, "client %s", tc.client)
		}
	}
}
