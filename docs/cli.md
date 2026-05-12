# crewai-cli

`crewai-cli` is a backend API client for local terminal use. It talks to the
running CrewAI daemon over HTTP. By default it targets:

```bash
http://127.0.0.1:8080
```

Override that with:

```bash
crewai-cli --base-url http://127.0.0.1:18766 ...
```

Or:

```bash
CREWAI_BASE_URL=http://127.0.0.1:18766 crewai-cli ...
```

## Command Shape

All commands except `chat` are one-shot commands that print JSON and exit.

```bash
crewai-cli [--base-url URL] <group> <action> [flags...]
```

Groups:

- `runtimes`
- `agents`
- `skills`
- `projects`
- `chats`
- `chat`

## One-Shot Commands

### runtimes

```bash
crewai-cli runtimes list
crewai-cli runtimes rescan
crewai-cli runtimes get --id codex
crewai-cli runtimes update --id codex --name "Codex Local"
```

### agents

```bash
crewai-cli agents list
crewai-cli agents create --name Aria --instruction "You are helpful" --runtime-id codex --model gpt-5.5
crewai-cli agents get --id <agent-id>
crewai-cli agents update --id <agent-id> --name "Aria Updated"
crewai-cli agents archive --id <agent-id>
crewai-cli agents restore --id <agent-id>
crewai-cli agents set-skills --id <agent-id> --skill-ids <skill-a>,<skill-b>
```

### skills

```bash
crewai-cli skills list
crewai-cli skills create --name "Core Skill"
crewai-cli skills get --id <skill-id>
crewai-cli skills update --id <skill-id> --name "Core Skill Updated"
crewai-cli skills delete --id <skill-id>
crewai-cli skills files --id <skill-id>
crewai-cli skills put-file --id <skill-id> --file-id notes.md --content "hello"
crewai-cli skills delete-file --id <skill-id> --file-id notes.md
```

### projects

```bash
crewai-cli projects list
crewai-cli projects create --name demo --workdir /tmp/demo --main-agent-id <agent-id>
crewai-cli projects get --id <project-id>
crewai-cli projects update --id <project-id> --name "demo-2" --workdir /tmp/demo2
crewai-cli projects delete --id <project-id>
crewai-cli projects chats --id <project-id>
```

### chats

```bash
crewai-cli chats list
crewai-cli chats list --project-id <project-id>
crewai-cli chats create --project-id <project-id> --title "Demo Chat" --main-agent-id <agent-id>
crewai-cli chats get --id <chat-id>
crewai-cli chats update --id <chat-id> --title "Renamed Chat" --status active
crewai-cli chats delete --id <chat-id>
crewai-cli chats events --id <chat-id> --after 0
crewai-cli chats cancel --id <chat-id>
```

## Interactive chat

`chat` is the only long-lived command. It starts a terminal REPL.

Use an existing chat:

```bash
crewai-cli chat --session <chat-id> --agent <agent-id>
```

Or create a chat and enter it immediately:

```bash
crewai-cli chat --project-id <project-id> --main-agent-id <agent-id> --title "CLI Chat"
```

Inside the REPL:

- type plain text to send a message
- `/agent <agent-id>` switches the target agent for future turns
- `/show` fetches and prints the latest chat record
- `/cancel` calls the cancel API
- `/quit` or `/exit` leaves the REPL

The REPL prints streamed events from the backend:

- assistant messages as plain text
- `thinking` events with a prefix
- tool calls/results with a prefix
