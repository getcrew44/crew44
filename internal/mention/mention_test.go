package mention

import "testing"

func TestParseMentions(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    []Mention
	}{
		{
			name:    "simple agent mention",
			content: "[@Agent](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa) please fix",
			want:    []Mention{{Type: "agent", ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}},
		},
		{
			name:    "agent name with square brackets",
			content: "[@David[TF]](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa) please fix",
			want:    []Mention{{Type: "agent", ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}},
		},
		{
			name:    "issue mention without at prefix",
			content: "[CREW-123](mention://issue/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa) is related",
			want:    []Mention{{Type: "issue", ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}},
		},
		{
			name:    "all mention",
			content: "[@All](mention://all/all) heads up",
			want:    []Mention{{Type: "all", ID: "all"}},
		},
		{
			name:    "deduplicate same mention",
			content: "[@A](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa) and again [@A](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)",
			want:    []Mention{{Type: "agent", ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}},
		},
		{
			name:    "no mentions",
			content: "just a plain comment",
			want:    nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseMentions(tt.content)
			if len(got) != len(tt.want) {
				t.Fatalf("ParseMentions() returned %d mentions, want %d\ngot:  %+v\nwant: %+v", len(got), len(tt.want), got, tt.want)
			}
			for i := range got {
				if got[i].Type != tt.want[i].Type || got[i].ID != tt.want[i].ID {
					t.Errorf("mention[%d] = %+v, want %+v", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestHasMentionAll(t *testing.T) {
	tests := []struct {
		name     string
		mentions []Mention
		want     bool
	}{
		{"empty", nil, false},
		{"no all", []Mention{{Type: "agent", ID: "x"}}, false},
		{"has all", []Mention{{Type: "all", ID: "all"}}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HasMentionAll(tt.mentions); got != tt.want {
				t.Fatalf("HasMentionAll() = %v, want %v", got, tt.want)
			}
		})
	}
}
