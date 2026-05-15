package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/optimizer"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
	"github.com/getcrew44/crew44/daemon/internal/store"
)

func newOptimizerTestApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a, err := New(Config{
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
	stateDir := filepath.Join(root, ".crew44")
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
	stateDir := filepath.Join(root, ".crew44")
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

func TestMemoryWriterWritesTypedFileAndIndex(t *testing.T) {
	root := t.TempDir()
	st, err := store.New(root)
	if err != nil {
		t.Fatal(err)
	}
	w := &memoryWriter{store: st}

	entry := optimizer.MemoryEntry{
		Title:       "Prefer pnpm",
		Description: "never run npm install",
		Body:        "This repo uses pnpm workspaces.",
		MinerID:     "mp-1",
		ScanID:      "scan-1",
		GeneratedAt: time.Date(2026, 5, 14, 13, 0, 0, 0, time.UTC),
	}
	bodyPath, indexFull, err := w.WriteProjectMemory("abc123", entry)
	if err != nil {
		t.Fatalf("write project memory: %v", err)
	}
	if indexFull {
		t.Fatalf("first write should not overflow index")
	}
	want := filepath.Join(st.ProjectMemoryDir("abc123"), "prefer-pnpm-scan-1-mp-1.md")
	if bodyPath != want {
		t.Fatalf("body path = %q, want %q", bodyPath, want)
	}

	body, err := os.ReadFile(bodyPath)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	bodyStr := string(body)
	if !strings.HasPrefix(bodyStr, "---\n") {
		t.Fatalf("body should start with YAML frontmatter:\n%s", bodyStr)
	}
	for _, want := range []string{"name: prefer-pnpm-scan-1-mp-1", "source_scan: scan-1", "source_suggestion: scan-1:mp-1", "This repo uses pnpm workspaces."} {
		if !strings.Contains(bodyStr, want) {
			t.Fatalf("body missing %q:\n%s", want, bodyStr)
		}
	}

	indexPath := filepath.Join(st.ProjectMemoryDir("abc123"), "MEMORY.md")
	indexBytes, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	indexStr := string(indexBytes)
	if !strings.Contains(indexStr, "# Memory Index") {
		t.Fatalf("first entry should seed header:\n%s", indexStr)
	}
	if !strings.Contains(indexStr, "- [Prefer pnpm](prefer-pnpm-scan-1-mp-1.md) — never run npm install") {
		t.Fatalf("index missing entry line:\n%s", indexStr)
	}

	// Second accept on the same scope should append to the index without re-seeding the header.
	second := optimizer.MemoryEntry{
		Title:   "Use Go 1.22",
		Body:    "Toolchain pins to go1.22; do not bump.",
		MinerID: "mp-2",
		ScanID:  "scan-1",
	}
	if _, _, err := w.WriteProjectMemory("abc123", second); err != nil {
		t.Fatalf("second write: %v", err)
	}
	indexBytes, _ = os.ReadFile(indexPath)
	indexStr = string(indexBytes)
	if strings.Count(indexStr, "# Memory Index") != 1 {
		t.Fatalf("header should be seeded once:\n%s", indexStr)
	}
	if !strings.Contains(indexStr, "- [Use Go 1.22](use-go-1-22-scan-1-mp-2.md)") {
		t.Fatalf("index missing second entry:\n%s", indexStr)
	}
}

func TestMemoryWriterDoesNotCollideAcrossScans(t *testing.T) {
	root := t.TempDir()
	st, err := store.New(root)
	if err != nil {
		t.Fatal(err)
	}
	w := &memoryWriter{store: st}

	first := optimizer.MemoryEntry{
		Title:   "Prefer em-dashes",
		Body:    "Original memory from the first scan.",
		MinerID: "mu-1",
		ScanID:  "scan-1",
	}
	firstPath, _, err := w.WriteUserMemory(first)
	if err != nil {
		t.Fatalf("first write: %v", err)
	}

	// A second scan re-emits the same title and miner hint (mu-1 is per-scan,
	// not global). Without ScanID baked into the slug the second WriteFile
	// would silently clobber the first body file.
	second := optimizer.MemoryEntry{
		Title:   "Prefer em-dashes",
		Body:    "Refined memory from the second scan.",
		MinerID: "mu-1",
		ScanID:  "scan-2",
	}
	secondPath, _, err := w.WriteUserMemory(second)
	if err != nil {
		t.Fatalf("second write: %v", err)
	}
	if firstPath == secondPath {
		t.Fatalf("two scans collapsed to one path: %q", firstPath)
	}
	original, err := os.ReadFile(firstPath)
	if err != nil {
		t.Fatalf("first body should still exist: %v", err)
	}
	if !strings.Contains(string(original), "Original memory from the first scan.") {
		t.Fatalf("first body was overwritten:\n%s", original)
	}
}

func TestMemoryWriterNormalizesMultiLineTitle(t *testing.T) {
	root := t.TempDir()
	st, err := store.New(root)
	if err != nil {
		t.Fatal(err)
	}
	w := &memoryWriter{store: st}

	// Title arriving from the scanner still contains an interior newline
	// (clamp does not collapse whitespace). The index regex matches per
	// physical line, so the writer must flatten it to one line before
	// rendering the index entry — otherwise the body file is orphaned.
	_, _, err = w.WriteUserMemory(optimizer.MemoryEntry{
		Title:   "Prefer em-dashes\nwhen writing prose",
		Body:    "Some memory body.",
		MinerID: "mu-1",
		ScanID:  "scan-7",
	})
	if err != nil {
		t.Fatalf("write user memory: %v", err)
	}

	indexBytes, err := os.ReadFile(filepath.Join(st.UserMemoryDir(), "MEMORY.md"))
	if err != nil {
		t.Fatalf("read index: %v", err)
	}
	indexStr := string(indexBytes)
	// The prompt reader matches the [Title](file.md) link per physical line.
	// A wrapped title would leave the opening bracket on one line and the
	// `](file.md)` close on the next, orphaning the entry.
	var linkLine string
	for _, line := range strings.Split(indexStr, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "- [") {
			linkLine = line
			break
		}
	}
	if linkLine == "" || !strings.Contains(linkLine, "](") || !strings.Contains(linkLine, ".md)") {
		t.Fatalf("index entry was split across lines:\n%s", indexStr)
	}
	if !strings.Contains(linkLine, "- [Prefer em-dashes when writing prose](") {
		t.Fatalf("title not flattened to a single line:\n%s", linkLine)
	}
}

func TestMemoryWriterIndexOverflowSpillsToPending(t *testing.T) {
	root := t.TempDir()
	st, err := store.New(root)
	if err != nil {
		t.Fatal(err)
	}
	dir := st.UserMemoryDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Pre-seed an index that's already near the cap so the next append spills.
	preexisting := strings.Repeat("- [Old](old.md) — filler line\n", 60)
	if err := os.WriteFile(filepath.Join(dir, "MEMORY.md"), []byte(preexisting), 0o644); err != nil {
		t.Fatal(err)
	}

	w := &memoryWriter{store: st}
	bodyPath, indexFull, err := w.WriteUserMemory(optimizer.MemoryEntry{
		Title:   "New entry",
		Body:    "this should still land on disk",
		MinerID: "mu-99",
		ScanID:  "scan-1",
	})
	if err != nil {
		t.Fatalf("write user memory: %v", err)
	}
	if !indexFull {
		t.Fatalf("expected indexFull=true when MEMORY.md is over cap")
	}
	if _, err := os.Stat(bodyPath); err != nil {
		t.Fatalf("body file should be persisted even on overflow: %v", err)
	}
	pending, err := os.ReadFile(filepath.Join(dir, "MEMORY.md.pending"))
	if err != nil {
		t.Fatalf("pending index file should exist: %v", err)
	}
	if !strings.Contains(string(pending), "- [New entry](new-entry-scan-1-mu-99.md)") {
		t.Fatalf("pending index missing the deferred line:\n%s", string(pending))
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
