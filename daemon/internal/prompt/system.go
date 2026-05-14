package prompt

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

// memoryReadCap bounds the bytes injected into every system prompt from
// USER.md / project MEMORY.md. The optimizer accept handler enforces its own
// cap on appends, but a hand-edited or restored memory file can already be
// larger; this is the last line of defense before the LLM sees it.
const memoryReadCap = 8 * 1024

const CrewAIContext = "CrewAI Desktop is a local-first multi-agent workteam. The product is organized around agents, skills, runtimes, projects, and chats. User-owned state lives under `~/.crewai`: agent configs, skill directories, runtime inventory, project records, chat timelines, summaries, and preset mappings. Treat these records as user data and avoid overwriting them unless the task explicitly calls for migration, reset, or repair behavior."

type Skill struct {
	Name string
}

type SystemPromptInput struct {
	Agent             model.AgentConfig
	Runtime           model.RuntimeRecord
	AvailableAgents   []model.AgentConfig
	Skills            []Skill
	SummaryPath       string
	HandoverNote      string
	UserMemoryPath    string // ~/.crewai/USER.md; empty if missing/disabled
	ProjectMemoryPath string // ~/.crewai/projects/<id>/MEMORY.md; empty if missing
}

func BuildSystemPrompt(input SystemPromptInput) string {
	var b strings.Builder
	writeSection(&b, "CrewAI Context", CrewAIContext)
	writeSection(&b, "Agent Identity", agentIdentity(input.Agent, input.Runtime))
	writeSection(&b, "Agent Instructions", input.Agent.Instruction)
	if note := strings.TrimSpace(input.HandoverNote); note != "" {
		writeSection(&b, "Handover Task", handoverTask(note))
	}
	if summary := summaryReference(input.SummaryPath); summary != "" {
		writeSection(&b, "Conversation Summary", summary)
	}
	writeSection(&b, "User Memory", readMemoryFile(input.UserMemoryPath))
	writeSection(&b, "Project Memory", readMemoryFile(input.ProjectMemoryPath))
	if skills := skillSummary(input.Runtime.Provider, input.Skills); skills != "" {
		writeSection(&b, "Available Skills", skills)
	}
	writeSection(&b, "Available Agents For Handover", availableAgents(input.Agent.ID, input.AvailableAgents))
	writeSection(&b, "Handover Output Protocol", handoverProtocol())
	return strings.TrimSpace(b.String())
}

// readMemoryFile reads a bounded curated memory file (USER.md / project MEMORY.md).
// Returns empty string if the file is missing, empty, or unreadable so the section is omitted.
// Reads are capped at memoryReadCap to bound prompt size if the file has been
// hand-edited past the optimizer's append cap.
func readMemoryFile(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, memoryReadCap+1))
	if err != nil {
		return ""
	}
	if len(data) > memoryReadCap {
		data = append(data[:memoryReadCap], []byte("\n[memory truncated]")...)
	}
	return strings.TrimSpace(string(data))
}

func writeSection(b *strings.Builder, title, body string) {
	body = strings.TrimSpace(body)
	if body == "" {
		return
	}
	if b.Len() > 0 {
		b.WriteString("\n\n")
	}
	fmt.Fprintf(b, "## %s\n%s", title, body)
}

func agentIdentity(agent model.AgentConfig, runtime model.RuntimeRecord) string {
	var b strings.Builder
	fmt.Fprintf(&b, "- name: %s\n", valueOrNone(agent.Name))
	fmt.Fprintf(&b, "- uuid: %s\n", valueOrNone(agent.ID))
	fmt.Fprintf(&b, "- runtime: %s\n", valueOrNone(runtime.ID))
	if runtime.Provider != "" {
		fmt.Fprintf(&b, "- provider: %s\n", runtime.Provider)
	}
	if agent.Model != "" {
		fmt.Fprintf(&b, "- model: %s\n", agent.Model)
	}
	return strings.TrimSpace(b.String())
}

func handoverTask(note string) string {
	return "You are the agent receiving this handover. The previous agent's note for you is:\n" +
		note +
		"\n\nPerform this task directly now. Do not describe the handover. Do not hand over to yourself."
}

func summaryReference(summaryPath string) string {
	summaryPath = strings.TrimSpace(summaryPath)
	if summaryPath == "" {
		return ""
	}
	return "Summary file:\n" + summaryPath + "\nRead this file if you need prior conversation context. Do not treat the summary as the current user request."
}

func skillSummary(provider string, skills []Skill) string {
	if len(skills) == 0 {
		return ""
	}

	var b strings.Builder
	switch provider {
	case "gemini", "hermes":
		b.WriteString("Detailed skill instructions are in `.agent_context/skills/`. Each subdirectory contains a `SKILL.md`.\n")
	default:
		b.WriteString("The following skills are installed in the runtime's native skill location and should be used when relevant.\n")
	}
	for _, skill := range skills {
		name := strings.TrimSpace(skill.Name)
		if name != "" {
			fmt.Fprintf(&b, "- %s\n", name)
		}
	}
	return strings.TrimSpace(b.String())
}

func availableAgents(currentAgentID string, agents []model.AgentConfig) string {
	var b strings.Builder
	count := 0
	for _, agent := range agents {
		if agent.ID == currentAgentID {
			continue
		}
		count++
		fmt.Fprintf(&b, "- uuid: %s\n  name: %s\n  description: %s\n", agent.ID, agent.Name, handoverDescription(agent.Instruction))
	}
	if count == 0 {
		b.WriteString("- none")
	}
	b.WriteString("\n\nRules:\n")
	b.WriteString("- Do not hand over to yourself.\n")
	b.WriteString("- Only hand over when another listed agent is better suited to continue.\n")
	b.WriteString("- If you are receiving a handover, perform the Handover Task directly unless another listed agent is clearly required.")
	return strings.TrimSpace(b.String())
}

func handoverProtocol() string {
	return "If another listed agent should continue this chat, output exactly one standalone line using this marker format: " +
		model.AgentHandoverMarkerExample +
		"\nReplace agent_uuid with the target agent uuid from the list above. Replace the sentence with a concise instruction for the next agent. Do not put any other text on that output line."
}

func handoverDescription(instruction string) string {
	description := strings.Join(strings.Fields(instruction), " ")
	if description == "" {
		return "No description provided."
	}
	const maxDescriptionLen = 240
	if len(description) <= maxDescriptionLen {
		return description
	}
	return strings.TrimSpace(description[:maxDescriptionLen]) + "..."
}

func valueOrNone(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "none"
	}
	return value
}
