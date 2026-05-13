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
			content:     "handover now\n<CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell the story in Chinese.</CREWAI_AGENT_HANDOVER>",
			wantCleaned: "handover now",
			wantTargets: []AgentHandoverMarker{{AgentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Note: "Tell the story in Chinese."}},
		},
		{
			name: "multiple markers",
			content: strings.Join([]string{
				"handover twice",
				"<CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">First try.</CREWAI_AGENT_HANDOVER>",
				"<CREWAI_AGENT_HANDOVER agent_id=\"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\">Second try.</CREWAI_AGENT_HANDOVER>",
			}, "\n"),
			wantCleaned: "handover twice",
			wantTargets: []AgentHandoverMarker{
				{AgentID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Note: "First try."},
				{AgentID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Note: "Second try."},
			},
		},
		{
			name:        "embedded marker is ignored",
			content:     "inline <CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREWAI_AGENT_HANDOVER> stays",
			wantCleaned: "inline <CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREWAI_AGENT_HANDOVER> stays",
			wantTargets: nil,
		},
		{
			name:        "old agent-id-only marker is not compatible",
			content:     "<CREWAI_AGENT_HANDOVER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREWAI_AGENT_HANDOVER>",
			wantCleaned: "<CREWAI_AGENT_HANDOVER>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREWAI_AGENT_HANDOVER>",
			wantTargets: nil,
		},
		{
			name:        "literal regex anchors are not part of marker syntax",
			content:     "^<CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREWAI_AGENT_HANDOVER>$",
			wantCleaned: "^<CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Tell it.</CREWAI_AGENT_HANDOVER>$",
			wantTargets: nil,
		},
		{
			name:        "old marker is not compatible",
			content:     "legacy ^<CREWAI_HANDOFF>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREWAI_HANDOFF>",
			wantCleaned: "legacy ^<CREWAI_HANDOFF>aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa</CREWAI_HANDOFF>",
			wantTargets: nil,
		},
		{
			name:        "marker-only content cleans to empty",
			content:     "<CREWAI_AGENT_HANDOVER agent_id=\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\">Continue the task.</CREWAI_AGENT_HANDOVER>",
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
