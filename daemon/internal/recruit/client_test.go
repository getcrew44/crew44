package recruit

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestParseGitHubRepo(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    repoCoord
		wantErr bool
	}{
		{"https plain", "https://github.com/hex-studio/patch", repoCoord{"hex-studio", "patch"}, false},
		{"with .git suffix", "https://github.com/hex-studio/patch.git", repoCoord{"hex-studio", "patch"}, false},
		{"with trailing slash", "https://github.com/owner/repo/", repoCoord{"owner", "repo"}, false},
		{"wrong host", "https://gitlab.com/owner/repo", repoCoord{}, true},
		{"missing repo", "https://github.com/owner", repoCoord{}, true},
		{"missing owner", "https://github.com/", repoCoord{}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseGitHubRepo(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %s", tc.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestCandidateRefs(t *testing.T) {
	tests := []struct {
		in   string
		want []string
	}{
		{"1.2.0", []string{"v1.2.0", "1.2.0"}},
		{"v0.1.0", []string{"v0.1.0", "0.1.0"}},
		{"  v3 ", []string{"v3", "3"}},
		{"", nil},
	}
	for _, tc := range tests {
		got := candidateRefs(tc.in)
		if len(got) != len(tc.want) {
			t.Fatalf("for %q got %v, want %v", tc.in, got, tc.want)
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Fatalf("for %q got %v, want %v", tc.in, got, tc.want)
			}
		}
	}
}

func TestValidateManifest(t *testing.T) {
	good := Manifest{Name: "X", Version: "1.0.0", Description: "y"}
	if err := validateManifest(&good); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}

	cases := []struct {
		name string
		m    Manifest
	}{
		{"missing name", Manifest{Version: "1", Description: "d"}},
		{"missing version", Manifest{Name: "n", Description: "d"}},
		{"missing description", Manifest{Name: "n", Version: "1"}},
		{"skill missing name", Manifest{Name: "n", Version: "1", Description: "d", Skills: []SkillDecl{{Path: "skills/x/SKILL.md"}}}},
		{"skill missing path", Manifest{Name: "n", Version: "1", Description: "d", Skills: []SkillDecl{{Name: "x"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateManifest(&tc.m); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestEnsureSafePath(t *testing.T) {
	good := []string{"skills/foo/SKILL.md", "a/b/c.md", "x.md"}
	for _, p := range good {
		if err := ensureSafePath(p); err != nil {
			t.Fatalf("good path rejected: %s: %v", p, err)
		}
	}
	bad := []string{"/etc/passwd", "../escape.md", "skills/../../escape.md", ""}
	for _, p := range bad {
		if err := ensureSafePath(p); err == nil {
			t.Fatalf("bad path accepted: %s", p)
		}
	}
}

func TestFetchRegistryCachesAndStaleFallback(t *testing.T) {
	var hits int32
	mux := http.NewServeMux()
	mux.HandleFunc("/getcrew44/agent-registry/HEAD/agents.json", func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n == 2 {
			// Second call: simulate a transient outage so the stale-cache
			// fallback path can be exercised.
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"schema_version":"crew44.agent-registry.v1","agents":[{"id":"a1","name":"Alpha","description":"d","repo_url":"https://github.com/o/r"}]}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := NewClient(Config{RawBase: srv.URL, CacheTTL: 50 * time.Millisecond})

	env1, err := c.FetchRegistry(context.Background())
	if err != nil || len(env1.Agents) != 1 {
		t.Fatalf("first fetch failed: %v env=%+v", err, env1)
	}
	// Cached fetch — no network hit.
	env2, err := c.FetchRegistry(context.Background())
	if err != nil || len(env2.Agents) != 1 {
		t.Fatalf("cached fetch failed: %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("cache miss: hits=%d", got)
	}

	// Force TTL expiry — next fetch triggers a 500, but cache is returned.
	c.cachedAt = time.Now().Add(-time.Hour)
	env3, err := c.FetchRegistry(context.Background())
	if err != nil {
		t.Fatalf("stale fallback should not error: %v", err)
	}
	if len(env3.Agents) != 1 {
		t.Fatalf("stale fallback returned wrong data: %+v", env3)
	}
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("expected 2 upstream hits, got %d", got)
	}
}

func TestFetchRegistryInvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("{not json"))
	}))
	defer srv.Close()
	c := NewClient(Config{RawBase: srv.URL})
	if _, err := c.FetchRegistry(context.Background()); !errors.Is(err, ErrRegistryInvalid) {
		t.Fatalf("expected ErrRegistryInvalid, got %v", err)
	}
}

func TestResolveTagPrefersVPrefix(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/v1.0.0/crew44-agent.json") {
			w.Write([]byte(`{"schema_version":"crew44.agent.v1","name":"X","version":"1.0.0","description":"d"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := NewClient(Config{RawBase: srv.URL})
	ref, _, err := c.ResolveTag(context.Background(), repoCoord{Owner: "o", Repo: "r"}, "1.0.0")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if ref != "v1.0.0" {
		t.Fatalf("expected v1.0.0, got %s", ref)
	}
}

func TestResolveTagMissing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := NewClient(Config{RawBase: srv.URL})
	_, _, err := c.ResolveTag(context.Background(), repoCoord{Owner: "o", Repo: "r"}, "9.9.9")
	if !errors.Is(err, ErrTagNotFound) {
		t.Fatalf("expected ErrTagNotFound, got %v", err)
	}
}

// A force-pushed tag whose manifest declares a different version must
// be rejected, not silently installed. Both candidate refs (vX and X)
// are served the divergent manifest so the resolver has nothing valid
// to fall back to.
func TestResolveTagRejectsVersionMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"schema_version":"crew44.agent.v1","name":"X","version":"9.9.9","description":"d"}`))
	}))
	defer srv.Close()
	c := NewClient(Config{RawBase: srv.URL})
	_, _, err := c.ResolveTag(context.Background(), repoCoord{Owner: "o", Repo: "r"}, "1.0.0")
	if !errors.Is(err, ErrVersionMismatch) {
		t.Fatalf("expected ErrVersionMismatch, got %v", err)
	}
	if !strings.Contains(err.Error(), "9.9.9") || !strings.Contains(err.Error(), "1.0.0") {
		t.Fatalf("error should name both versions: %v", err)
	}
}

