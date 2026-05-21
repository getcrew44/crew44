package agent

import (
	"context"
)

// qwenBackend runs the Qwen Code CLI (https://github.com/QwenLM/qwen-code).
// Qwen Code is a Gemini-CLI fork that ships the identical headless invocation
// (`qwen -p <prompt> --yolo -o stream-json -m <model> [-r <session>]`) and
// the same NDJSON event shape. Rather than duplicate the lifecycle goroutine
// and event parser, we delegate to geminiBackend with the label flipped to
// "qwen" so log lines / error messages name the right CLI.
type qwenBackend struct {
	cfg Config
}

func (b *qwenBackend) Execute(ctx context.Context, prompt string, opts ExecOptions) (*Session, error) {
	inner := &geminiBackend{
		cfg:        b.cfg,
		label:      "qwen",
		defaultBin: "qwen",
	}
	return inner.Execute(ctx, prompt, opts)
}
