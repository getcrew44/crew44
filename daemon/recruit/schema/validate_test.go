package schema

import "testing"

func TestValidateManifest(t *testing.T) {
	good := Manifest{SchemaVersion: "crew44.agent.v1", Name: "X", Version: "1.0.0", Description: "y"}
	if err := ValidateManifest(&good); err != nil {
		t.Fatalf("valid manifest rejected: %v", err)
	}

	cases := []struct {
		name string
		m    Manifest
	}{
		{"missing schema_version", Manifest{Name: "n", Version: "1", Description: "d"}},
		{"unsupported schema_version", Manifest{SchemaVersion: "crew44.agent.v2", Name: "n", Version: "1", Description: "d"}},
		{"missing name", Manifest{SchemaVersion: "crew44.agent.v1", Version: "1", Description: "d"}},
		{"missing version", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Description: "d"}},
		{"missing description", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1"}},
		{"skill missing name", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Skills: []SkillDecl{{Path: "skills/x/SKILL.md"}}}},
		{"skill missing path", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Skills: []SkillDecl{{Name: "x"}}}},
		{"skill path missing SKILL.md", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Skills: []SkillDecl{{Name: "x", Path: "skills/x/notes.md"}}}},
		{"upstream-wrapper missing upstream block", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", SourceType: SourceTypeUpstreamWrapper}},
		{"upstream-wrapper missing repo url", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", SourceType: SourceTypeUpstreamWrapper, Upstream: &UpstreamMeta{}}},
		{"upstream path traversal", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", SourceType: SourceTypeUpstreamWrapper, Upstream: &UpstreamMeta{RepoURL: "https://github.com/o/r", Path: "../escape"}}},
		{"payload include negation", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Payload: &PayloadSpec{Include: []string{"!secret"}}}},
		{"payload include traversal", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Payload: &PayloadSpec{Include: []string{"foo/../../etc/passwd"}}}},
		{"payload exclude traversal", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Payload: &PayloadSpec{Exclude: []string{"../foo"}}}},
		{"payload absolute include", Manifest{SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d", Payload: &PayloadSpec{Include: []string{"/etc/passwd"}}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateManifest(&tc.m); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}

	// Happy-path with new optional fields.
	wrapper := Manifest{
		SchemaVersion: "crew44.agent.v1",
		Name:          "Karpathy",
		Version:       "1.0.0",
		Description:   "wrapped upstream",
		SourceType:    SourceTypeUpstreamWrapper,
		Upstream:      &UpstreamMeta{RepoURL: "https://github.com/x/y", Path: "upstream"},
		Skills:        []SkillDecl{{Name: "s", Path: "upstream/skills/s/SKILL.md"}},
		Payload:       &PayloadSpec{Include: []string{"AGENT.md", "upstream/**"}, Exclude: []string{".git/**"}},
	}
	if err := ValidateManifest(&wrapper); err != nil {
		t.Fatalf("wrapper manifest rejected: %v", err)
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

func TestParseGitHubRepo(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    RepoCoord
		wantErr bool
	}{
		{"https plain", "https://github.com/hex-studio/patch", RepoCoord{"hex-studio", "patch"}, false},
		{"with .git suffix", "https://github.com/hex-studio/patch.git", RepoCoord{"hex-studio", "patch"}, false},
		{"with trailing slash", "https://github.com/owner/repo/", RepoCoord{"owner", "repo"}, false},
		{"wrong host", "https://gitlab.com/owner/repo", RepoCoord{}, true},
		{"missing repo", "https://github.com/owner", RepoCoord{}, true},
		{"missing owner", "https://github.com/", RepoCoord{}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseGitHubRepo(tc.input)
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
