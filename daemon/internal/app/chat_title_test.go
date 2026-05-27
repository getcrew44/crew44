package app

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

func TestCleanRuntimeTitleStripsCommonArtifacts(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"trims whitespace", "  Hello World  ", "Hello World"},
		{"removes surrounding double quotes", `"Hello World"`, "Hello World"},
		{"removes surrounding single quotes", `'Hello World'`, "Hello World"},
		{"removes surrounding backticks", "`Hello World`", "Hello World"},
		{"strips Title: prefix", "Title: Refactor login flow", "Refactor login flow"},
		{"strips lowercase title: prefix", "title: Refactor login flow", "Refactor login flow"},
		{"keeps only the first non-empty line", "First line\nSecond line\nThird", "First line"},
		{"trims trailing punctuation", "Refactor login flow.", "Refactor login flow"},
		{"handles empty input", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := cleanRuntimeTitle(tc.in); got != tc.want {
				t.Errorf("cleanRuntimeTitle(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestApplyAutoChatTitleSucceedsForUnlockedChat(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw user message verbatim", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	updated, changed, err := a.applyAutoChatTitle(chat.ID, "Refactor Login Flow")
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected applyAutoChatTitle to report a change")
	}
	if updated.Title != "Refactor Login Flow" {
		t.Fatalf("title = %q, want Refactor Login Flow", updated.Title)
	}
	if updated.TitleSetByUser {
		t.Fatal("auto-title should not flip TitleSetByUser")
	}
}

func TestApplyAutoChatTitleRespectsUserLock(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw user message", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	// Simulate a manual rename — this should lock the title.
	if _, err := a.UpdateChat(model.ChatRecord{ID: chat.ID, Title: "User Picked Title"}); err != nil {
		t.Fatal(err)
	}

	_, changed, err := a.applyAutoChatTitle(chat.ID, "LLM Suggested Title")
	if err != nil {
		t.Fatal(err)
	}
	if changed {
		t.Fatal("locked chat should reject auto-title")
	}
	got, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "User Picked Title" {
		t.Fatalf("title overwritten despite lock: %q", got.Title)
	}
}

func TestUpdateChatSetsTitleSetByUserFlag(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "first message", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if chat.TitleSetByUser {
		t.Fatal("newly created chat should not be flagged as user-titled")
	}

	updated, err := a.UpdateChat(model.ChatRecord{ID: chat.ID, Title: "Manual"})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.TitleSetByUser {
		t.Fatal("UpdateChat with non-empty Title should set TitleSetByUser=true")
	}
}

func TestUpdateChatWithoutTitleDoesNotFlipLock(t *testing.T) {
	a := newOptimizerTestApp(t)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "first message", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	// Update unrelated fields without touching Title.
	updated, err := a.UpdateChat(model.ChatRecord{ID: chat.ID, Status: "archived"})
	if err != nil {
		t.Fatal(err)
	}
	if updated.TitleSetByUser {
		t.Fatal("UpdateChat with empty Title should leave TitleSetByUser alone")
	}
}

// titleEngine implements runtime.Engine and returns a fixed assistant text
// response so the title summarizer can be tested without a real LLM. It
// counts invocations so tests can confirm exactly one summary call fires.
type titleEngine struct {
	response string
	calls    atomic.Int32
}

func (e *titleEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	e.calls.Add(1)
	// Branch on whether this is the title-summary call so the same engine
	// can serve both the main chat run and the post-run summarizer.
	if strings.HasPrefix(request.Prompt, ChatTitleSummarySentinel) {
		return runtime.RunResult{}, emit(runtime.StreamEvent{
			Type: model.EventTypeMessage,
			Message: &model.MessagePayload{
				Role:    model.MessageRoleAssistant,
				Content: e.response,
			},
		})
	}
	return runtime.RunResult{SessionID: "session"}, nil
}

func newTitleEngineApp(t *testing.T, engine *titleEngine) *App {
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
		Engine: engine,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func TestSummarizeChatTitleWritesCleanedTitleBack(t *testing.T) {
	engine := &titleEngine{response: `"Refactor Login Flow"`}
	a := newTitleEngineApp(t, engine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "Please refactor the login flow so it handles 401s", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if err := a.summarizeChatTitle(chat.ID, agentID, "Please refactor the login flow so it handles 401s"); err != nil {
		t.Fatalf("summarizeChatTitle: %v", err)
	}
	got, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Refactor Login Flow" {
		t.Fatalf("title = %q, want Refactor Login Flow (quotes stripped)", got.Title)
	}
}

type requestCapturingTitleEngine struct {
	response string
	request  runtime.RunRequest
}

func (e *requestCapturingTitleEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	e.request = request
	return runtime.RunResult{}, emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: e.response,
		},
	})
}

