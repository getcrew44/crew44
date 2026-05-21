package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"time"
)

// geminiBackend implements Backend by spawning the Google Gemini CLI
// with `--output-format stream-json` and parsing its NDJSON event stream.
//
// label / defaultBin are normally empty (the Gemini defaults apply). The
// fields exist so Qwen Code — which is a Gemini-CLI fork that ships the
// identical -p / --yolo / -o stream-json / -m / -r argv and stream-json
// event shape — can reuse this whole implementation by setting them to
// "qwen". Other forks can plug in the same way.
type geminiBackend struct {
	cfg        Config
	label      string // log/error label; defaults to "gemini" via b.name()
	defaultBin string // PATH lookup name; defaults to "gemini" via b.bin()
}

func (b *geminiBackend) name() string {
	if b.label != "" {
		return b.label
	}
	return "gemini"
}

func (b *geminiBackend) bin() string {
	if b.defaultBin != "" {
		return b.defaultBin
	}
	return "gemini"
}

func (b *geminiBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	execPath := b.cfg.ExecutablePath
	if execPath == "" {
		execPath = b.bin()
	}
	if _, err := exec.LookPath(execPath); err != nil {
		return nil, fmt.Errorf("%s executable not found at %q: %w", b.name(), execPath, err)
	}

	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 20 * time.Minute
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)

	args := buildGeminiArgs(prompt, opts, b.cfg.Logger)

	cmd := exec.CommandContext(runCtx, execPath, args...)
	hideAgentWindow(cmd)
	b.cfg.Logger.Info("agent command", "exec", execPath, "args", args)
	cmd.WaitDelay = 10 * time.Second
	if opts.Cwd != "" {
		cmd.Dir = opts.Cwd
	}
	cmd.Env = buildEnv(b.cfg.Env)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("%s stdout pipe: %w", b.name(), err)
	}
	cmd.Stderr = newLogWriter(b.cfg.Logger, "["+b.name()+":stderr] ")

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("start %s: %w", b.name(), err)
	}

	b.cfg.Logger.Info(b.name()+" started", "pid", cmd.Process.Pid, "cwd", opts.Cwd, "model", opts.Model)

	msgCh := make(chan Message, 256)
	resCh := make(chan Result, 1)

	// Close stdout when the context is cancelled so scanner.Scan() unblocks.
	go func() {
		<-runCtx.Done()
		_ = stdout.Close()
	}()

	go func() {
		defer cancel()
		defer close(msgCh)
		defer close(resCh)

		startTime := time.Now()
		var output strings.Builder
		var sessionID string
		finalStatus := "completed"
		var finalError string
		usage := make(map[string]TokenUsage)

		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 0, 1024*1024), 10*1024*1024)

		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}

			var evt geminiStreamEvent
			if err := json.Unmarshal([]byte(line), &evt); err != nil {
				continue
			}

			switch evt.Type {
			case "init":
				sessionID = evt.SessionID
				trySend(msgCh, Message{Type: MessageStatus, Status: "running"})

			case "message":
				if evt.Role == "assistant" && evt.Content != "" {
					output.WriteString(evt.Content)
					trySend(msgCh, Message{Type: MessageText, Content: evt.Content})
				}

			case "tool_use":
				var params map[string]any
				if evt.Parameters != nil {
					_ = json.Unmarshal(evt.Parameters, &params)
				}
				trySend(msgCh, Message{
					Type:   MessageToolUse,
					Tool:   evt.ToolName,
					CallID: evt.ToolID,
					Input:  params,
				})

			case "tool_result":
				trySend(msgCh, Message{
					Type:   MessageToolResult,
					CallID: evt.ToolID,
					Output: evt.Output,
				})

			case "error":
				trySend(msgCh, Message{
					Type:    MessageError,
					Content: evt.Message,
				})

			case "result":
				if evt.Status == "error" && evt.Error != nil {
					finalStatus = "failed"
					finalError = evt.Error.Message
				}
				if evt.Stats != nil {
					b.accumulateUsage(usage, evt.Stats)
				}
			}
		}

		waitErr := cmd.Wait()
		duration := time.Since(startTime)

		if runCtx.Err() == context.DeadlineExceeded {
			finalStatus = "timeout"
			finalError = fmt.Sprintf("%s timed out after %s", b.name(), timeout)
		} else if runCtx.Err() == context.Canceled {
			finalStatus = "aborted"
			finalError = "execution cancelled"
		} else if waitErr != nil && finalStatus == "completed" {
			finalStatus = "failed"
			finalError = fmt.Sprintf("%s exited with error: %v", b.name(), waitErr)
		}

		b.cfg.Logger.Info(b.name()+" finished", "pid", cmd.Process.Pid, "status", finalStatus, "duration", duration.Round(time.Millisecond).String())

		resCh <- Result{
			Status:     finalStatus,
			Output:     output.String(),
			Error:      finalError,
			DurationMs: duration.Milliseconds(),
			SessionID:  sessionID,
			Usage:      usage,
		}
	}()

	return &Session{Messages: msgCh, Result: resCh}, nil
}

