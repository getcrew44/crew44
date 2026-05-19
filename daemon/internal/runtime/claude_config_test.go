package runtime

import (
	"testing"
)

func TestReadClaudeOAuthCredentialParentEnv(t *testing.T) {
	// All cases set at least one CLAUDE_CODE_OAUTH_* var, which short-
	// circuits before any keychain/file read — safe on every OS.
	cases := []struct {
		name    string
		access  string
		refresh string
		scopes  string
		want    claudeOAuthCredential
	}{
		{
			name:   "access token only (claude setup-token output)",
			access: "tok-abc",
			want:   claudeOAuthCredential{AccessToken: "tok-abc"},
		},
		{
			name:    "refresh + scopes only (documented automation pattern)",
			refresh: "r-1",
			scopes:  "user:profile user:inference",
			want:    claudeOAuthCredential{RefreshToken: "r-1", Scopes: "user:profile user:inference"},
		},
		{
			name:    "all three set",
			access:  "tok-abc",
			refresh: "r-1",
			scopes:  "user:profile",
			want:    claudeOAuthCredential{AccessToken: "tok-abc", RefreshToken: "r-1", Scopes: "user:profile"},
		},
		{
			name:    "refresh without scopes — partial pair ignored, but access token still wins",
			access:  "tok-abc",
			refresh: "r-1",
			want:    claudeOAuthCredential{AccessToken: "tok-abc"},
		},
		{
			name:   "scopes without refresh — partial pair ignored, but access token still wins",
			access: "tok-abc",
			scopes: "user:profile",
			want:   claudeOAuthCredential{AccessToken: "tok-abc"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", tc.access)
			t.Setenv("CLAUDE_CODE_OAUTH_REFRESH_TOKEN", tc.refresh)
			t.Setenv("CLAUDE_CODE_OAUTH_SCOPES", tc.scopes)
			if got := readClaudeOAuthCredential(); got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestParseClaudeOAuthCredential(t *testing.T) {
	cases := []struct {
		name string
		blob string
		want claudeOAuthCredential
	}{
		{
			name: "full blob with all fields",
			blob: `{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","scopes":["user:profile","user:inference"]}}`,
			want: claudeOAuthCredential{AccessToken: "a", RefreshToken: "r", Scopes: "user:profile user:inference"},
		},
		{
			name: "access token only — older blob without refresh token",
			blob: `{"claudeAiOauth":{"accessToken":"a"}}`,
			want: claudeOAuthCredential{AccessToken: "a"},
		},
		{
			// Per docs, CLAUDE_CODE_OAUTH_REFRESH_TOKEN requires
			// CLAUDE_CODE_OAUTH_SCOPES. The parser zeroes out the refresh
			// token when scopes are missing so callers can't construct a
			// broken half-pair auth env.
			name: "refresh token without scopes is dropped",
			blob: `{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","scopes":[]}}`,
			want: claudeOAuthCredential{AccessToken: "a"},
		},
		{
			name: "scopes without refresh token are dropped too",
			blob: `{"claudeAiOauth":{"accessToken":"a","scopes":["user:profile"]}}`,
			want: claudeOAuthCredential{AccessToken: "a"},
		},
		{
			name: "ignores unknown fields",
			blob: `{"claudeAiOauth":{"accessToken":"a","refreshToken":"r","scopes":["x"],"expiresAt":1,"subscriptionType":"pro"}}`,
			want: claudeOAuthCredential{AccessToken: "a", RefreshToken: "r", Scopes: "x"},
		},
		{
			name: "malformed JSON returns zero value",
			blob: `{not-json`,
			want: claudeOAuthCredential{},
		},
		{
			name: "wrong top-level key returns zero value",
			blob: `{"anthropicOauth":{"accessToken":"a"}}`,
			want: claudeOAuthCredential{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseClaudeOAuthCredential([]byte(tc.blob))
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}
