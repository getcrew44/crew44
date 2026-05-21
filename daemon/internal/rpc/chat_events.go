package rpc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

func (s *Server) chatsEventsSubscribe(ctx context.Context, conn Peer, params json.RawMessage) (any, error) {
	if conn == nil {
		return nil, errMethodNotFound
	}
	var body struct {
		ChatID       string `json:"chat_id"`
		After        int64  `json:"after"`
		CompactTools bool   `json:"compact_tools"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}

	// Trigger lazy stale-stream recovery before snapshotting events: if the
	// previous daemon crashed mid-stream, GetChat appends a terminal error
	// event and flips status to idle, which must land in the replay below.
	if _, err := s.app.GetChat(body.ChatID); err != nil {
		return nil, err
	}

	events, err := s.app.ListEvents(body.ChatID, body.After)
	if err != nil {
		return nil, err
	}
	sub, cancelBroker := s.app.Subscribe(body.ChatID)
	subscriptionID := id.New()
	cancelCtx, cancelCtxFunc := context.WithCancel(ctx)
	cancel := func() {
		cancelCtxFunc()
		cancelBroker()
	}
	conn.AddSubscription(subscriptionID, cancel)

	if body.CompactTools {
		events = compactToolEvents(events)
	}

	go s.runChatSubscription(cancelCtx, conn, subscriptionID, body.ChatID, events, sub, body.CompactTools)

	return map[string]any{"subscription_id": subscriptionID}, nil
}

func (s *Server) chatsEventsUnsubscribe(_ context.Context, conn Peer, params json.RawMessage) (any, error) {
	if conn == nil {
		return nil, errMethodNotFound
	}
	var body struct {
		SubscriptionID string `json:"subscription_id"`
	}
	if err := decodeParams(params, &body); err != nil {
		return nil, err
	}
	conn.RemoveSubscription(body.SubscriptionID)
	return map[string]any{"ok": true}, nil
}

func (s *Server) runChatSubscription(
	ctx context.Context,
	conn Peer,
	subscriptionID string,
	chatID string,
	replay []model.Event,
	sub <-chan broker.Notification[model.Event],
	compactTools bool,
) {
	defer conn.RemoveSubscription(subscriptionID)

	for _, event := range replay {
		if !conn.Notify("chat.event", map[string]any{
			"subscription_id": subscriptionID,
			"chat_id":         chatID,
			"event":           event,
		}) {
			return
		}
	}

	chat, err := s.app.GetChat(chatID)
	if err != nil || chat.Stream.Status != "streaming" {
		conn.Notify("chat.done", map[string]any{
			"subscription_id": subscriptionID,
			"chat_id":         chatID,
		})
		return
	}

	for {
		select {
		case <-ctx.Done():
			return
		case notification, ok := <-sub:
			if !ok {
				return
			}
			switch notification.Kind {
			case broker.KindEvent:
				event := notification.Value
				if compactTools {
					event = compactToolEvent(event)
				}
				if !conn.Notify("chat.event", map[string]any{
					"subscription_id": subscriptionID,
					"chat_id":         chatID,
					"event":           event,
				}) {
					return
				}
			case broker.KindDone:
				conn.Notify("chat.done", map[string]any{
					"subscription_id": subscriptionID,
					"chat_id":         chatID,
				})
				return
			case broker.KindError:
				conn.Notify("chat.error", map[string]any{
					"subscription_id": subscriptionID,
					"chat_id":         chatID,
					"message":         notification.Error,
				})
				return
			}
		}
	}
}

func compactToolEvents(events []model.Event) []model.Event {
	out := make([]model.Event, len(events))
	for i, event := range events {
		out[i] = compactToolEvent(event)
	}
	return out
}

func compactToolEvent(event model.Event) model.Event {
	switch event.Type {
	case model.EventTypeToolCall:
		if event.ToolCall == nil {
			return event
		}
		event.ToolCall = &model.ToolCallPayload{
			CallID:  event.ToolCall.CallID,
			Name:    event.ToolCall.Name,
			Input:   compactToolInput(event.ToolCall.Input),
			Compact: true,
		}
	case model.EventTypeToolCallResult:
		if event.ToolCallResult == nil {
			return event
		}
		event.ToolCallResult = &model.ToolCallResultPayload{
			CallID:      event.ToolCallResult.CallID,
			ToolCallSeq: event.ToolCallResult.ToolCallSeq,
			Name:        event.ToolCallResult.Name,
			Compact:     true,
		}
	}
	return event
}

func compactToolInput(input map[string]any) map[string]any {
	summary := summarizeToolInput(input)
	if summary == "" {
		return nil
	}
	return map[string]any{"_summary": truncateToolSummary(summary)}
}

func summarizeToolInput(input map[string]any) string {
	if input == nil {
		return ""
	}
	for _, key := range []string{"command", "cmd", "path", "file_path", "file", "args", "query", "prompt", "pattern", "url"} {
		if value, ok := input[key]; ok {
			if text := stringifyToolValue(value); text != "" {
				return text
			}
		}
	}
	for _, value := range input {
		if text := stringifyToolValue(value); text != "" {
			return text
		}
	}
	data, err := json.Marshal(input)
	if err != nil {
		return ""
	}
	return string(data)
}

func stringifyToolValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []string:
		return strings.Join(typed, " ")
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := stringifyToolValue(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, " ")
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func truncateToolSummary(value string) string {
	const maxRunes = 128
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= maxRunes {
		return string(runes)
	}
	return string(runes[:maxRunes]) + "..."
}
