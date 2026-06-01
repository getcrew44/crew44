package schema

import "testing"

func TestResolvePayloadDefaults(t *testing.T) {
	t.Run("native default", func(t *testing.T) {
		m := Manifest{
			SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d",
			Skills: []SkillDecl{{Name: "s", Path: "skills/s/SKILL.md"}},
		}
		got := ResolvePayload(&m)
		want := []string{"INSTRUCTIONS.md", "crew44-agent.json", "skills/s/SKILL.md"}
		if !equalStrings(got.Include, want) {
			t.Fatalf("native include = %v, want %v", got.Include, want)
		}
		if len(got.Exclude) != 0 {
			t.Fatalf("native exclude = %v, want empty", got.Exclude)
		}
	})
	t.Run("wrapper default", func(t *testing.T) {
		m := Manifest{
			SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d",
			SourceType: SourceTypeUpstreamWrapper,
			Upstream:   &UpstreamMeta{RepoURL: "https://github.com/x/y"},
			Skills:     []SkillDecl{{Name: "s", Path: "upstream/skills/s/SKILL.md"}},
		}
		got := ResolvePayload(&m)
		want := []string{"INSTRUCTIONS.md", "crew44-agent.json", "upstream/skills/s/SKILL.md", "upstream/**"}
		if !equalStrings(got.Include, want) {
			t.Fatalf("wrapper include = %v, want %v", got.Include, want)
		}
	})
	t.Run("explicit payload wins", func(t *testing.T) {
		m := Manifest{
			SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d",
			Payload: &PayloadSpec{Include: []string{"INSTRUCTIONS.md", "docs/**"}, Exclude: []string{"docs/secret.md"}},
		}
		got := ResolvePayload(&m)
		if !equalStrings(got.Include, []string{"INSTRUCTIONS.md", "docs/**"}) {
			t.Fatalf("explicit include not honored: %v", got.Include)
		}
		if !equalStrings(got.Exclude, []string{"docs/secret.md"}) {
			t.Fatalf("explicit exclude not honored: %v", got.Exclude)
		}
	})
	t.Run("exclude-only falls back to default include", func(t *testing.T) {
		m := Manifest{
			SchemaVersion: "crew44.agent.v1", Name: "n", Version: "1", Description: "d",
			Skills:  []SkillDecl{{Name: "s", Path: "skills/s/SKILL.md"}},
			Payload: &PayloadSpec{Exclude: []string{"**/.DS_Store"}},
		}
		got := ResolvePayload(&m)
		if !equalStrings(got.Include, []string{"INSTRUCTIONS.md", "crew44-agent.json", "skills/s/SKILL.md"}) {
			t.Fatalf("default include not used: %v", got.Include)
		}
		if !equalStrings(got.Exclude, []string{"**/.DS_Store"}) {
			t.Fatalf("exclude not preserved: %v", got.Exclude)
		}
	})
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
