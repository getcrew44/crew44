package model

import (
	"regexp"
	"strings"
)

const AgentHandoverMarkerExample = "<CREWAI_AGENT_HANDOVER agent_id=\"agent_uuid\">one sentence for the next agent</CREWAI_AGENT_HANDOVER>"

type AgentHandoverMarker struct {
	AgentID string
	Note    string
}

var agentHandoverLineRe = regexp.MustCompile(`(?m)^<CREWAI_AGENT_HANDOVER\s+agent_id="([^"<>\r\n]+)">([^<\r\n]+)</CREWAI_AGENT_HANDOVER>$`)

func ExtractAgentHandoverMarkers(content string) (string, []AgentHandoverMarker) {
	matches := agentHandoverLineRe.FindAllStringSubmatch(content, -1)
	if len(matches) == 0 {
		return StripAgentHandoverMarkers(content), nil
	}
	markers := make([]AgentHandoverMarker, 0, len(matches))
	for _, match := range matches {
		if len(match) == 3 {
			markers = append(markers, AgentHandoverMarker{
				AgentID: strings.TrimSpace(match[1]),
				Note:    strings.TrimSpace(match[2]),
			})
		}
	}
	return StripAgentHandoverMarkers(content), markers
}

func StripAgentHandoverMarkers(content string) string {
	cleaned := agentHandoverLineRe.ReplaceAllString(content, "")
	return strings.TrimSpace(cleaned)
}
