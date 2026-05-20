package relay

import (
	"net/http"
	"testing"
)

func TestRequestRemoteAddrUsesForwardedHeadersByDefault(t *testing.T) {
	t.Setenv(trustProxyHeadersEnv, "*")
	req := &http.Request{
		Header:     http.Header{"X-Forwarded-For": {"203.0.113.10, 10.0.0.8"}, "X-Real-Ip": {"198.51.100.7"}},
		RemoteAddr: "10.0.0.9:4567",
	}

	if got := requestRemoteAddr(req); got != "203.0.113.10" {
		t.Fatalf("remote addr = %q, want first x-forwarded-for IP", got)
	}
}

func TestRequestRemoteAddrUsesRealIPWhenForwardedForMissing(t *testing.T) {
	t.Setenv(trustProxyHeadersEnv, "*")
	req := &http.Request{
		Header:     http.Header{"X-Real-Ip": {"198.51.100.7"}},
		RemoteAddr: "10.0.0.9:4567",
	}

	if got := requestRemoteAddr(req); got != "198.51.100.7" {
		t.Fatalf("remote addr = %q, want x-real-ip", got)
	}
}

func TestTrustedProxyHeadersDefaultsToWildcard(t *testing.T) {
	if !trustedProxyHeaders("", "10.0.0.9:4567") {
		t.Fatal("expected empty trust config to trust proxy headers")
	}
}

func TestRequestRemoteAddrCanDisableProxyHeaders(t *testing.T) {
	t.Setenv(trustProxyHeadersEnv, "false")
	req := &http.Request{
		Header:     http.Header{"X-Forwarded-For": {"203.0.113.10"}},
		RemoteAddr: "10.0.0.9:4567",
	}

	if got := requestRemoteAddr(req); got != "10.0.0.9:4567" {
		t.Fatalf("remote addr = %q, want direct remote addr", got)
	}
}

func TestTrustedProxyHeadersSupportsCIDR(t *testing.T) {
	if !trustedProxyHeaders("10.0.0.0/24", "10.0.0.9:4567") {
		t.Fatal("expected CIDR to trust matching proxy")
	}
	if trustedProxyHeaders("10.0.1.0/24", "10.0.0.9:4567") {
		t.Fatal("expected CIDR to reject non-matching proxy")
	}
}
