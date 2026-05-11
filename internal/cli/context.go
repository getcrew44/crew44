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

	switch rest[0] {
	case "runtimes":
		return runRuntimes(ctx, rest[1:])
	case "agents":
		return runAgents(ctx, rest[1:])
	case "skills":
		return runSkills(ctx, rest[1:])
	case "projects":
		return runProjects(ctx, rest[1:])
	case "chats":
		return runChats(ctx, rest[1:])
	case "chat":
		return runInteractiveChat(ctx, rest[1:])
	case "help":
		printUsage(stdout)
		return nil
	default:
		return usageError("unknown command %q", rest[0])
	}
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
				return globalArgs{}, nil, usageError("missing value for --base-url")
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
