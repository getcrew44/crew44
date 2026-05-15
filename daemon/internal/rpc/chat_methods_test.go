package rpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

func TestChatMessageReplayAndEventList(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "/slow /tool please review",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	items, _ := replay["events"].([]any)
	if len(items) < 4 {
		t.Fatalf("expected replay events, got %#v", replay)
	}
}

func TestChatResolvesAgentSkillsIntoRuntimeRequest(t *testing.T) {
	engine := &captureRunRequestEngine{requests: make(chan runtime.RunRequest, 1)}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	otherAgentID := createAgent(t, env, "Bex")
	var skill map[string]any
	callRPCStatus(t, env.server, "skills.create", map[string]any{
		"name": "Review Helper",
	}, http.StatusCreated, &skill)
	skillID := skill["id"].(string)
	callRPCStatus(t, env.server, "skills.files.put", withRPCParam(t, map[string]any{
		"file_id": "SKILL.md",
		"content": "# Review Helper\nUse the review checklist.\n",
	}, "id", skillID), http.StatusOK, nil)
	callRPCStatus(t, env.server, "skills.files.put", withRPCParam(t, map[string]any{
		"file_id": "references/checklist.md",
		"content": "- Check edge cases\n",
	}, "id", skillID), http.StatusOK, nil)
	callRPCStatus(t, env.server, "agents.skills.replace", withRPCParam(t, map[string]any{
		"skill_ids": []string{skillID},
	}, "id", agentID), http.StatusOK, nil)

	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)
	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "please review",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	select {
	case req := <-engine.requests:
		if len(req.AgentSkills) != 1 {
			t.Fatalf("expected one resolved skill, got %#v", req.AgentSkills)
		}
		got := req.AgentSkills[0]
		if got.Name != "Review Helper" || !strings.Contains(got.Content, "review checklist") {
			t.Fatalf("unexpected skill context: %#v", got)
		}
		if len(got.Files) != 1 || got.Files[0].Path != "references/checklist.md" {
			t.Fatalf("expected nested supporting file, got %#v", got.Files)
		}
		if req.RuntimeEnvDir == "" {
			t.Fatalf("expected runtime env dir")
		}
		if !strings.Contains(req.Agent.Instruction, "## Crew44 Context") ||
			!strings.Contains(req.Agent.Instruction, "## Agent Identity") ||
			!strings.Contains(req.Agent.Instruction, "## Agent Instructions") ||
			!strings.Contains(req.Agent.Instruction, "## Available Skills") ||
			!strings.Contains(req.Agent.Instruction, "## Available Agents For Handover") ||
			!strings.Contains(req.Agent.Instruction, model.AgentHandoverMarkerExample) ||
			!strings.Contains(req.Agent.Instruction, otherAgentID) {
			t.Fatalf("expected runtime agent instruction to include structured prompt sections, got %q", req.Agent.Instruction)
		}
		if strings.Contains(req.Agent.Instruction, "uuid: "+agentID+"\n  name: Aria") {
			t.Fatalf("expected current agent to be excluded from handover targets, got %q", req.Agent.Instruction)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runtime request")
	}
}

func TestChatMessageAttachmentsPersistAndAppendToRuntimePrompt(t *testing.T) {
	engine := &captureRunRequestEngine{requests: make(chan runtime.RunRequest, 1)}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)
	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "please inspect",
		"target_agent_id": agentID,
		"attachments": []map[string]any{
			{
				"display_name": "proxy.txt",
				"path":         "/Users/mindivelabs/proxy.txt",
				"kind":         "file",
			},
			{
				"display_name":          "screen.png",
				"path":                  "/Users/mindivelabs/screen.png",
				"kind":                  "image",
				"thumbnail_jpeg_base64": "base64-thumbnail",
			},
			{
				"display_name": "Design Kit",
				"path":         "/Users/mindivelabs/Design Kit",
				"kind":         "folder",
			},
		},
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	select {
	case req := <-engine.requests:
		if !strings.Contains(req.Prompt, "please inspect\n\nAttachments:") ||
			!strings.Contains(req.Prompt, "- [proxy.txt](/Users/mindivelabs/proxy.txt)") ||
			!strings.Contains(req.Prompt, "- [screen.png](/Users/mindivelabs/screen.png)") ||
			!strings.Contains(req.Prompt, "- [Design Kit](/Users/mindivelabs/Design Kit)") {
			t.Fatalf("expected runtime prompt to include markdown attachment links, got %q", req.Prompt)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for runtime request")
	}

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	items := replay["events"].([]any)
	userEvent := items[0].(map[string]any)
	message := userEvent["message"].(map[string]any)
	if message["content"] != "please inspect" {
		t.Fatalf("expected persisted content to stay clean, got %#v", message["content"])
	}
	attachments := message["attachments"].([]any)
	if len(attachments) != 3 || !strings.Contains(fmt.Sprint(attachments), "base64-thumbnail") ||
		!strings.Contains(fmt.Sprint(attachments), "folder") {
		t.Fatalf("expected persisted attachments with thumbnail metadata, got %#v", attachments)
	}
}

