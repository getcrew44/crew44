package relay

import (
	"net"
	"net/http"
	"os"
	"strings"
)

const trustProxyHeadersEnv = "TRUST_PROXY_HEADERS"

func requestRemoteAddr(r *http.Request) string {
	if trustedProxyHeaders(os.Getenv(trustProxyHeadersEnv), r.RemoteAddr) {
		if ip := firstHeaderIP(r.Header.Get("X-Forwarded-For")); ip != "" {
			return ip
		}
		if ip := firstHeaderIP(r.Header.Get("X-Real-IP")); ip != "" {
			return ip
		}
	}
	return r.RemoteAddr
}

func trustedProxyHeaders(value, remoteAddr string) bool {
	value = strings.TrimSpace(value)
	if value == "" || value == "*" {
		return true
	}
	switch strings.ToLower(value) {
	case "0", "false", "no", "off":
		return false
	case "1", "true", "yes", "on":
		return true
	}

	remoteIP := hostIP(remoteAddr)
	if remoteIP == nil {
		return false
	}
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if part == "*" {
			return true
		}
		if _, network, err := net.ParseCIDR(part); err == nil {
			if network.Contains(remoteIP) {
				return true
			}
			continue
		}
		if trustedIP := net.ParseIP(part); trustedIP != nil && trustedIP.Equal(remoteIP) {
			return true
		}
	}
	return false
}

func firstHeaderIP(value string) string {
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if ip := hostIP(part); ip != nil {
			return ip.String()
		}
	}
	return ""
}

func hostIP(value string) net.IP {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	return net.ParseIP(strings.Trim(value, "[]"))
}
