package agent

import "testing"

func TestDefaultModelID(t *testing.T) {
	cases := []struct {
		provider string
		want     string
	}{
		{"claude", "claude-opus-4-7"},
		{"codex", "gpt-5.5"},
		{"unknown", ""},
		{"", ""},
	}
	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			if got := DefaultModelID(tc.provider); got != tc.want {
				t.Fatalf("DefaultModelID(%q) = %q, want %q", tc.provider, got, tc.want)
			}
		})
	}
}

func TestStaticCatalogsHaveExactlyOneDefault(t *testing.T) {
	for _, c := range []struct {
		name    string
		catalog []Model
	}{
		{"claude", claudeStaticModels()},
		{"codex", codexStaticModels()},
	} {
		t.Run(c.name, func(t *testing.T) {
			defaults := 0
			for _, m := range c.catalog {
				if m.Default {
					defaults++
				}
			}
			if defaults != 1 {
				t.Fatalf("%s: want exactly 1 Default entry, got %d", c.name, defaults)
			}
		})
	}
}
