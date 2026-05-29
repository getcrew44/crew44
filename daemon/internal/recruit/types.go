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
	SchemaVersion    string        `json:"schema_version"`
	Name             string        `json:"name"`
	Version          string        `json:"version"`
	Description      string        `json:"description"`
	Author           string        `json:"author,omitempty"`
	Tags             []string      `json:"tags,omitempty"`
	SuggestedRuntime string        `json:"suggested_runtime,omitempty"`
	SourceType       string        `json:"source_type,omitempty"`
	Upstream         *UpstreamMeta `json:"upstream,omitempty"`
	Skills           []SkillDecl   `json:"skills,omitempty"`
	Payload          *PayloadSpec  `json:"payload,omitempty"`
}

// SkillDecl is one entry inside Manifest.Skills. Path is relative to the
// repo root and is sanitized against traversal before any read.
type SkillDecl struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// UpstreamMeta describes the third-party repo a Crew44 wrapper agent
// imported. Only RepoURL is required; Path defaults to "upstream" when
// omitted. Commit and ImportedAt are informational fields recorded by
// the importer for IMPORT_REPORT.md and runtime display — they do not
// gate install.
type UpstreamMeta struct {
	RepoURL    string `json:"repo_url"`
	Commit     string `json:"commit,omitempty"`
	Path       string `json:"path,omitempty"`
	ImportedAt string `json:"imported_at,omitempty"`
}

// PayloadSpec controls which files the installer copies into the
// installed agent's source/ directory. Include and Exclude use
// gitignore-style globs evaluated against repo-root-relative paths
// (no leading slash). Empty Include with non-nil PayloadSpec falls
// back to the default include set; this lets a manifest specify
// exclude-only.
type PayloadSpec struct {
	Include []string `json:"include,omitempty"`
	Exclude []string `json:"exclude,omitempty"`
}

// UpstreamPathDefault is the conventional location of wrapped upstream
// content inside a Crew44 wrapper agent repo. Used both when the
// manifest omits UpstreamMeta.Path and by the importer when laying out
// new wrapper repos.
const UpstreamPathDefault = "upstream"

// SourceType values understood by the installer. Manifests declaring
// an unknown value are still accepted (forward-compat); the installer
// only special-cases SourceTypeUpstreamWrapper for the upstream block.
const (
	SourceTypeNative          = "native"
	SourceTypeUpstreamWrapper = "upstream-wrapper"
)

// AgentDetail is what recruit.agents.get returns to the UI: the registry
// row, the parsed manifest, and the AGENT.md body. Skills are fetched
// lazily on install, not on detail open, to keep the detail view fast.
type AgentDetail struct {
	Entry     RegistryEntry `json:"entry"`
	Manifest  Manifest      `json:"manifest"`
	AgentBody string        `json:"agent_body"`
}
