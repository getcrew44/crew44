package cli

import (
	"io"
	"os"
)

type Context struct {
	Client *Client
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

func Run(args []string, stdin io.Reader, stdout, stderr io.Writer) error {
	global, rest, err := parseGlobalArgs(args)
	if err != nil {
		if usage, ok := err.(usageErr); ok {
			printCommandUsage(stderr, usage.scope)
		}
		return err
	}
	if global.help || len(rest) == 0 {
		printUsage(stdout)
		return nil
	}

	ctx := Context{
		Client: newClient(global.baseURL),
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
	}

	var runErr error
	switch rest[0] {
	case "runtimes":
		runErr = runRuntimes(ctx, rest[1:])
	case "agents":
		runErr = runAgents(ctx, rest[1:])
	case "skills":
		runErr = runSkills(ctx, rest[1:])
	case "projects":
		runErr = runProjects(ctx, rest[1:])
	case "chats":
		runErr = runChats(ctx, rest[1:])
	case "chat":
		runErr = runInteractiveChat(ctx, rest[1:])
	case "help":
		printUsage(stdout)
		return nil
	default:
		err := newUsageError("", "unknown command %q", rest[0])
		printUsage(stderr)
		return err
	}
	if usage, ok := runErr.(usageErr); ok {
		printCommandUsage(stderr, usage.scope)
	}
	return runErr
}

type globalArgs struct {
	baseURL string
	help    bool
}

func parseGlobalArgs(args []string) (globalArgs, []string, error) {
	out := globalArgs{
		baseURL: os.Getenv("CREWAI_BASE_URL"),
	}
	if out.baseURL == "" {
		out.baseURL = "http://127.0.0.1:8080"
	}

	rest := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--base-url":
			if i+1 >= len(args) {
				return globalArgs{}, nil, newUsageError("", "missing value for --base-url")
			}
			out.baseURL = args[i+1]
			i++
		case "--help", "-h":
			out.help = true
		default:
			rest = append(rest, args[i:]...)
			return out, rest, nil
		}
	}
	return out, rest, nil
}
