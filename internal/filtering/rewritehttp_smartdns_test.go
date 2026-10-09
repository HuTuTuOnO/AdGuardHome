package filtering

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/AdguardTeam/AdGuardHome/internal/aghtest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDNSFilter_RewriteHTTP_smartDNS(t *testing.T) {
	t.Parallel()
	d, _ := newForTest(t, nil, nil)
	t.Cleanup(d.Close)
	d.conf.ConfModifier = &aghtest.ConfigModifier{OnApply: func(_ context.Context) {}}
	call := func(handler http.HandlerFunc, method, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler(w, httptest.NewRequest(method, "/", bytes.NewBufferString(body)))
		return w
	}
	for _, province := range []string{"北京", "广东"} {
		body, err := json.Marshal(map[string]any{
			"domain": "example.org", "answer": "192.0.2.1", "country": "中国",
			"province": province, "priority": 10, "weight": 3,
		})
		require.NoError(t, err)
		w := call(d.handleRewriteAdd, http.MethodPost, string(body))
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	}
	w := call(d.handleRewriteUpdate, http.MethodPut,
		`{"target":{"domain":"example.org","answer":"192.0.2.1","country":"中国","province":"北京"},"update":{"domain":"example.org","answer":"192.0.2.2","country":"中国","province":"北京","priority":20,"weight":8,"enabled":false}}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, "192.0.2.2", d.conf.Rewrites[0].Answer)
	assert.Equal(t, int32(20), d.conf.Rewrites[0].Priority)
	assert.Equal(t, uint32(8), d.conf.Rewrites[0].Weight)
	assert.False(t, d.conf.Rewrites[0].Enabled)
	assert.True(t, d.conf.Rewrites[1].Enabled)
	w = call(d.handleRewriteList, http.MethodGet, "")
	assert.Contains(t, w.Body.String(), `"weight":8`)
	assert.Contains(t, w.Body.String(), `"province":"广东"`)
	var persisted Config
	d.WriteDiskConfig(&persisted)
	assert.Equal(t, d.conf.Rewrites, persisted.Rewrites)
	w = call(d.handleRewriteDelete, http.MethodPost,
		`{"domain":"example.org","answer":"192.0.2.1","country":"中国","province":"广东"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.Len(t, d.conf.Rewrites, 1)
	assert.Equal(t, "北京", d.conf.Rewrites[0].Province)
	// Zero weight and a bad database must leave the active configuration intact.
	w = call(d.handleRewriteAdd, http.MethodPost, `{"domain":"example.org","answer":"192.0.2.3","weight":0}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Len(t, d.conf.Rewrites, 1)
	w = call(d.handleRewriteSettingsUpdate, http.MethodPut,
		`{"enabled":true,"smart_dns":{"enabled":true,"ipv4_db":"/missing/ip2region.xdb"}}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.False(t, d.conf.SmartDNS.Enabled)
}
