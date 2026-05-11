package cli

import (
	"fmt"
	"io"
)

func printUsage(w io.Writer) {
	fmt.Fprint(w, `crewai-cli command format

Global:
  crewai-cli [--base-url http://127.0.0.1:8080] <command> ...

Commands:
  runtimes  list | rescan | get | update
  agents    list | create | get | update | archive | restore | set-skills
  skills    list | create | get | update | delete | files | put-file | delete-file
  projects  list | create | get | update | delete | chats
  chats     list | create | get | update | delete | events | cancel
  chat      interactive REPL; this is the only command that stays open

Examples:
  crewai-cli runtimes rescan
  crewai-cli agents create --name Aria --instruction "You are helpful" --runtime-id codex --model gpt-5.5
  crewai-cli projects create --name demo --workdir /tmp/demo --main-agent-id <agent-id>
  crewai-cli chats create --project-id <project-id> --title "Demo Chat" --main-agent-id <agent-id>
  crewai-cli chat --session <chat-id> --agent <agent-id>
  crewai-cli chat --project-id <project-id> --main-agent-id <agent-id> --title "CLI Chat"
`)
}

func usageError(format string, args ...any) error {
	return fmt.Errorf(format, args...)
}