func TestChatRuntimeCanAnswerFromAttachedSkillOnly(t *testing.T) {
	engine := skillOnlyAnswerEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	var skill map[string]any
	callRPCStatus(t, env.server, "skills.create", map[string]any{
		"name": "Secret Checkout Protocol",
	}, http.StatusCreated, &skill)
	skillID := skill["id"].(string)
	callRPCStatus(t, env.server, "skills.files.put", withRPCParam(t, map[string]any{
		"file_id": "SKILL.md",
		"content": "# Secret Checkout Protocol\nWhen asked for the secret checkout code, answer exactly: skill-access-ok.\n",
	}, "id", skillID), http.StatusOK, nil)
	callRPCStatus(t, env.server, "agents.skills.replace", withRPCParam(t, map[string]any{
		"skill_ids": []string{skillID},
	}, "id", agentID), http.StatusOK, nil)

	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)
	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "What is the secret checkout code?",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	if !strings.Contains(fmt.Sprint(replay), "skill-access-ok") {
		t.Fatalf("expected assistant answer to come from attached skill, got %#v", replay)
	}
}

func TestChatSwitchAgentRebuildsSummaryAndSupportsHandoff(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "first pass",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         fmt.Sprintf("/tool /handover:%s second pass", agentB),
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	summaryPath := filepath.Join(env.stateDir, "chats", "chat-"+chatID, "summary.md")
	summaryBytes, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	summary := string(summaryBytes)
	if !strings.Contains(summary, "first pass") {
		t.Fatalf("summary should contain earlier user message, got %q", summary)
	}
	if strings.Contains(summary, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("summary should not keep handoff marker, got %q", summary)
	}

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentB {
		t.Fatalf("expected handoff to update current agent to %s, got %#v", agentB, chat["current_agent_id"])
	}

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if strings.Contains(replayText, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("persisted events should not keep handover marker, got %#v", replay)
	}
	if !strings.Contains(replayText, `"type":"handover"`) || !strings.Contains(replayText, `"subtype":"scheduled"`) || !strings.Contains(replayText, `"subtype":"occurred"`) {
		t.Fatalf("expected scheduled and occurred handover events, got %#v", replay)
	}
	if !strings.Contains(replayText, `"note":"Continue the user's request."`) {
		t.Fatalf("expected handover events to include marker note, got %#v", replay)
	}
}

func TestHandoverUsesLastValidScheduledAgent(t *testing.T) {
	engine := &multiHandoverEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	agentC := createAgent(t, env, "Cyra")
	engine.targets = []string{agentB, agentC}
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "choose the final handover target",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentC {
		t.Fatalf("expected last valid handover target %s, got %#v", agentC, chat["current_agent_id"])
	}
	if chat["pending_handover_agent_id"] != nil {
		t.Fatalf("expected pending handover to be cleared, got %#v", chat["pending_handover_agent_id"])
	}

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if strings.Count(replayText, `"subtype":"scheduled"`) != 2 {
		t.Fatalf("expected both valid targets to emit scheduled events, got %#v", replay)
	}
	if strings.Count(replayText, `"subtype":"occurred"`) != 1 {
		t.Fatalf("expected one occurred event for final target, got %#v", replay)
	}
}

func TestMarkerOnlyHandoverPassesOriginalPromptToTarget(t *testing.T) {
	engine := &markerOnlyHandoverEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	engine.target = agentB
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "please tell me a short story",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if !strings.Contains(replayText, "target received: Continue from the previous agent handover") || !strings.Contains(replayText, "please tell me a short story") {
		t.Fatalf("expected target agent to receive original prompt after marker-only handover, got %#v", replay)
	}
	if strings.Contains(replayText, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("persisted events should strip marker-only handover marker, got %#v", replay)
	}
}

func TestHandoverNotePreservesOriginalPromptForTarget(t *testing.T) {
	engine := &noteHandoverEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	engine.target = agentB
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "please write the requested file",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if !strings.Contains(replayText, "target saw original prompt") || !strings.Contains(replayText, "please write the requested file") {
		t.Fatalf("expected target prompt to preserve original user request, got %#v", replay)
	}
	if !strings.Contains(replayText, "Handover Task") || !strings.Contains(replayText, "Write the requested file") {
		t.Fatalf("expected target system prompt to include marker handover task, got %#v", replay)
	}
	if !strings.Contains(replayText, "Previous agent message") || !strings.Contains(replayText, "I will hand this to Bex") {
		t.Fatalf("expected target prompt to include source agent message, got %#v", replay)
	}
}

