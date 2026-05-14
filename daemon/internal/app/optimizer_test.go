package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/optimizer"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
	"github.com/sqtech/crew-ai/crewai-repo/internal/store"
)

func newOptimizerTestApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a, err := New(Config{
		StateDir:       filepath.Join(root, ".crewai"),
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
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func firstAgentID(t *testing.T, a *App) string {
	t.Helper()
	agents, err := a.store.ListAgents()
	if err != nil {
		t.Fatal(err)
	}
	if len(agents) == 0 {
		t.Fatal("expected seeded default agent")
	}
	return agents[0].ID
}

func TestAppDispatcherWaitDoneHandlesAlreadyFinishedChat(t *testing.T) {
	a := newOptimizerTestApp(t)
	d := &appDispatcher{app: a}
	agentID := firstAgentID(t, a)
	chatID, err := d.CreateChat(context.Background(), optimizer.SystemProjectID, "scan", agentID)
	if err != nil {
		t.Fatal(err)
	}
	a.finishChatSuccess(chatID)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := d.WaitDone(ctx, chatID, time.Minute); err != nil {
		t.Fatalf("WaitDone should observe already-finished chat, got %v", err)
	}
}

func TestAppDispatcherWaitDoneReturnsRuntimeLastError(t *testing.T) {
	a := newOptimizerTestApp(t)
	d := &appDispatcher{app: a}
	agentID := firstAgentID(t, a)
	chatID, err := d.CreateChat(context.Background(), optimizer.SystemProjectID, "scan", agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		t.Fatal(err)
	}
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.CurrentAgentID = agentID
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	go a.finishChatWithRuntimeError(chatID, "turn-1", agentID, "bufio.Scanner: token too long")

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = d.WaitDone(ctx, chatID, time.Minute)
	if err == nil {
		t.Fatal("WaitDone should return the runtime error")
	}
	if !strings.Contains(err.Error(), "bufio.Scanner: token too long") {
		t.Fatalf("WaitDone error = %q, want concrete runtime last_error", err)
	}
}

func TestAppDispatcherWaitDoneResetsIdleTimeoutOnActivity(t *testing.T) {
	a := newOptimizerTestApp(t)
	d := &appDispatcher{app: a}
	agentID := firstAgentID(t, a)
	chatID, err := d.CreateChat(context.Background(), optimizer.SystemProjectID, "scan", agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		t.Fatal(err)
	}
	chat.Stream.Status = "streaming"
	chat.Stream.AgentID = agentID
	chat.CurrentAgentID = agentID
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}

	go func() {
		time.Sleep(20 * time.Millisecond)
		a.broker.Publish(chatID, broker.Notification[model.Event]{
			Kind: broker.KindEvent,
			Value: model.Event{
				Type: model.EventTypeMessage,
				TS:   time.Now().UTC(),
				Message: &model.MessagePayload{
					Role:    model.MessageRoleAssistant,
					Content: "still working",
				},
			},
		})
		time.Sleep(25 * time.Millisecond)
		a.finishChatSuccess(chatID)
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := d.WaitDone(ctx, chatID, 35*time.Millisecond); err != nil {
		t.Fatalf("WaitDone should reset idle timeout after activity, got %v", err)
	}
}

func TestAppDispatcherBuildScanCorpusUsesIncrementalUserProjectChats(t *testing.T) {
	a := newOptimizerTestApp(t)
	d := &appDispatcher{app: a}
	agentID := firstAgentID(t, a)
	since := time.Date(2026, 5, 13, 8, 0, 0, 0, time.UTC)
	until := time.Date(2026, 5, 14, 8, 0, 0, 0, time.UTC)

	project, err := a.CreateProject("Visible Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	incrementalChat, err := a.CreateChat(project.ID, "recent user work", agentID)
	if err != nil {
		t.Fatal(err)
	}
	incrementalChat.CreatedAt = since.Add(time.Hour)
	incrementalChat.UpdatedAt = since.Add(2 * time.Hour)
	if err := a.store.SaveChat(incrementalChat); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.AppendEvent(incrementalChat.ID, model.Event{
		Type: model.EventTypeMessage,
		TS:   since.Add(70 * time.Minute),
		Message: &model.MessagePayload{
			Role:    model.MessageRoleUser,
			Content: strings.Repeat("please keep this project conversation bounded ", 20),
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.AppendEvent(incrementalChat.ID, model.Event{
		Type: model.EventTypeToolCallResult,
		TS:   since.Add(80 * time.Minute),
		ToolCallResult: &model.ToolCallResultPayload{
			Name:   "exec_command",
			Output: strings.Repeat("large tool output ", 200),
		},
	}); err != nil {
		t.Fatal(err)
	}

	oldChat, err := a.CreateChat(project.ID, "old work", agentID)
	if err != nil {
		t.Fatal(err)
	}
	oldChat.CreatedAt = since.Add(-2 * time.Hour)
	oldChat.UpdatedAt = since.Add(-time.Hour)
	if err := a.store.SaveChat(oldChat); err != nil {
		t.Fatal(err)
	}
	if _, err := a.CreateChat(optimizer.SystemProjectID, "optimizer should be excluded", agentID); err != nil {
		t.Fatal(err)
	}

	corpus, err := d.BuildScanCorpus(context.Background(), since, until, 20)
	if err != nil {
		t.Fatal(err)
	}
	if corpus.WindowStart != since || corpus.WindowEnd != until {
		t.Fatalf("corpus window = %s..%s, want %s..%s", corpus.WindowStart, corpus.WindowEnd, since, until)
	}
	if corpus.RunsAnalyzed != 1 {
		t.Fatalf("RunsAnalyzed = %d, want 1", corpus.RunsAnalyzed)
	}
	if len(corpus.Chats) != 1 {
		t.Fatalf("expected only the one visible incremental chat, got %+v", corpus.Chats)
	}
	got := corpus.Chats[0]
	if got.ProjectID != project.ID || got.ChatID != incrementalChat.ID {
		t.Fatalf("unexpected corpus chat: %+v", got)
	}
	if strings.Contains(got.Snippets[0].Text, "large tool output") {
		t.Fatalf("tool output leaked into corpus snippets: %+v", got.Snippets)
	}
	if len(got.Snippets[0].Text) > 260 {
		t.Fatalf("snippet was not bounded: %d chars", len(got.Snippets[0].Text))
	}
}

func TestSeedOptimizerProjectCreatesInternalWorkdir(t *testing.T) {
	a := newOptimizerTestApp(t)

	project, err := a.store.GetProject(optimizer.SystemProjectID)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(a.store.Root(), "optimizer", "scan-workdir")
	if project.Workdir != want {
		t.Fatalf("optimizer workdir = %q, want %q", project.Workdir, want)
	}
	legacy := filepath.Join(a.store.Root(), "projects", "proj-"+optimizer.SystemProjectID, "workdir")
	if project.Workdir == legacy {
		t.Fatalf("optimizer workdir still uses legacy projects/ location: %q", project.Workdir)
	}
}

func TestSeedOptimizerProjectMigratesEmptyInternalWorkdir(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(root, ".crewai")
	st, err := store.New(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	createdAt := time.Date(2026, 5, 13, 1, 2, 3, 0, time.UTC)
	if err := st.SaveProject(model.ProjectRecord{
		ID:           optimizer.SystemProjectID,
		Name:         "Auto-optimizer",
		Workdir:      "",
		SystemHidden: true,
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}); err != nil {
		t.Fatal(err)
	}

	a, err := New(Config{
		StateDir:       stateDir,
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
	})
	if err != nil {
		t.Fatal(err)
	}

	project, err := a.store.GetProject(optimizer.SystemProjectID)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(stateDir, "optimizer", "scan-workdir")
	if project.Workdir != want {
		t.Fatalf("optimizer workdir = %q, want %q", project.Workdir, want)
	}
	if !project.CreatedAt.Equal(createdAt) {
		t.Fatalf("created_at changed to %s, want %s", project.CreatedAt, createdAt)
	}
}

func TestSeedOptimizerProjectMigratesLegacyProjectsWorkdir(t *testing.T) {
	root := t.TempDir()
	stateDir := filepath.Join(root, ".crewai")
	st, err := store.New(stateDir)
	if err != nil {
		t.Fatal(err)
	}
	legacyWorkdir := filepath.Join(stateDir, "projects", "proj-"+optimizer.SystemProjectID, "workdir")
	createdAt := time.Date(2026, 5, 13, 1, 2, 3, 0, time.UTC)
	if err := st.SaveProject(model.ProjectRecord{
		ID:           optimizer.SystemProjectID,
		Name:         "Auto-optimizer",
		Workdir:      legacyWorkdir,
		SystemHidden: true,
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}); err != nil {
		t.Fatal(err)
	}

	a, err := New(Config{
		StateDir:       stateDir,
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
	})
	if err != nil {
		t.Fatal(err)
	}

	project, err := a.store.GetProject(optimizer.SystemProjectID)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(stateDir, "optimizer", "scan-workdir")
	if project.Workdir != want {
		t.Fatalf("optimizer workdir = %q, want %q (legacy should have been migrated)", project.Workdir, want)
	}
}

func TestListChatsWithoutProjectFilterExcludesSystemHiddenProjects(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	if _, err := a.CreateChat(optimizer.SystemProjectID, "hidden scan", agentID); err != nil {
		t.Fatal(err)
	}
	visibleProject, err := a.CreateProject("Visible", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	visibleChat, err := a.CreateChat(visibleProject.ID, "visible chat", agentID)
	if err != nil {
		t.Fatal(err)
	}

	chats, err := a.ListChats("")
	if err != nil {
		t.Fatal(err)
	}
	if len(chats) != 1 {
		t.Fatalf("expected only visible chats, got %#v", chats)
	}
	if chats[0].ID != visibleChat.ID {
		t.Fatalf("expected visible chat %q, got %q", visibleChat.ID, chats[0].ID)
	}
}
