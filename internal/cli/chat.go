package cli

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

type chatRecord struct {
	ID             string `json:"id"`
	ProjectID      string `json:"project_id"`
	Title          string `json:"title"`
	MainAgentID    string `json:"main_agent_id"`
	CurrentAgentID string `json:"current_agent_id"`
	Stream         struct {
		Status string `json:"status"`
	} `json:"stream"`
}

type eventsResponse struct {
	Events []model.Event `json:"events"`
}

type sseFrame struct {
	Name string
	Data []byte
}

func runInteractiveChat(ctx Context, args []string) error {
	fs := newFlagSet("chat", ctx)
	sessionID := fs.String("session", "", "existing chat session id")
	projectID := fs.String("project-id", "", "project id for a new chat")
	mainAgentID := fs.String("main-agent-id", "", "main agent id for a new chat")
	title := fs.String("title", "CLI Chat", "new chat title")
	targetAgentID := fs.String("agent", "", "default target agent id")
	if err := parseFlags(fs, args, "chat"); err != nil {
		return err
	}

	chat, err := resolveChatSession(ctx, *sessionID, *projectID, *mainAgentID, *title)
	if err != nil {
		return err
	}

	var replay eventsResponse
	if err := ctx.Client.Get("/api/chat/sessions/"+chat.ID+"/events?after=0", &replay); err != nil {
		return err
	}
	lastSeq := int64(0)
	for _, event := range replay.Events {
		if event.Seq > lastSeq {
			lastSeq = event.Seq
		}
	}

	currentTarget := *targetAgentID
	if currentTarget == "" {
		currentTarget = chat.CurrentAgentID
	}

	if err := printLine(ctx.Stdout, "chat session: %s", chat.ID); err != nil {
		return err
	}
	if err := printLine(ctx.Stdout, "type /quit to exit, /agent <id> to switch target, /show to inspect chat, /cancel to cancel active work"); err != nil {
		return err
	}

	scanner := bufio.NewScanner(ctx.Stdin)
	for {
		if _, err := fmt.Fprint(ctx.Stdout, "> "); err != nil {
			return err
		}
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return err
			}
			return nil
		}

		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if line == "/quit" || line == "/exit" {
			return nil
		}
		if strings.HasPrefix(line, "/agent ") {
			next := strings.TrimSpace(strings.TrimPrefix(line, "/agent "))
			if next == "" {
				return newUsageError("chat", "missing agent id after /agent")
			}
			currentTarget = next
			if err := printLine(ctx.Stdout, "target agent: %s", currentTarget); err != nil {
				return err
			}
			continue
		}
		if line == "/show" {
			var latest chatRecord
			if err := ctx.Client.Get("/api/chat/sessions/"+chat.ID, &latest); err != nil {
				return err
			}
			if err := printJSON(ctx.Stdout, latest); err != nil {
				return err
			}
			continue
		}
		if line == "/cancel" {
			var resp any
			if err := ctx.Client.Post("/api/chat/sessions/"+chat.ID+"/cancel", map[string]any{}, &resp); err != nil {
				return err
			}
			if err := printJSON(ctx.Stdout, resp); err != nil {
				return err
			}
			continue
		}

		body := map[string]any{
			"content":         line,
			"target_agent_id": currentTarget,
		}
		var accepted chatRecord
		if err := ctx.Client.Post("/api/chat/sessions/"+chat.ID+"/messages", body, &accepted); err != nil {
			return err
		}

		nextSeq, latest, err := streamChatTurn(ctx, chat.ID, lastSeq)
		if err != nil {
			return err
		}
		lastSeq = nextSeq
		if latest.CurrentAgentID != "" {
			currentTarget = latest.CurrentAgentID
		}
	}
}

func resolveChatSession(ctx Context, sessionID, projectID, mainAgentID, title string) (chatRecord, error) {
	if sessionID != "" {
		var chat chatRecord
		err := ctx.Client.Get("/api/chat/sessions/"+sessionID, &chat)
		return chat, err
	}
	if projectID == "" || mainAgentID == "" {
		return chatRecord{}, newUsageError("chat", "missing --session or --project-id/--main-agent-id")
	}
	var chat chatRecord
	err := ctx.Client.Post("/api/chat/sessions", map[string]any{
		"project_id":    projectID,
		"title":         title,
		"main_agent_id": mainAgentID,
	}, &chat)
	return chat, err
}

func streamChatTurn(ctx Context, chatID string, after int64) (int64, chatRecord, error) {
	resp, err := ctx.Client.OpenEventStream("/api/chat/sessions/" + chatID + "/events?after=" + formatInt(after) + "&follow=1")
	if err != nil {
		return after, chatRecord{}, err
	}
	defer resp.Body.Close()

	reader := bufio.NewReader(resp.Body)
	lastSeq := after
	for {
		frame, err := readSSEFrame(reader)
		if err != nil {
			if err == io.EOF {
				break
			}
			return lastSeq, chatRecord{}, err
		}
		switch frame.Name {
		case "chat.event":
			var event model.Event
			if err := json.Unmarshal(frame.Data, &event); err != nil {
				return lastSeq, chatRecord{}, err
			}
			if event.Seq > lastSeq {
				lastSeq = event.Seq
			}
			if err := printEvent(ctx.Stdout, event); err != nil {
				return lastSeq, chatRecord{}, err
			}
		case "done":
			var latest chatRecord
			if err := ctx.Client.Get("/api/chat/sessions/"+chatID, &latest); err != nil {
				return lastSeq, chatRecord{}, err
			}
			return lastSeq, latest, nil
		case "error":
			return lastSeq, chatRecord{}, fmt.Errorf("chat stream failed: %s", strings.TrimSpace(string(frame.Data)))
		}
	}

	var latest chatRecord
	if err := ctx.Client.Get("/api/chat/sessions/"+chatID, &latest); err != nil {
		return lastSeq, chatRecord{}, err
	}
	return lastSeq, latest, nil
}

func readSSEFrame(reader *bufio.Reader) (sseFrame, error) {
	frame := sseFrame{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return frame, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if frame.Name != "" || len(frame.Data) > 0 {
				return frame, nil
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event: "):
			frame.Name = strings.TrimSpace(strings.TrimPrefix(line, "event: "))
		case strings.HasPrefix(line, "data: "):
			frame.Data = append(frame.Data, []byte(strings.TrimPrefix(line, "data: "))...)
		}
	}
}

func printEvent(w io.Writer, event model.Event) error {
	switch event.Type {
	case model.EventTypeMessage:
		if event.Message == nil {
			return nil
		}
		if event.Message.Role == model.MessageRoleAssistant {
			_, err := fmt.Fprintln(w, event.Message.Content)
			return err
		}
		_, err := fmt.Fprintf(w, "[user/%s] %s\n", event.ActorAgentID, event.Message.Content)
		return err
	case model.EventTypeThinking:
		if event.Thinking == nil {
			return nil
		}
		_, err := fmt.Fprintf(w, "[thinking/%s] %s\n", event.ActorAgentID, event.Thinking.Content)
		return err
	case model.EventTypeToolCall:
		if event.ToolCall == nil {
			return nil
		}
		_, err := fmt.Fprintf(w, "[tool/%s] %s\n", event.ActorAgentID, event.ToolCall.Name)
		return err
	case model.EventTypeToolCallResult:
		if event.ToolCallResult == nil {
			return nil
		}
		_, err := fmt.Fprintf(w, "[tool-result/%s] %s\n", event.ActorAgentID, event.ToolCallResult.Name)
		return err
	default:
		return nil
	}
}
