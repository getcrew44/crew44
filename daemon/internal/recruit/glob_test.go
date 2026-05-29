package recruit

import "testing"

func TestMatchPayloadGlob(t *testing.T) {
	cases := []struct {
		pattern   string
		candidate string
		want      bool
	}{
		{"AGENT.md", "AGENT.md", true},
		{"AGENT.md", "skills/AGENT.md", false},
		{"skills/foo/SKILL.md", "skills/foo/SKILL.md", true},
		{"skills/**", "skills/foo/SKILL.md", true},
		{"skills/**", "skills/foo/bar/baz.md", true},
		{"skills/**", "skills", true},
		{"skills/**", "skills-other/foo", false},
		{"upstream/**", "upstream/.gitattributes", true},
		{"**/SKILL.md", "skills/foo/SKILL.md", true},
		{"**/SKILL.md", "SKILL.md", true},
		{"**/.git/**", ".git/HEAD", true},
		{"**/.git/**", "deep/sub/.git/refs/heads/main", true},
		{"**/.git/**", ".git", true},
		{"**/node_modules/**", "node_modules/foo", true},
		{"**/node_modules/**", "pkg/node_modules/a/b", true},
		{"**/.DS_Store", ".DS_Store", true},
		{"**/.DS_Store", "skills/.DS_Store", true},
		{"docs/*.md", "docs/intro.md", true},
		{"docs/*.md", "docs/sub/intro.md", false},
		{"docs/*", "docs/intro", true},
		{"docs/*", "other/intro", false},
		{"docs/?.md", "docs/a.md", true},
		{"docs/?.md", "docs/ab.md", false},
	}
	for _, tc := range cases {
		if got := matchPayloadGlob(tc.pattern, tc.candidate); got != tc.want {
			t.Errorf("matchPayloadGlob(%q,%q) = %v, want %v", tc.pattern, tc.candidate, got, tc.want)
		}
	}
}
