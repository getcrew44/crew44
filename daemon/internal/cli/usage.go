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

func printCommandUsage(w io.Writer, scope string) {
	switch scope {
	case "runtimes":
		fmt.Fprint(w, `Usage:
  crewai-cli runtimes [list]
  crewai-cli runtimes rescan
  crewai-cli runtimes get --id <runtime-id>
  crewai-cli runtimes update --id <runtime-id> [--name NAME] [--binary-path PATH] [--version VERSION]
`)
	case "agents":
		fmt.Fprint(w, `Usage:
  crewai-cli agents [list]
  crewai-cli agents create --name NAME --instruction TEXT --runtime-id RUNTIME --model MODEL
  crewai-cli agents get --id <agent-id>
  crewai-cli agents update --id <agent-id> [--name NAME] [--instruction TEXT] [--runtime-id RUNTIME] [--model MODEL]
  crewai-cli agents archive --id <agent-id>
  crewai-cli agents restore --id <agent-id>
  crewai-cli agents set-skills --id <agent-id> --skill-ids skill-a,skill-b
`)
	case "skills":
		fmt.Fprint(w, `Usage:
  crewai-cli skills [list]
  crewai-cli skills create --name NAME
  crewai-cli skills get --id <skill-id>
  crewai-cli skills update --id <skill-id> --name NAME
  crewai-cli skills delete --id <skill-id>
  crewai-cli skills files --id <skill-id>
  crewai-cli skills put-file --id <skill-id> [--file-id FILE] --content TEXT
  crewai-cli skills delete-file --id <skill-id> --file-id FILE
`)
	case "projects":
		fmt.Fprint(w, `Usage:
  crewai-cli projects [list]
  crewai-cli projects create --name NAME --workdir DIR [--main-agent-id AGENT]
  crewai-cli projects get --id <project-id>
  crewai-cli projects update --id <project-id> [--name NAME] [--workdir DIR] [--main-agent-id AGENT]
  crewai-cli projects delete --id <project-id>
  crewai-cli projects chats --id <project-id>
`)
	case "chats":
		fmt.Fprint(w, `Usage:
  crewai-cli chats [list] [--project-id <project-id>]
  crewai-cli chats create --project-id <project-id> --title TITLE --main-agent-id <agent-id>
  crewai-cli chats get --id <chat-id>
  crewai-cli chats update --id <chat-id> [--title TITLE] [--status STATUS]
  crewai-cli chats delete --id <chat-id>
  crewai-cli chats events --id <chat-id> [--after N]
  crewai-cli chats cancel --id <chat-id>
`)
	case "chat":
		fmt.Fprint(w, `Usage:
  crewai-cli chat --session <chat-id> [--agent <agent-id>]
  crewai-cli chat --project-id <project-id> --main-agent-id <agent-id> [--title TITLE] [--agent <agent-id>]
`)
	default:
		printUsage(w)
	}
}

type usageErr struct {
	scope   string
	message string
}

func (e usageErr) Error() string {
	return e.message
}

func newUsageError(scope, format string, args ...any) error {
	return usageErr{
		scope:   scope,
		message: fmt.Sprintf(format, args...),
	}
}