// accumulateUsage extracts per-model token usage from Gemini's result stats.
func (b *geminiBackend) accumulateUsage(usage map[string]TokenUsage, stats *geminiStreamStats) {
	for model, m := range stats.Models {
		u := usage[model]
		u.InputTokens += int64(m.InputTokens)
		u.OutputTokens += int64(m.OutputTokens)
		u.CacheReadTokens += int64(m.Cached)
		usage[model] = u
	}
}

// ── Gemini stream-json event types ──

type geminiStreamEvent struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Model     string `json:"model,omitempty"`

	// message fields
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
	Delta   bool   `json:"delta,omitempty"`

	// tool_use fields
	ToolName   string          `json:"tool_name,omitempty"`
	ToolID     string          `json:"tool_id,omitempty"`
	Parameters json.RawMessage `json:"parameters,omitempty"`

	// tool_result fields
	Status string `json:"status,omitempty"`
	Output string `json:"output,omitempty"`

	// error fields
	Severity string `json:"severity,omitempty"`
	Message  string `json:"message,omitempty"`

	// result fields
	Error *geminiStreamError `json:"error,omitempty"`
	Stats *geminiStreamStats `json:"stats,omitempty"`
}

type geminiStreamError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

type geminiStreamStats struct {
	TotalTokens  int                         `json:"total_tokens"`
	InputTokens  int                         `json:"input_tokens"`
	OutputTokens int                         `json:"output_tokens"`
	DurationMs   int                         `json:"duration_ms"`
	ToolCalls    int                         `json:"tool_calls"`
	Models       map[string]geminiModelStats `json:"models,omitempty"`
}

type geminiModelStats struct {
	TotalTokens  int `json:"total_tokens"`
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	Cached       int `json:"cached"`
}

// ── Arg builder ──

// buildGeminiArgs assembles the argv for a one-shot gemini invocation.
//
// Flags:
//
//	-p / --prompt         non-interactive prompt (the user's task)
//	--yolo                auto-approve all tool executions
//	-o stream-json        streaming NDJSON output for live events
//	-m <model>            optional model override
//	-r <session>          resume a previous session (if provided)
//
// geminiBlockedArgs are flags hardcoded by the daemon that must not be
// overridden by user-configured custom_args.
var geminiBlockedArgs = map[string]blockedArgMode{
	"-p":     blockedWithValue,  // non-interactive prompt
	"--yolo": blockedStandalone, // auto-approve tool use
	"-o":     blockedWithValue,  // stream-json output format
}

func buildGeminiArgs(prompt string, opts ExecOptions, logger *slog.Logger) []string {
	args := []string{
		"-p", prompt,
		"--yolo",
		"-o", "stream-json",
	}
	if opts.Model != "" {
		args = append(args, "-m", opts.Model)
	}
	if opts.ResumeSessionID != "" {
		args = append(args, "-r", opts.ResumeSessionID)
	}
	args = append(args, filterCustomArgs(opts.CustomArgs, geminiBlockedArgs, logger)...)
	return args
}
