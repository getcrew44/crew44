package runtime

import (
	"context"
	"errors"
	"fmt"
	"strings"

	backendagent "github.com/sqtech/crew-ai/crewai-repo/internal/backendagent"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

type RealEngine struct{}

func (RealEngine) Run(ctx context.Context, request RunRequest, emit func(StreamEvent) error) (RunResult, error) {
	preparedEnv, err := prepareSkillEnvironment(request)
	if err != nil {
		return RunResult{}, err
	}
	backend, err := backendagent.New(request.Runtime.Provider, backendagent.Config{
		ExecutablePath: request.Runtime.BinaryPath,
		Env:            preparedEnv.Env,
	})
	if err != nil {
		return RunResult{}, err
	}

	systemPrompt := strings.TrimSpace(request.Agent.Instruction)

	modelName := request.Agent.Model
	if modelName == "" && request.Runtime.Metadata != nil {
		if value, ok := request.Runtime.Metadata["model"].(string); ok {
			modelName = value
		}
	}

	session, err := backend.Execute(ctx, request.Prompt, backendagent.ExecOptions{
		Cwd:             request.WorkDir,
		Model:           modelName,
		SystemPrompt:    systemPrompt,
		ResumeSessionID: request.ResumeSessionID,
		ExtraArgs:       preparedEnv.ExtraArgs,
	})
	if err != nil {
		return RunResult{}, err
	}

	for {
		select {
		case <-ctx.Done():
			return RunResult{}, ctx.Err()
		case msg, ok := <-session.Messages:
			if !ok {
				session.Messages = nil
				continue
			}
			event, ok := mapAgentMessage(msg, request.Runtime)
			if !ok {
				continue
			}
			if err := emit(event); err != nil {
				return RunResult{}, err
			}
		case result, ok := <-session.Result:
			if !ok {
				return RunResult{}, fmt.Errorf("runtime closed without a result")
			}
			if result.Status == "failed" || result.Status == "timeout" {
				if result.Error != "" {
					return RunResult{}, errors.New(result.Error)
				}
				return RunResult{}, fmt.Errorf("runtime execution failed")
			}
			if result.Status == "aborted" || result.Status == "cancelled" {
				if result.Error != "" {
					return RunResult{}, context.Canceled
				}
				return RunResult{}, context.Canceled
			}
			return RunResult{SessionID: result.SessionID}, nil
		}
	}
}

func mapAgentMessage(msg backendagent.Message, runtimeRecord model.RuntimeRecord) (StreamEvent, bool) {
	switch msg.Type {
	case backendagent.MessageText:
		return StreamEvent{
			Type: model.EventTypeMessage,
			Message: &model.MessagePayload{
				Role:    model.MessageRoleAssistant,
				Content: msg.Content,
			},
		}, true
	case backendagent.MessageThinking:
		return StreamEvent{
			Type: model.EventTypeThinking,
			Thinking: &model.ThinkingPayload{
				Content: msg.Content,
			},
		}, true
	case backendagent.MessageToolUse:
		return StreamEvent{
			Type: model.EventTypeToolCall,
			ToolCall: &model.ToolCallPayload{
				Name:  msg.Tool,
				Input: msg.Input,
			},
		}, true
	case backendagent.MessageToolResult:
		return StreamEvent{
			Type: model.EventTypeToolCallResult,
			ToolCallResult: &model.ToolCallResultPayload{
				Name:   msg.Tool,
				Output: msg.Output,
			},
		}, true
	case backendagent.MessageStatus:
		if msg.SessionID == "" {
			return StreamEvent{}, false
		}
		return StreamEvent{
			Type: model.EventTypeRuntimeSession,
			RuntimeSession: &model.RuntimeSessionPayload{
				RuntimeID: runtimeRecord.ID,
				Provider:  runtimeRecord.Provider,
				SessionID: msg.SessionID,
				Status:    msg.Status,
			},
		}, true
	default:
		return StreamEvent{}, false
	}
}