// TestSummarizeChatTitleUsesScopedRuntimeEnvDir locks in two constraints
// the title call has to satisfy together: (1) it must NOT share the chat
// run's RuntimeEnvDir — the original race that fired this code was both
// goroutines hitting writeSkillFiles on the same claude-config/skills
// tree, where concurrent RemoveAll/MkdirAll/WriteFile surfaced as
// "invalid argument" on macOS; (2) it MUST keep some isolation shell of
// its own so prepareSkillEnvironment doesn't fall back to the user's
// host config — without that, the title call inherits host MCP servers,
// tool allowlists, and skills and runs them under runtimes that
// hardcode bypass-permissions / --allow-all / --yolo, with user content
// embedded directly in the prompt (a textbook prompt-injection /
// privilege boundary). The dedicated "-title" sibling dir satisfies
// both: separate tree, still isolated, and AgentSkills stays empty so
// the call ships no tools-by-construction.
func TestSummarizeChatTitleUsesScopedRuntimeEnvDir(t *testing.T) {
	engine := &requestCapturingTitleEngine{response: "Optimize Designer Prompt"}
	a := newTitleEngineAppWith(t, engine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw first message", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if err := a.summarizeChatTitle(chat.ID, agentID, "raw first message"); err != nil {
		t.Fatalf("summarizeChatTitle: %v", err)
	}

	chatEnvDir := a.store.RuntimeEnvDir(agentID)
	titleEnvDir := a.store.RuntimeEnvTitleDir(agentID)

	if engine.request.RuntimeEnvDir == "" {
		t.Fatal("summary RuntimeEnvDir is empty — would fall back to host config and inherit MCP/allowlist/skill surface")
	}
	if engine.request.RuntimeEnvDir == chatEnvDir {
		t.Fatalf("summary RuntimeEnvDir = %q matches chat env dir — would race the chat run on the shared skills tree", engine.request.RuntimeEnvDir)
	}
	if engine.request.RuntimeEnvDir != titleEnvDir {
		t.Fatalf("summary RuntimeEnvDir = %q, want %q (dedicated title-scope dir)", engine.request.RuntimeEnvDir, titleEnvDir)
	}
	if engine.request.WorkDir == "" {
		t.Fatal("summary WorkDir is empty — fallback runtimes need a non-empty workdir to resolve their per-runtime skills dir")
	}
	if engine.request.WorkDir == project.Workdir {
		t.Fatalf("summary WorkDir = %q matches the project workdir — title call must not touch the user's project tree", engine.request.WorkDir)
	}
	if len(engine.request.AgentSkills) != 0 {
		t.Fatalf("summary AgentSkills = %d, want 0 (ship no tools by construction)", len(engine.request.AgentSkills))
	}
}

func TestRunChatTitleSummarizerSkipsLockedChats(t *testing.T) {
	engine := &titleEngine{response: "Should Not Be Written"}
	a := newTitleEngineApp(t, engine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw first message", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.UpdateChat(model.ChatRecord{ID: chat.ID, Title: "User Locked"}); err != nil {
		t.Fatal(err)
	}

	a.runChatTitleSummarizer(chat.ID, agentID, "raw first message")

	got, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "User Locked" {
		t.Fatalf("title overwritten despite lock: %q", got.Title)
	}
	if engine.calls.Load() != 0 {
		t.Fatalf("engine should not be invoked when title is locked, got %d calls", engine.calls.Load())
	}
}

