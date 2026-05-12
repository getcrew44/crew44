package cli

import (
	"flag"
	"strings"
)

func runRuntimes(ctx Context, args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var resp any
		if err := ctx.Client.Get("/api/runtimes", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "rescan":
		var resp any
		if err := ctx.Client.Post("/api/runtimes/rescan", map[string]any{}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "get":
		fs := newFlagSet("runtimes get", ctx)
		id := fs.String("id", "", "runtime id")
		if err := parseFlags(fs, args[1:], "runtimes"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("runtimes", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/runtimes/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "update":
		fs := newFlagSet("runtimes update", ctx)
		id := fs.String("id", "", "runtime id")
		name := fs.String("name", "", "runtime display name")
		binaryPath := fs.String("binary-path", "", "runtime executable path")
		version := fs.String("version", "", "runtime version")
		if err := parseFlags(fs, args[1:], "runtimes"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("runtimes", "missing --id")
		}
		body := map[string]any{}
		if *name != "" {
			body["name"] = *name
		}
		if *binaryPath != "" {
			body["binary_path"] = *binaryPath
		}
		if *version != "" {
			body["version"] = *version
		}
		var resp any
		if err := ctx.Client.Post("/api/runtimes/"+*id+"/update", body, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	default:
		return newUsageError("runtimes", "unknown runtimes subcommand %q", args[0])
	}
}

func runAgents(ctx Context, args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var resp any
		if err := ctx.Client.Get("/api/agents", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "create":
		fs := newFlagSet("agents create", ctx)
		name := fs.String("name", "", "agent name")
		instruction := fs.String("instruction", "", "agent instruction")
		runtimeID := fs.String("runtime-id", "", "runtime id")
		model := fs.String("model", "", "model name")
		if err := parseFlags(fs, args[1:], "agents"); err != nil {
			return err
		}
		body := map[string]any{
			"name":        *name,
			"instruction": *instruction,
			"runtime_id":  *runtimeID,
			"model":       *model,
		}
		var resp any
		if err := ctx.Client.Post("/api/agents", body, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "get":
		fs := newFlagSet("agents get", ctx)
		id := fs.String("id", "", "agent id")
		if err := parseFlags(fs, args[1:], "agents"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("agents", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/agents/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "update":
		fs := newFlagSet("agents update", ctx)
		id := fs.String("id", "", "agent id")
		name := fs.String("name", "", "agent name")
		instruction := fs.String("instruction", "", "agent instruction")
		runtimeID := fs.String("runtime-id", "", "runtime id")
		model := fs.String("model", "", "model name")
		if err := parseFlags(fs, args[1:], "agents"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("agents", "missing --id")
		}
		body := map[string]any{"id": *id}
		if *name != "" {
			body["name"] = *name
		}
		if *instruction != "" {
			body["instruction"] = *instruction
		}
		if *runtimeID != "" {
			body["runtime_id"] = *runtimeID
		}
		if *model != "" {
			body["model"] = *model
		}
		var resp any
		if err := ctx.Client.Put("/api/agents/"+*id, body, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "archive":
		return runSimpleAgentAction(ctx, args[1:], "archive", "/archive")
	case "restore":
		return runSimpleAgentAction(ctx, args[1:], "restore", "/restore")
	case "set-skills":
		fs := newFlagSet("agents set-skills", ctx)
		id := fs.String("id", "", "agent id")
		skillIDs := fs.String("skill-ids", "", "comma-separated skill ids")
		if err := parseFlags(fs, args[1:], "agents"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("agents", "missing --id")
		}
		body := map[string]any{
			"skill_ids": splitCSV(*skillIDs),
		}
		var resp any
		if err := ctx.Client.Put("/api/agents/"+*id+"/skills", body, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	default:
		return newUsageError("agents", "unknown agents subcommand %q", args[0])
	}
}

func runSkills(ctx Context, args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var resp any
		if err := ctx.Client.Get("/api/skills", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "create":
		fs := newFlagSet("skills create", ctx)
		name := fs.String("name", "", "skill name")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		var resp any
		if err := ctx.Client.Post("/api/skills", map[string]any{"name": *name}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "get":
		fs := newFlagSet("skills get", ctx)
		id := fs.String("id", "", "skill id")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("skills", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/skills/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "update":
		fs := newFlagSet("skills update", ctx)
		id := fs.String("id", "", "skill id")
		name := fs.String("name", "", "skill name")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("skills", "missing --id")
		}
		var resp any
		if err := ctx.Client.Put("/api/skills/"+*id, map[string]any{"name": *name}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "delete":
		fs := newFlagSet("skills delete", ctx)
		id := fs.String("id", "", "skill id")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("skills", "missing --id")
		}
		var resp any
		if err := ctx.Client.Delete("/api/skills/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "files":
		fs := newFlagSet("skills files", ctx)
		id := fs.String("id", "", "skill id")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("skills", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/skills/"+*id+"/files", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "put-file":
		fs := newFlagSet("skills put-file", ctx)
		id := fs.String("id", "", "skill id")
		fileID := fs.String("file-id", "SKILL.md", "skill file id")
		content := fs.String("content", "", "file content")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("skills", "missing --id")
		}
		var resp any
		if err := ctx.Client.Put("/api/skills/"+*id+"/files", map[string]any{
			"file_id": *fileID,
			"content": *content,
		}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "delete-file":
		fs := newFlagSet("skills delete-file", ctx)
		id := fs.String("id", "", "skill id")
		fileID := fs.String("file-id", "", "skill file id")
		if err := parseFlags(fs, args[1:], "skills"); err != nil {
			return err
		}
		if *id == "" || *fileID == "" {
			return newUsageError("skills", "missing --id or --file-id")
		}
		var resp any
		if err := ctx.Client.Delete("/api/skills/"+*id+"/files/"+*fileID, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	default:
		return newUsageError("skills", "unknown skills subcommand %q", args[0])
	}
}

func runProjects(ctx Context, args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		var resp any
		if err := ctx.Client.Get("/api/projects", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "create":
		fs := newFlagSet("projects create", ctx)
		name := fs.String("name", "", "project name")
		workdir := fs.String("workdir", "", "project workdir")
		mainAgentID := fs.String("main-agent-id", "", "main agent id")
		if err := parseFlags(fs, args[1:], "projects"); err != nil {
			return err
		}
		var resp any
		if err := ctx.Client.Post("/api/projects", map[string]any{
			"name":          *name,
			"workdir":       *workdir,
			"main_agent_id": *mainAgentID,
		}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "get":
		fs := newFlagSet("projects get", ctx)
		id := fs.String("id", "", "project id")
		if err := parseFlags(fs, args[1:], "projects"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("projects", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/projects/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "update":
		fs := newFlagSet("projects update", ctx)
		id := fs.String("id", "", "project id")
		name := fs.String("name", "", "project name")
		workdir := fs.String("workdir", "", "project workdir")
		mainAgentID := fs.String("main-agent-id", "", "main agent id")
		if err := parseFlags(fs, args[1:], "projects"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("projects", "missing --id")
		}
		var resp any
		if err := ctx.Client.Put("/api/projects/"+*id, map[string]any{
			"id":            *id,
			"name":          *name,
			"workdir":       *workdir,
			"main_agent_id": *mainAgentID,
		}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "delete":
		fs := newFlagSet("projects delete", ctx)
		id := fs.String("id", "", "project id")
		if err := parseFlags(fs, args[1:], "projects"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("projects", "missing --id")
		}
		var resp any
		if err := ctx.Client.Delete("/api/projects/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "chats":
		fs := newFlagSet("projects chats", ctx)
		id := fs.String("id", "", "project id")
		if err := parseFlags(fs, args[1:], "projects"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("projects", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/projects/"+*id+"/chats", &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	default:
		return newUsageError("projects", "unknown projects subcommand %q", args[0])
	}
}

func runChats(ctx Context, args []string) error {
	if len(args) == 0 {
		args = []string{"list"}
	}
	switch args[0] {
	case "list":
		fs := newFlagSet("chats list", ctx)
		projectID := fs.String("project-id", "", "project id filter")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		path := "/api/chat/sessions"
		if *projectID != "" {
			path += "?project_id=" + *projectID
		}
		var resp any
		if err := ctx.Client.Get(path, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "create":
		fs := newFlagSet("chats create", ctx)
		projectID := fs.String("project-id", "", "project id")
		title := fs.String("title", "", "chat title")
		mainAgentID := fs.String("main-agent-id", "", "main agent id")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		var resp any
		if err := ctx.Client.Post("/api/chat/sessions", map[string]any{
			"project_id":    *projectID,
			"title":         *title,
			"main_agent_id": *mainAgentID,
		}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "get":
		fs := newFlagSet("chats get", ctx)
		id := fs.String("id", "", "chat id")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("chats", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/chat/sessions/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "update":
		fs := newFlagSet("chats update", ctx)
		id := fs.String("id", "", "chat id")
		title := fs.String("title", "", "chat title")
		status := fs.String("status", "", "chat status")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("chats", "missing --id")
		}
		var resp any
		if err := ctx.Client.Put("/api/chat/sessions/"+*id, map[string]any{
			"id":     *id,
			"title":  *title,
			"status": *status,
		}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "delete":
		fs := newFlagSet("chats delete", ctx)
		id := fs.String("id", "", "chat id")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("chats", "missing --id")
		}
		var resp any
		if err := ctx.Client.Delete("/api/chat/sessions/"+*id, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "events":
		fs := newFlagSet("chats events", ctx)
		id := fs.String("id", "", "chat id")
		after := fs.Int64("after", 0, "event sequence lower bound")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("chats", "missing --id")
		}
		var resp any
		if err := ctx.Client.Get("/api/chat/sessions/"+*id+"/events?after="+formatInt(*after), &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	case "cancel":
		fs := newFlagSet("chats cancel", ctx)
		id := fs.String("id", "", "chat id")
		if err := parseFlags(fs, args[1:], "chats"); err != nil {
			return err
		}
		if *id == "" {
			return newUsageError("chats", "missing --id")
		}
		var resp any
		if err := ctx.Client.Post("/api/chat/sessions/"+*id+"/cancel", map[string]any{}, &resp); err != nil {
			return err
		}
		return printJSON(ctx.Stdout, resp)
	default:
		return newUsageError("chats", "unknown chats subcommand %q", args[0])
	}
}

func newFlagSet(name string, ctx Context) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(ctx.Stderr)
	return fs
}

func runSimpleAgentAction(ctx Context, args []string, name, suffix string) error {
	fs := newFlagSet("agents "+name, ctx)
	id := fs.String("id", "", "agent id")
	if err := parseFlags(fs, args, "agents"); err != nil {
		return err
	}
	if *id == "" {
		return newUsageError("agents", "missing --id")
	}
	var resp any
	if err := ctx.Client.Post("/api/agents/"+*id+suffix, map[string]any{}, &resp); err != nil {
		return err
	}
	return printJSON(ctx.Stdout, resp)
}

func parseFlags(fs *flag.FlagSet, args []string, scope string) error {
	if err := fs.Parse(args); err != nil {
		return newUsageError(scope, "%s", err.Error())
	}
	return nil
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{}
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}
