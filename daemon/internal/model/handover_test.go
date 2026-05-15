package model

import (
	"reflect"
	"strings"
	"testing"
)

func TestExtractAgentHandoverMarkers(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		wantCleaned string
		wantTargets []AgentHandoverMarker
	}{
		{
			name:        "single marker",
			content:     "handover now\n<CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell the story in Chinese.</CREW44_AGENT_HANDOVER>",
			wantCleaned: "handover now",
			wantTargets: []AgentHandoverMarker{{AgentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Note: "Tell the story in Chinese."}},
		},
		{
			name: "multiple markers",
			content: strings.Join([]string{
				"handover twice",
				"<CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">First try.</CREW44_AGENT_HANDOVER>",
				"<CREW44_AGENT_HANDOVER agent_id=\"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\">Second try.</CREW44_AGENT_HANDOVER>",
			}, "\n"),
			wantCleaned: "handover twice",
			wantTargets: []AgentHandoverMarker{
				{AgentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Note: "First try."},
				{AgentID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Note: "Second try."},
			},
		},
		{
			name:        "embedded marker is ignored",
			content:     "inline <CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREW44_AGENT_HANDOVER> stays",
			wantCleaned: "inline <CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREW44_AGENT_HANDOVER> stays",
			wantTargets: nil,
		},
		{
			name:        "old agent-id-only marker is not compatible",
			content:     "<CREW44_AGENT_HANDOVER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREW44_AGENT_HANDOVER>",
			wantCleaned: "<CREW44_AGENT_HANDOVER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREW44_AGENT_HANDOVER>",
			wantTargets: nil,
		},
		{
			name:        "literal regex anchors are not part of marker syntax",
			content:     "^<CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREW44_AGENT_HANDOVER>$",
			wantCleaned: "^<CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREW44_AGENT_HANDOVER>$",
			wantTargets: nil,
		},
		{
			name:        "old marker is not compatible",
			content:     "legacy ^<CREW44_HANDOFF>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREW44_HANDOFF>",
			wantCleaned: "legacy ^<CREW44_HANDOFF>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREW44_HANDOFF>",
			wantTargets: nil,
		},
		{
			name:        "marker-only content cleans to empty",
			content:     "<CREW44_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Continue the task.</CREW44_AGENT_HANDOVER>",
			wantCleaned: "",
			wantTargets: []AgentHandoverMarker{{AgentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Note: "Continue the task."}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotCleaned, gotTargets := ExtractAgentHandoverMarkers(tt.content)
			if gotCleaned != tt.wantCleaned {
				t.Fatalf("cleaned = %q, want %q", gotCleaned, tt.wantCleaned)
			}
			if !reflect.DeepEqual(gotTargets, tt.wantTargets) {
				t.Fatalf("targets = %#v, want %#v", gotTargets, tt.wantTargets)
			}
		})
	}
}
