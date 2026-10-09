//go:build integration

package filtering

import (
	"net/netip"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSmartDNS_LocalDatabases(t *testing.T) {
	lookup, err := newRegionLookup(SmartDNSConfig{}, filepath.Join("..", "..", "data"))
	require.NoError(t, err)
	t.Cleanup(lookup.Close)
	tests := []struct {
		ip   string
		want RewriteRegion
	}{
		{ip: "223.5.5.5", want: RewriteRegion{Country: "中国", Province: "浙江", City: "杭州", ISP: "阿里"}},
		{ip: "240e:3b7:3272:d8d0:db09:c067:8d59:539e", want: RewriteRegion{
			Country: "中国", Province: "广东", City: "深圳", District: "宝安", ISP: "电信",
		}},
	}
	for _, tc := range tests {
		t.Run(tc.ip, func(t *testing.T) {
			t.Parallel()
			raw, err := lookup.Search(netip.MustParseAddr(tc.ip).AsSlice())
			require.NoError(t, err)
			assert.Equal(t, tc.want, parseClientRegion(raw))
		})
	}
}
