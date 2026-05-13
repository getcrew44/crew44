package rpc

import (
	"context"
	"encoding/json"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/id"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

func (s *Server) chatsEventsSubscribe(ctx context.Context, conn Peer, params json.RawMessage) (any, error) {
	if conn == nil {
		return nil, errMethodNotFound
	}
	var body struct {
		ChatID string `json:"chat_id"`
		After  int64  `json:"after"`
	}
	if err := decodeParams(params, &body); err != nil {
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

	go s.runChatSubscription(cancelCtx, conn, subscriptionID, body.ChatID, events, sub)

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
				if !conn.Notify("chat.event", map[string]any{
					"subscription_id": subscriptionID,
					"chat_id":         chatID,
					"event":           notification.Value,
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
