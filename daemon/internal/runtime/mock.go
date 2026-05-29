package runtime

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

type RunRequest struct {
	Runtime         model.RuntimeRecord
	Agent           model.AgentConfig
	AgentSkills     []SkillContext
	Prompt          string
	WorkDir         string
	RuntimeEnvDir   string
	ResumeSessionID string
	// AgentSourceDir is the installed repo payload directory for a
	// recruited agent (see model.AgentSource.SourceDir). When set, the
	// runtime exposes it as CREW44_AGENT_SOURCE_DIR so the spawned
	// process can read upstream/, docs/, examples/ and other reference
	// material the recruit installer copied alongside SKILL.md files.
	// Empty for non-recruited agents.
	AgentSourceDir string
	// EnableBrowserMCP opts this runtime into the injected Playwright headless
	// browser. Off by default: utility calls (e.g. the chat-title summarizer)
	// run on untrusted user content under bypass-permissions, so they must not
	// gain an auto-invokable browser. Only the main interactive chat run sets
	// this true.
	EnableBrowserMCP bool
}

type SkillContext struct {
	ID      string
	Name    string
	Content string
	Files   []SkillFileContext
}

type SkillFileContext struct {
	Path    string
	Content string
}

type StreamEvent struct {
	Type           model.EventType
	Message        *model.MessagePayload
	Thinking       *model.ThinkingPayload
	ToolCall       *model.ToolCallPayload
	ToolCallResult *model.ToolCallResultPayload
	RuntimeSession *model.RuntimeSessionPayload
}

type RunResult struct {
	SessionID string
}

type Scanner interface {
	Scan(ctx context.Context) ([]model.RuntimeRecord, error)
}

type Engine interface {
	Run(ctx context.Context, request RunRequest, emit func(StreamEvent) error) (RunResult, error)
}

type MockEngine struct{}

type StaticScanner struct {
	Records []model.RuntimeRecord
}

func (s StaticScanner) Scan(context.Context) ([]model.RuntimeRecord, error) {
	out := make([]model.RuntimeRecord, len(s.Records))
	copy(out, s.Records)
	return out, nil
}

// MockChatTitleSummarySentinel mirrors the title-summary prompt prefix
// exported by the app package. Duplicated as a string literal so mock
// engines can identify summarizer calls without taking a dependency on
// the app package (which would introduce an import cycle).
const MockChatTitleSummarySentinel = "Summarize the conversation title from the following: "

func (MockEngine) Run(ctx context.Context, request RunRequest, emit func(StreamEvent) error) (RunResult, error) {
	// Title-summary calls reuse the engine. The mock returns silently so
	// the chat's title stays whatever createChat set (usually the raw
	// first message), which is what existing tests assert against.
	if strings.HasPrefix(request.Prompt, MockChatTitleSummarySentinel) {
		return RunResult{}, nil
	}
	if err := emit(StreamEvent{
		Type: model.EventTypeThinking,
		Thinking: &model.ThinkingPayload{
			Content: "mock runtime thinking",
		},
	}); err != nil {
		return RunResult{}, err
	}

	if strings.Contains(request.Prompt, "/slow") {
		select {
		case <-time.After(150 * time.Millisecond):
		case <-ctx.Done():
			return RunResult{}, ctx.Err()
		}
	}

	if strings.Contains(request.Prompt, "/tool") {
		if err := emit(StreamEvent{
			Type: model.EventTypeMessage,
			Message: &model.MessagePayload{
				Role:    model.MessageRoleAssistant,
				Content: "checking tool",
			},
		}); err != nil {
			return RunResult{}, err
		}
		if err := emit(StreamEvent{
			Type: model.EventTypeToolCall,
			ToolCall: &model.ToolCallPayload{
				CallID: "mock-search-1",
				Name:   "mock.search",
				Input:  map[string]any{"prompt": cleanPrompt(request.Prompt)},
			},
		}); err != nil {
			return RunResult{}, err
		}
		if err := emit(StreamEvent{
			Type: model.EventTypeToolCallResult,
			ToolCallResult: &model.ToolCallResultPayload{
				CallID: "mock-search-1",
				Name:   "mock.search",
				Output: "ok",
			},
		}); err != nil {
			return RunResult{}, err
		}
	}

	content := strings.TrimSpace(cleanPrompt(request.Prompt))
	if content == "" {
		content = fmt.Sprintf("handoff received by %s", request.Agent.Name)
	}
	content = fmt.Sprintf("%s reply: %s", request.Agent.Name, content)
	if target := extractDirectiveValue(request.Prompt, "/handover:"); target != "" {
		content += "\n<CREW44_AGENT_HANDOVER agent_id=\"" + target + "\">Continue the user's request.</CREW44_AGENT_HANDOVER>"
	}
	if err := emit(StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: content,
		},
	}); err != nil {
		return RunResult{}, err
	}

	sessionID := request.ResumeSessionID
	if sessionID == "" {
		sessionID = id.New()
	}
	return RunResult{SessionID: sessionID}, nil
}

func cleanPrompt(prompt string) string {
	parts := strings.Fields(prompt)
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "/slow" || part == "/tool" || strings.HasPrefix(part, "/handover:") {
			continue
		}
		out = append(out, part)
	}
	return strings.Join(out, " ")
}

func extractDirectiveValue(prompt, prefix string) string {
	for _, part := range strings.Fields(prompt) {
		if strings.HasPrefix(part, prefix) {
			return strings.TrimPrefix(part, prefix)
		}
	}
	return ""
}
