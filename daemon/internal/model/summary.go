package model

import "strings"

func BuildChatSummary(events []Event) string {
	if len(events) == 0 {
		return ""
	}

	type turnState struct {
		userMessages []string
		lastToolIdx  int
		events       []Event
	}

	turns := make([]string, 0, len(events))
	turnMap := make(map[string]*turnState)
	order := make([]string, 0, len(events))

	for _, event := range events {
		state, ok := turnMap[event.TurnID]
		if !ok {
			state = &turnState{lastToolIdx: -1}
			turnMap[event.TurnID] = state
			order = append(order, event.TurnID)
		}
		if event.Type == EventTypeToolCall {
			state.lastToolIdx = len(state.events)
		}
		if event.Type == EventTypeMessage && event.Message != nil && event.Message.Role == MessageRoleUser {
			content := StripAgentHandoverMarkers(event.Message.Content)
			state.userMessages = append(state.userMessages, AppendAttachmentLinks(content, event.Message.Attachments))
		}
		state.events = append(state.events, event)
	}

	for _, turnID := range order {
		state := turnMap[turnID]
		for _, message := range state.userMessages {
			turns = append(turns, "User: "+message)
		}

		for i := len(state.events) - 1; i >= 0; i-- {
			event := state.events[i]
			if event.Type != EventTypeMessage || event.Message == nil || event.Message.Role != MessageRoleAssistant {
				continue
			}
			if state.lastToolIdx >= 0 && i < state.lastToolIdx {
				continue
			}
			content := StripAgentHandoverMarkers(event.Message.Content)
			if content != "" {
				turns = append(turns, "Assistant("+event.ActorAgentID+"): "+content)
			}
			break
		}
	}

	return strings.Join(turns, "\n\n")
}
