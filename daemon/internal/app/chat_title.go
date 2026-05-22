package app

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// ChatTitleSummarySentinel is the prompt prefix the summarizer uses so mock
// engines (and any other observer) can identify the title-summary call. The
// summarizer ships the prompt inline rather than via Agent.Instruction
// because Claude Code's `--append-system-prompt` adds to (not replaces) the
// default system prompt, and the default's "be helpful, answer the question"
// directive outranks a short title-only rule — so a user message like
// "hello, how's the weather" gets answered conversationally instead of
// summarized. Inline instruction in the prompt is harder to ignore.
const ChatTitleSummarySentinel = "Summarize the conversation title from the following: "

// chatTitleSummaryTimeout caps the one-shot summarization. The user has
// already seen the raw first-message fallback; we'd rather drop the
// upgrade than make them wait. Var (not const) so tests can shorten it.
var chatTitleSummaryTimeout = 30 * time.Second

// summarizeFirstUserMessageInputCap bounds how much of the user's first
// message is forwarded to the summarizer. Long pasted content past this
// cap rarely changes the title and only inflates token cost.
const summarizeFirstUserMessageInputCap = 4000

// runChatTitleSummarizer is the post-run hook that updates the chat title
// when the chat is on its first user turn and the user has not manually
// renamed it. Errors are intentionally swallowed: the existing raw-message
// title (set at CreateChat time, truncated by NormalizeChatTitle) is
// already a serviceable fallback.
func (a *App) runChatTitleSummarizer(chatID, agentID, firstUserMessage string) {
	if a == nil || a.engine == nil {
		return
	}
	chat, err := a.store.GetChat(chatID)
	if err != nil || chat.TitleSetByUser {
		return
	}
	if strings.TrimSpace(firstUserMessage) == "" {
		return
	}
	_ = a.summarizeChatTitle(chatID, agentID, firstUserMessage)
}

// summarizeChatTitle dispatches one short runtime call to derive a title
// and writes it back through applyAutoChatTitle. The call deliberately
// runs without any agent instruction, workdir, runtime env dir, or skills
// — the prompt itself carries the only instruction the runtime needs. On
// any failure the chat keeps the raw-user-message title set at create
// time.
func (a *App) summarizeChatTitle(chatID, agentID, firstUserMessage string) error {
	agent, err := a.store.GetAgent(agentID)
	if err != nil {
		return a.mapError(err)
	}
	runtimeRecord, err := a.store.GetRuntime(agent.RuntimeID)
	if err != nil {
		return a.mapError(err)
	}
	if runtimeRecord.Status == model.RuntimeStatusMissing {
		return errors.New("runtime missing")
	}

	userMessage := truncatePromptInput(firstUserMessage, summarizeFirstUserMessageInputCap)
	titlerAgent := model.AgentConfig{
		ID:        agent.ID,
		Name:      agent.Name,
		RuntimeID: agent.RuntimeID,
		Model:     agent.Model,
	}
	// Give the title call its own isolation shell (RuntimeEnvDir + WorkDir
	// scoped to a dedicated "-title" sibling of the agent's main dir).
	// Without this, prepareSkillEnvironment falls back to the user's host
	// config, so the title call inherits the host's MCP servers, tool
	// allowlists, and skills — and runs them under the runtimes that
	// hardcode bypass-permissions / --allow-all / --yolo, with user
	// content sitting directly in the prompt. Reusing the chat run's
	// RuntimeEnvDir would race the main turn on the shared claude-config
	// /skills tree (the original race this code was patched to dodge).
	titleEnvDir := a.store.RuntimeEnvTitleDir(agent.ID)

	ctx, cancel := context.WithTimeout(context.Background(), chatTitleSummaryTimeout)
	defer cancel()

	var collected strings.Builder
	_, err = a.engine.Run(ctx, runtime.RunRequest{
		Runtime:       runtimeRecord,
		Agent:         titlerAgent,
		Prompt:        ChatTitleSummarySentinel + userMessage,
		RuntimeEnvDir: titleEnvDir,
		WorkDir:       titleEnvDir,
	}, func(ev runtime.StreamEvent) error {
		if ev.Type == model.EventTypeMessage && ev.Message != nil &&
			ev.Message.Role == model.MessageRoleAssistant {
			collected.WriteString(ev.Message.Content)
		}
		return nil
	})
	if err != nil {
		return err
	}

	title := cleanRuntimeTitle(collected.String())
	if title == "" {
		return errors.New("empty title from runtime")
	}
	if _, _, err := a.applyAutoChatTitle(chatID, title); err != nil {
		return err
	}
	return nil
}

// cleanRuntimeTitle scrubs common artifacts from LLM title output: quotes,
// trailing punctuation, leading "Title:" labels. The result still passes
// through NormalizeChatTitle in applyAutoChatTitle.
func cleanRuntimeTitle(raw string) string {
	raw = strings.TrimSpace(raw)
	// Some backends prefix output with the literal "Title:" label.
	for _, prefix := range []string{"Title:", "TITLE:", "title:"} {
		if strings.HasPrefix(raw, prefix) {
			raw = strings.TrimSpace(strings.TrimPrefix(raw, prefix))
			break
		}
	}
	// Strip surrounding quotes or backticks if the model wrapped the title.
	raw = strings.Trim(raw, "\"'`")
	// Keep only the first non-empty line — defensive against the model
	// generating multiple candidate titles separated by newlines.
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			raw = line
			break
		}
	}
	// Drop trailing punctuation that NormalizeChatTitle wouldn't strip.
	raw = strings.TrimRight(raw, ".!?;,")
	return strings.TrimSpace(raw)
}

func truncatePromptInput(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:max]))
}
