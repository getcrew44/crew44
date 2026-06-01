// Package schema defines the Crew44 agent-package format: the
// crew44-agent.json manifest and the pure helpers (validation, payload
// resolution, glob matching, GitHub repo parsing) that both the daemon
// installer and the recruit-packager tool must agree on.
//
// This is the public contract for a Crew44 agent. It deliberately holds
// no I/O, no daemon state, and no third-party dependencies so it can be
// imported by out-of-tree tooling (notably the recruit-packager repo)
// without pulling in the daemon runtime.
package schema

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
