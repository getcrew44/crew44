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

// The manifest schema (Manifest, SkillDecl, UpstreamMeta, PayloadSpec)
// and its SourceType/UpstreamPathDefault constants live in the public
// recruit/schema package and are re-exported here; see schema_alias.go.

// AgentDetail is what recruit.agents.get returns to the UI: the registry
// row, the parsed manifest, and the INSTRUCTIONS.md body. Skills are fetched
// lazily on install, not on detail open, to keep the detail view fast.
type AgentDetail struct {
	Entry     RegistryEntry `json:"entry"`
	Manifest  Manifest      `json:"manifest"`
	AgentBody string        `json:"agent_body"`
}
