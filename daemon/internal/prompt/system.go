package prompt

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// memoryReadCap bounds the bytes injected into every system prompt from the
// per-user / per-project memory scope. The optimizer accept handler enforces
// its own cap on the MEMORY.md index, but per-entry bodies are unbounded; this
// is the last line of defense before the LLM sees the concatenated memories.
const memoryReadCap = 8 * 1024

const Crew44Context = "Crew44 is a local-first multi-agent workteam. The product is organized around agents, skills, runtimes, projects, and chats. User-owned state lives under `~/.crew44`: agent configs, skill directories, runtime inventory, project records, chat timelines, summaries, and preset mappings. Treat these records as user data and avoid overwriting them unless the task explicitly calls for migration, reset, or repair behavior."

type Skill struct {
	Name string
}

type SystemPromptInput struct {
	Agent                   model.AgentConfig
	Runtime                 model.RuntimeRecord
	AvailableAgents         []model.AgentConfig
	Skills                  []Skill
	SummaryPath             string
	ChatSessionDir          string // ~/.crew44/chats/chat-<id>; agents write handover scratch files here so they are scoped to this chat
	HandoverNote            string
	Goal                    *model.GoalState // nil = not a goal chat; no Goal Mode section emitted
	IsGoalLead              bool             // current agent is the chat's main agent (owns goal markers)
	UserMemoryDir           string           // ~/.crew44/memory; reader expands MEMORY.md + per-entry files
	ProjectMemoryDir        string           // ~/.crew44/projects/<id>/memory
	LegacyUserMemoryPath    string           // ~/.crew44/USER.md; used when UserMemoryDir has no MEMORY.md yet
	LegacyProjectMemoryPath string           // ~/.crew44/projects/<id>/MEMORY.md; legacy single-file fallback
}

func BuildSystemPrompt(input SystemPromptInput) string {
	var b strings.Builder
	writeSection(&b, "Crew44 Context", Crew44Context)
	writeSection(&b, "Agent Identity", agentIdentity(input.Agent, input.Runtime))
	writeSection(&b, "Agent Instructions", input.Agent.Instruction)
	if note := strings.TrimSpace(input.HandoverNote); note != "" {
		writeSection(&b, "Handover Task", handoverTask(note))
	}
	if input.Goal != nil {
		writeSection(&b, "Goal Mode", goalModeSection(input.Goal, input.IsGoalLead))
	}
	if summary := summaryReference(input.SummaryPath); summary != "" {
		writeSection(&b, "Conversation Summary", summary)
	}
	writeSection(&b, "User Memory", readMemoryScope(input.UserMemoryDir, input.LegacyUserMemoryPath))
	writeSection(&b, "Project Memory", readMemoryScope(input.ProjectMemoryDir, input.LegacyProjectMemoryPath))
	if skills := skillSummary(input.Runtime.Provider, input.Skills); skills != "" {
		writeSection(&b, "Available Skills", skills)
	}
	writeSection(&b, "Available Agents For Handover", availableAgents(input.Agent.ID, input.AvailableAgents, input.ChatSessionDir))
	writeSection(&b, "Handover Output Protocol", handoverProtocol())
	return strings.TrimSpace(b.String())
}

// readMemoryScope expands the per-entry memory directory into a single block
// the LLM can read. If dir/MEMORY.md exists, each linked body file is loaded
// (frontmatter stripped) and concatenated under a `### Title` heading. When
// the new layout is empty or absent, falls back to the legacy single-file
// path so old user-edited or pre-migration memories keep being honored.
// Total output is capped at memoryReadCap.
func readMemoryScope(dir, legacyPath string) string {
	if expanded := expandMemoryIndex(dir); expanded != "" {
		return expanded
	}
	return readLegacyMemoryFile(legacyPath)
}

func readLegacyMemoryFile(path string) string {
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

// memoryIndexLinkRE matches one MEMORY.md index line of the shape
// `- [Title](slug.md) — desc` (the dash and description are optional).
var memoryIndexLinkRE = regexp.MustCompile(`^\s*-\s+\[([^\]]+)\]\(([^)]+\.md)\)(?:\s+[—-]\s+(.+))?\s*$`)

func expandMemoryIndex(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return ""
	}
	indexBytes, err := os.ReadFile(filepath.Join(dir, "MEMORY.md"))
	if err != nil {
		return ""
	}
	var out strings.Builder
	budget := memoryReadCap
	truncated := false
	for _, line := range strings.Split(string(indexBytes), "\n") {
		match := memoryIndexLinkRE.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		title, file := match[1], match[2]
		// Defense in depth: anything that escapes dir is silently skipped.
		bodyPath, ok := safeMemoryChild(dir, file)
		if !ok {
			continue
		}
		body, err := os.ReadFile(bodyPath)
		if err != nil {
			continue
		}
		section := renderMemorySection(title, stripFrontmatter(string(body)))
		if section == "" {
			continue
		}
		if budget-len(section) < 0 {
			truncated = true
			break
		}
		if out.Len() > 0 {
			out.WriteString("\n\n")
			budget -= 2
		}
		out.WriteString(section)
		budget -= len(section)
	}
	if truncated {
		out.WriteString("\n[memory truncated]")
	}
	return strings.TrimSpace(out.String())
}

func safeMemoryChild(dir, name string) (string, bool) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimSpace(name)))
	if cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", false
	}
	full := filepath.Join(dir, cleaned)
	rel, err := filepath.Rel(dir, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	return full, true
}

