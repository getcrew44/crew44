package recruit

// RegistryEnvelope is the top-level shape of agents.json published in the
// agent-registry repo. Unknown schema_version values are tolerated by
// returning the parsed agents but flagged via SchemaVersion for callers
// that want to gate behavior.
type RegistryEnvelope struct {
	SchemaVersion string          `json:"schema_version"`
	UpdatedAt     string          `json:"updated_at,omitempty"`
	Agents        []RegistryEntry `json:"agents"`
}

// RegistryEntry is one row from agents.json. Required: ID, Name,
// Description, RepoURL.
type RegistryEntry struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Author      string   `json:"author,omitempty"`
	RepoURL     string   `json:"repo_url"`
	Tags        []string `json:"tags,omitempty"`
	Installs    int      `json:"installs,omitempty"`
	Stars       int      `json:"stars,omitempty"`
	Trending    bool     `json:"trending,omitempty"`
	Icon        *Icon    `json:"icon,omitempty"`
}

// Icon is the tiny visual hint shown in the Recruit list and detail. Both
// fields are optional; the UI falls back to the first letter of Name and a
// neutral color when omitted.
type Icon struct {
	Initial string `json:"initial,omitempty"`
	Color   string `json:"color,omitempty"`
}

// Manifest is the per-repo crew44-agent.json file at repo root.
// SchemaVersion, Name, Version, and Description are required. SkillDecls
// may be empty for an agent without bundled skills.
type Manifest struct {
	SchemaVersion    string       `json:"schema_version"`
	Name             string       `json:"name"`
	Version          string       `json:"version"`
	Description      string       `json:"description"`
	Author           string       `json:"author,omitempty"`
	Tags             []string     `json:"tags,omitempty"`
	SuggestedRuntime string       `json:"suggested_runtime,omitempty"`
	Skills           []SkillDecl  `json:"skills,omitempty"`
}

// SkillDecl is one entry inside Manifest.Skills. Path is relative to the
// repo root and is sanitized against traversal before any read.
type SkillDecl struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// AgentDetail is what recruit.agents.get returns to the UI: the registry
// row, the parsed manifest, and the AGENT.md body. Skills are fetched
// lazily on install, not on detail open, to keep the detail view fast.
type AgentDetail struct {
	Entry     RegistryEntry `json:"entry"`
	Manifest  Manifest      `json:"manifest"`
	AgentBody string        `json:"agent_body"`
}