func TestRunChatTitleSummarizerSkipsEmptyFirstMessage(t *testing.T) {
	engine := &titleEngine{response: "Anything"}
	a := newTitleEngineApp(t, engine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw first", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	a.runChatTitleSummarizer(chat.ID, agentID, "   ")

	if engine.calls.Load() != 0 {
		t.Fatalf("engine should not be invoked for empty input, got %d calls", engine.calls.Load())
	}
	got, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "raw first" {
		t.Fatalf("title mutated unexpectedly: %q", got.Title)
	}
}

// blockingChatEngine returns a quick title for the summarizer call and
// blocks on ctx.Done() for the main chat run. Used to prove the
// summarizer is not gated on the chat run completing.
type blockingChatEngine struct {
	titleResponse string
	chatStarted   chan struct{}
	startOnce     sync.Once
}

func (e *blockingChatEngine) Run(ctx context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	if strings.HasPrefix(request.Prompt, ChatTitleSummarySentinel) {
		return runtime.RunResult{}, emit(runtime.StreamEvent{
			Type: model.EventTypeMessage,
			Message: &model.MessagePayload{
				Role:    model.MessageRoleAssistant,
				Content: e.titleResponse,
			},
		})
	}
	e.startOnce.Do(func() { close(e.chatStarted) })
	<-ctx.Done()
	return runtime.RunResult{}, ctx.Err()
}

func TestPostMessageDispatchesTitleSummarizerInParallelWithChatRun(t *testing.T) {
	engine := &blockingChatEngine{
		titleResponse: "Refactor Login Flow",
		chatStarted:   make(chan struct{}),
	}
	a := newTitleEngineAppWith(t, engine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "Please refactor the login flow so it handles 401s", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := a.PostMessage(chat.ID, "Please refactor the login flow so it handles 401s", agentID, nil); err != nil {
		t.Fatalf("PostMessage: %v", err)
	}
	// Make sure the main chat run is genuinely in flight — without this,
	// the assertion below could pass by coincidence on a fast machine.
	select {
	case <-engine.chatStarted:
	case <-time.After(2 * time.Second):
		t.Fatal("blocking chat engine never started — fixture is broken")
	}

	deadline := time.After(2 * time.Second)
	for {
		got, err := a.store.GetChat(chat.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Title == "Refactor Login Flow" {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("title was not summarized while chat run was still in flight: %q", got.Title)
		case <-time.After(20 * time.Millisecond):
		}
	}

	// Release the blocked chat run so the test cleanup doesn't leak the goroutine.
	if err := a.CancelChat(chat.ID); err != nil {
		t.Logf("CancelChat: %v", err)
	}
}

func TestSummarizeChatTitleHonorsTimeout(t *testing.T) {
	// Sanity check: the helper is bounded by chatTitleSummaryTimeout
	// rather than spinning forever when the engine never replies. We
	// shrink the cap to keep the test under a second and assert the
	// helper returns within the (shortened) bound.
	prev := chatTitleSummaryTimeout
	chatTitleSummaryTimeout = 100 * time.Millisecond
	t.Cleanup(func() { chatTitleSummaryTimeout = prev })

	stuckEngine := stuckEngineFn(func(ctx context.Context, _ runtime.RunRequest, _ func(runtime.StreamEvent) error) (runtime.RunResult, error) {
		<-ctx.Done()
		return runtime.RunResult{}, ctx.Err()
	})
	a := newTitleEngineAppWith(t, stuckEngine)
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChat(project.ID, "raw", agentID, nil, "")
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() {
		_ = a.summarizeChatTitle(chat.ID, agentID, "Please summarize me")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("summarizeChatTitle did not honor its own context timeout")
	}
}

type stuckEngineFn func(ctx context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error)

func (f stuckEngineFn) Run(ctx context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	return f(ctx, request, emit)
}

func newTitleEngineAppWith(t *testing.T, engine runtime.Engine) *App {
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
		Engine: engine,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}