func renderMemorySection(title, body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}
	return fmt.Sprintf("### %s\n%s", strings.TrimSpace(title), body)
}

// stripFrontmatter removes a leading `---\n...\n---` YAML block if present.
// Body content following the closing fence is returned verbatim so the LLM
// sees the memory itself, not its metadata.
func stripFrontmatter(s string) string {
	s = strings.TrimPrefix(s, "\ufeff")
	if !strings.HasPrefix(s, "---\n") && !strings.HasPrefix(s, "---\r\n") {
		return s
	}
	rest := strings.TrimPrefix(strings.TrimPrefix(s, "---\r\n"), "---\n")
	idx := strings.Index(rest, "\n---")
	if idx < 0 {
		return s
	}
	after := rest[idx+len("\n---"):]
	after = strings.TrimPrefix(after, "\r\n")
	after = strings.TrimPrefix(after, "\n")
	return after
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

func availableAgents(currentAgentID string, agents []model.AgentConfig, chatSessionDir string) string {
	var b strings.Builder
	count := 0
	for _, agent := range agents {
		if agent.ID == currentAgentID {
			continue
		}
		count++
		fmt.Fprintf(&b, "- uuid: %s\n  name: %s\n  description: %s\n", agent.ID, agent.Name, agentBriefDescription(agent))
	}
	if count == 0 {
		b.WriteString("- none")
	}
	b.WriteString("\n\nRules:\n")
	b.WriteString("- Use only UUIDs listed above as handover targets.\n")
	b.WriteString("- You should handover task to other agents if they're more capable. Do not hand over to yourself.\n")
	b.WriteString("- Make the handover decision yourself. Do not ask the user whether to hand over.\n")
	b.WriteString("- If you are receiving a handover, perform the Handover Task directly. Do not describe the handover.\n")
	b.WriteString("\nRouting:\n")
	b.WriteString("- Compare every request against the listed agents' descriptions. If another listed agent's scope clearly fits the request better than yours, hand off rather than attempting the work yourself.\n")
	b.WriteString("- Route the moment you recognize the scope match. Do not partial-answer first and then hand over — the partial answer competes with the specialist's framing and wastes the user's turn.\n")
	b.WriteString("- When handing over, include the user's goal, the relevant context, and the specific deliverable expected of the next agent.\n")
	b.WriteString(handoverScratchInstruction(chatSessionDir))
	b.WriteString("- Handle directly only when the request fits your scope or when no listed agent clearly fits better.")
	return strings.TrimSpace(b.String())
}

// handoverScratchInstruction tells the agent where to persist intermediate
// work before a handover and what shape that handover document should take.
// Files belong with the chat session, not under /tmp or the project workdir
// — that way the next agent in this chat can find them and they get cleaned
// up with the chat. Falls back to a chat-scoped relative path when no
// session dir is available (tests, edge cases).
func handoverScratchInstruction(chatSessionDir string) string {
	chatSessionDir = strings.TrimSpace(chatSessionDir)
	location := "this chat's session directory (alongside `summary.md`) at `handover/<short-slug>.md`"
	pathConstraint := ""
	if chatSessionDir != "" {
		location = fmt.Sprintf("this chat's session directory at `%s/handover/<short-slug>.md`", chatSessionDir)
		pathConstraint = " The chat session directory already exists; do not create files under `/tmp` or the project workdir."
	}
	return "- Before handing over, save any meaningful intermediate work to a file under " + location + ", and reference that absolute path in the handover note." + pathConstraint + " The file MUST follow this structure so the receiving agent can pick up cold:\n" +
		"  ```markdown\n" +
		"  # <one-line title of the task>\n" +
		"\n" +
		"  **Handover at:** <RFC3339 timestamp, e.g. 2026-05-21T19:42:00Z>\n" +
		"\n" +
		"  ## User report\n" +
		"  <Quote or tightly paraphrase what the user asked, including the exact phrasing of any reproduction steps or symptoms. Preserve their words for ambiguous requests.>\n" +
		"\n" +
		"  ## Context\n" +
		"  <Current branch, files already modified, related code paths, prior attempts, and anything you learned that isn't obvious from the diff. Cite paths and line numbers.>\n" +
		"\n" +
		"  ## Goal\n" +
		"  <One or two sentences naming the concrete deliverable the next agent must produce. What does \"done\" look like?>\n" +
		"\n" +
		"  ## Suggested approach\n" +
		"  <Numbered steps you would take next. Specific commands, files to read, comparisons to make. Mark anything you tried that didn't work so the next agent doesn't repeat it.>\n" +
		"  ```\n" +
		"  Other agents read files; they cannot see your scrollback. A handover note that just points at the file without these sections is not a handover — fill all four sections.\n"
}

func handoverProtocol() string {
	return "To hand over this chat to another listed agent, output exactly one standalone line using this marker format: " +
		model.AgentHandoverMarkerExample +
		"\nReplace agent_uuid with the target agent uuid from the list above. Replace the sentence with a concise instruction for the next agent. Do not put any other text on that output line."
}

func agentBriefDescription(agent model.AgentConfig) string {
	if d := model.EffectiveAgentDescription(agent); d != "" {
		return d
	}
	return "No description provided."
}

func valueOrNone(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "none"
	}
	return value
}
