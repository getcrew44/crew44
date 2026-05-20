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

func (MockEngine) Run(ctx context.Context, request RunRequest, emit func(StreamEvent) error) (RunResult, error) {
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