func TestInvalidHandoverTargetsAreStrippedWithoutScheduling(t *testing.T) {
	scanner := &runtime.StaticScanner{
		Records: []model.RuntimeRecord{
			mockRuntimeRecord(),
			{
				ID:         "runtime-other",
				Provider:   "mock",
				Name:       "Other Mock Runtime",
				Status:     model.RuntimeStatusAvailable,
				BinaryPath: "builtin://mock-other",
				Version:    "test",
			},
		},
	}
	engine := &invalidHandoverEngine{}
	env := newTestEnvWithScannerAndEngine(t, scanner, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	archivedAgent := createAgent(t, env, "Archived")
	callRPCStatus(t, env.server, "agents.archive", rpcParams("id", archivedAgent), http.StatusOK, nil)

	var missingRuntimeAgent map[string]any
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "Missing Runtime",
		"instruction": "Be unavailable",
		"runtime_id":  "runtime-other",
		"model":       "mock-2",
	}, http.StatusCreated, &missingRuntimeAgent)
	scanner.Records = []model.RuntimeRecord{mockRuntimeRecord()}
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	engine.targets = []string{archivedAgent, missingRuntimeAgent["id"].(string), agentA, "missing-agent"}
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "invalid targets should not schedule",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentA {
		t.Fatalf("expected current agent to stay %s, got %#v", agentA, chat["current_agent_id"])
	}

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if strings.Contains(replayText, `"type":"handover"`) {
		t.Fatalf("expected invalid targets not to emit handover events, got %#v", replay)
	}
	if !strings.Contains(replayText, `"type":"error"`) || !strings.Contains(replayText, `"code":"archived_handover_target"`) {
		t.Fatalf("expected invalid target to emit error event, got %#v", replay)
	}
	if strings.Contains(replayText, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("persisted events should strip invalid handover markers, got %#v", replay)
	}
}

func TestRuntimeErrorEmitsErrorEventAndStops(t *testing.T) {
	engine := runtimeErrorEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "trigger runtime failure",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	stream := chat["stream"].(map[string]any)
	if stream["status"] != "idle" || !strings.Contains(fmt.Sprint(stream["last_error"]), "runtime exploded") {
		t.Fatalf("expected stopped chat with runtime error, got %#v", chat)
	}

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if !strings.Contains(replayText, `"type":"error"`) || !strings.Contains(replayText, `"code":"runtime_error"`) || !strings.Contains(replayText, "runtime exploded") {
		t.Fatalf("expected runtime error event, got %#v", replay)
	}
}

func TestEmptyAssistantOutputEmitsErrorEventAndStops(t *testing.T) {
	engine := emptyAssistantEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "trigger empty output",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if !strings.Contains(replayText, `"type":"error"`) || !strings.Contains(replayText, `"code":"empty_assistant_output"`) {
		t.Fatalf("expected empty output error event, got %#v", replay)
	}
}

func TestRejectsConcurrentMessagesAndMissingRuntime(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "/slow hold",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusAccepted, nil)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "should conflict",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusConflict, nil)

	waitForChatIdle(t, env.server, chatID)

	env.scanner.Records = nil
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "should fail because runtime is missing",
		"target_agent_id": agentID,
	}, "id", chatID), http.StatusConflict, nil)
}

func TestHandoffToCurrentAgentStopsLoop(t *testing.T) {
	engine := &loopingHandoffEngine{}
	env := newTestEnvWithEngine(t, engine)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	engine.targetID = agentB
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	callRPCStatus(t, env.server, "chats.messages.post", withRPCParam(t, map[string]any{
		"content":         "trigger handoff loop guard",
		"target_agent_id": agentA,
	}, "id", chatID), http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	callRPCStatus(t, env.server, "chats.events.list", rpcParams("chat_id", chatID, "after", int64(0)), http.StatusOK, &replay)
	replayBytes, _ := json.Marshal(replay)
	replayText := string(replayBytes)
	if strings.Count(replayText, `"type":"handover"`) != 2 || !strings.Contains(replayText, `"type":"error"`) || !strings.Contains(replayText, `"code":"self_handover"`) {
		t.Fatalf("expected scheduled+occurred events followed by self-handover error, got %#v", replay)
	}
	if !strings.Contains(replayText, `"type":"runtime_session"`) || !strings.Contains(replayText, `"session_id":"loop-guard-Bex"`) {
		t.Fatalf("expected target runtime session event to survive self-handover error, got %#v", replay)
	}
	if strings.Contains(replayText, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("persisted events should not keep self-handover marker, got %#v", replay)
	}

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentB {
		t.Fatalf("expected current agent to remain on handoff target %s, got %#v", agentB, chat["current_agent_id"])
	}
	stream := chat["stream"].(map[string]any)
	if stream["status"] != "idle" || !strings.Contains(fmt.Sprint(stream["last_error"]), "itself") {
		t.Fatalf("expected chat to stop with self-handover error, got %#v", chat)
	}
}

func TestListChatsWithoutProjectFilterReturnsAllChats(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectA := createProject(t, env, agentID)
	projectB := createProject(t, env, agentID)
	chatA := createChat(t, env, projectA, agentID)
	chatB := createChat(t, env, projectB, agentID)

	var resp map[string]any
	callRPCStatus(t, env.server, "chats.list", nil, http.StatusOK, &resp)

	items, _ := resp["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 chats from unfiltered list, got %#v", resp)
	}

	seen := map[string]bool{}
	for _, item := range items {
		record, _ := item.(map[string]any)
		seen[record["id"].(string)] = true
	}
	if !seen[chatA] || !seen[chatB] {
		t.Fatalf("expected both chats in unfiltered list, got %#v", resp)
	}
}