// When only one of the candidate refs is mismatched but the other is
// correct, the correct one wins. Guards against breaking the v-prefix
// fallback while adding the version check.
func TestResolveTagFallsBackBetweenCandidates(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/v1.0.0/") {
			// v-prefixed tag is wrong: declares 9.9.9.
			w.Write([]byte(`{"schema_version":"crew44.agent.v1","name":"X","version":"9.9.9","description":"d"}`))
			return
		}
		if strings.Contains(r.URL.Path, "/1.0.0/") {
			// Bare-version tag is correct.
			w.Write([]byte(`{"schema_version":"crew44.agent.v1","name":"X","version":"1.0.0","description":"d"}`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	c := NewClient(Config{RawBase: srv.URL})
	ref, _, err := c.ResolveTag(context.Background(), repoCoord{Owner: "o", Repo: "r"}, "1.0.0")
	if err != nil {
		t.Fatalf("expected fallback to succeed, got %v", err)
	}
	if ref != "1.0.0" {
		t.Fatalf("expected ref=1.0.0, got %s", ref)
	}
}

func TestVersionMatchesAllowsVPrefix(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"1.0.0", "v1.0.0", true},
		{"v1.0.0", "1.0.0", true},
		{" v2.3 ", "2.3", true},
		{"1.0.0", "1.0.1", false},
		{"", "1.0.0", false},
	}
	for _, tc := range cases {
		if got := versionMatches(tc.a, tc.b); got != tc.want {
			t.Fatalf("versionMatches(%q,%q) = %v, want %v", tc.a, tc.b, got, tc.want)
		}
	}
}
