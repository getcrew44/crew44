package app

import (
	"path/filepath"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// TestRecoverInterruptedStreams covers the daemon-restart-during-stream bug:
// a chat persisted with stream.status="streaming" should be reset to idle on
// the next App.New, and a terminal error event should be appended so the UI
// can show why the run stopped.
func TestRecoverInterruptedStreams(t *testing.T) {
	root := t.TempDir()
	cfg := Config{
		StateDir:       filepath.Join(root, ".crew44"),
		RuntimeScanDir: filepath.Join(root, "runtime-manifests"),
		Scanner: runtime.StaticScanner{Records: []model.RuntimeRecord{{
			ID:         "runtime-mock",
			Provider:   "mock",
			Name:       "Mock Runtime",
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: "builtin://mock",
			Version:    "test",
		}}},
		Engine: runtime.MockEngine{},
	}

	first, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	agentID := firstAgentID(t, first)

	project, err := first.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := first.CreateChat(project.ID, "stuck chat", agentID)
	if err != nil {
		t.Fatal(err)
	}

	// Simulate a daemon that crashed mid-stream: chat.stream.status remains
	// "streaming", events on disk, no goroutine in cancels.
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.ActiveTurnID = "turn-stuck"
	if err := first.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
	if _, err := first.store.AppendEvent(chat.ID, model.Event{
		Type:         model.EventTypeMessage,
		TurnID:       "turn-stuck",
		ActorAgentID: agentID,
		Message:      &model.MessagePayload{Role: model.MessageRoleUser, Content: "hi"},
	}); err != nil {
		t.Fatal(err)
	}

	// Restart the daemon — recoverInterruptedStreams runs inside New.
	second, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}

	recovered, err := second.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Stream.Status != "idle" {
		t.Fatalf("stream.status after recovery = %q, want %q", recovered.Stream.Status, "idle")
	}
	if recovered.Stream.LastError == "" {
		t.Fatal("expected stream.last_error to describe the interruption")
	}

	events, err := second.store.ListEvents(chat.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 2 {
		t.Fatalf("expected at least 2 events after recovery, got %d", len(events))
	}
	last := events[len(events)-1]
	if last.Type != model.EventTypeError {
		t.Fatalf("last event type = %q, want %q", last.Type, model.EventTypeError)
	}
	if last.Error == nil || last.Error.Code != "stream_interrupted" {
		t.Fatalf("last event error payload = %+v, want code stream_interrupted", last.Error)
	}

	// Second restart must be a no-op: the chat is already idle, so no further
	// error event should be appended.
	third, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	eventsAgain, err := third.store.ListEvents(chat.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(eventsAgain) != len(events) {
		t.Fatalf("recovery is not idempotent: events grew from %d to %d", len(events), len(eventsAgain))
	}
}
