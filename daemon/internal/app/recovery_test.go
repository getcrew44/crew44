package app

import (
	"errors"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/store"
)

// TestReconcileStaleStreamViaGetChat covers the daemon-crash-mid-stream case:
// a chat persisted with stream.status="streaming" but no live goroutine should
// be reset to idle (and get a terminal error event) the next time anyone
// reads it via App.GetChat. Recovery is lazy — no work happens until a client
// actually asks for the chat.
func TestReconcileStaleStreamViaGetChat(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)

	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "stuck chat", agentID)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a daemon that crashed mid-stream: stream.status is "streaming"
	// on disk, but a.cancels has no entry (no live goroutine).
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.ActiveTurnID = "turn-stuck"
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	// The raw store still says streaming — recovery hasn't run.
	if raw, err := a.store.GetChat(chat.ID); err != nil || raw.Stream.Status != "streaming" {
		t.Fatalf("precondition: store should still show streaming, got status=%q err=%v", raw.Stream.Status, err)
	}

	recovered, err := a.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Stream.Status != "idle" {
		t.Fatalf("GetChat should recover stale stream; status=%q want idle", recovered.Stream.Status)
	}
	if recovered.Stream.LastError == "" {
		t.Fatal("expected stream.last_error to describe the interruption")
	}

	events, err := a.store.ListEvents(chat.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 {
		t.Fatal("expected a terminal error event to be appended")
	}
	last := events[len(events)-1]
	if last.Type != model.EventTypeError || last.Error == nil || last.Error.Code != "stream_interrupted" {
		t.Fatalf("last event = %+v, want type=error code=stream_interrupted", last)
	}

	// Idempotency: a second GetChat must not append another error event.
	if _, err := a.GetChat(chat.ID); err != nil {
		t.Fatal(err)
	}
	eventsAgain, err := a.store.ListEvents(chat.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(eventsAgain) != len(events) {
		t.Fatalf("recovery should be idempotent: events grew from %d to %d", len(events), len(eventsAgain))
	}
}

// TestReconcileStaleStreamSkipsActiveGoroutine ensures recovery does NOT touch
// a chat that genuinely has a live runChat goroutine. Detection signal is
// "status=streaming AND not in a.cancels"; the converse must be respected.
func TestReconcileStaleStreamSkipsActiveGoroutine(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "live chat", agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.cancels[chat.ID] = func() {}
	a.mu.Unlock()

	out, err := a.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if out.Stream.Status != "streaming" {
		t.Fatalf("live chat should not be recovered; status=%q want streaming", out.Stream.Status)
	}
	events, err := a.store.ListEvents(chat.ID, 0)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		t.Fatal(err)
	}
	for _, e := range events {
		if e.Type == model.EventTypeError {
			t.Fatalf("no error event should be appended for an active chat, got %+v", e)
		}
	}
}

func TestPostMessageRecoversStaleStreamBeforeConflictCheck(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "stale chat", agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.ActiveTurnID = "turn-stale"
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	content := "/slow continue after restart"
	if _, err := a.PostMessage(chat.ID, content, agentID); err != nil {
		t.Fatalf("PostMessage should recover stale stream instead of returning conflict: %v", err)
	}
	t.Cleanup(func() {
		_ = a.CancelChat(chat.ID)
		deadline := time.Now().Add(time.Second)
		for time.Now().Before(deadline) {
			current, err := a.store.GetChat(chat.ID)
			if err == nil && current.Stream.Status != "streaming" {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	})

	reposted, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reposted.Stream.Status != "streaming" {
		t.Fatalf("new post should start a fresh stream; status=%q want streaming", reposted.Stream.Status)
	}
	events, err := a.store.ListEvents(chat.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	foundInterrupted := false
	foundUserMessage := false
	for _, event := range events {
		if event.Type == model.EventTypeError && event.Error != nil && event.Error.Code == "stream_interrupted" {
			foundInterrupted = true
		}
		if event.Type == model.EventTypeMessage && event.Message != nil && event.Message.Content == content {
			foundUserMessage = true
		}
	}
	if !foundInterrupted || !foundUserMessage {
		t.Fatalf("expected interruption event and new user message, got %+v", events)
	}
}

func TestListProjectChatsRecoversStaleStreams(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "stale chat", agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.ActiveTurnID = "turn-stale"
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	chats, err := a.ListProjectChats(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 {
		t.Fatalf("expected one chat, got %+v", chats)
	}
	if chats[0].Stream.Status != "idle" {
		t.Fatalf("ListProjectChats should recover stale stream; status=%q want idle", chats[0].Stream.Status)
	}
}
