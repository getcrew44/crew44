package schema

import (
	"fmt"
	"path"
	"strings"
)

// manifestSchemaPrefix gates which schema_version values the install
// path accepts. Anything outside the v1 family is rejected so an author
// experimenting with a v2 layout can't accidentally install on a daemon
// that doesn't understand the new fields.
const manifestSchemaPrefix = "crew44.agent.v1"

// ValidateManifest enforces the required fields and rejects unsafe skill
// paths. The daemon installer runs it at parse time so the install path
// can assume a well-formed manifest; the importer runs the same checks so
// a published wrapper repo cannot trip the installer with a manifest the
// importer accepted.
func ValidateManifest(m *Manifest) error {
	if strings.TrimSpace(m.SchemaVersion) == "" {
		return fmt.Errorf("%w: missing schema_version", ErrManifestInvalid)
	}
	if m.SchemaVersion != manifestSchemaPrefix {
		return fmt.Errorf("%w: unsupported schema_version %q", ErrManifestInvalid, m.SchemaVersion)
	}
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("%w: missing name", ErrManifestInvalid)
	}
	if strings.TrimSpace(m.Version) == "" {
		return fmt.Errorf("%w: missing version", ErrManifestInvalid)
	}
	if strings.TrimSpace(m.Description) == "" {
		return fmt.Errorf("%w: missing description", ErrManifestInvalid)
	}
	for i, sd := range m.Skills {
		if strings.TrimSpace(sd.Name) == "" {
			return fmt.Errorf("%w: skill %d missing name", ErrManifestInvalid, i)
		}
		if err := ensureSafePath(sd.Path); err != nil {
			return err
		}
		if !strings.HasSuffix(sd.Path, "SKILL.md") {
			return fmt.Errorf("%w: skill %d path must end with SKILL.md (got %q)", ErrManifestInvalid, i, sd.Path)
		}
	}
	if m.SourceType == SourceTypeUpstreamWrapper {
		if m.Upstream == nil || strings.TrimSpace(m.Upstream.RepoURL) == "" {
			return fmt.Errorf("%w: source_type=%q requires upstream.repo_url", ErrManifestInvalid, m.SourceType)
		}
	}
	if m.Upstream != nil && strings.TrimSpace(m.Upstream.Path) != "" {
		if err := ensureSafePath(m.Upstream.Path); err != nil {
			return err
		}
	}
	if m.Payload != nil {
		for _, p := range m.Payload.Include {
			if err := ensureSafeGlob(p); err != nil {
				return err
			}
		}
		for _, p := range m.Payload.Exclude {
			if err := ensureSafeGlob(p); err != nil {
				return err
			}
		}
	}
	return nil
}

// ensureSafePath rejects absolute paths and any path that escapes the
// repo root via "..". Empty path is allowed (treated as "no SKILL.md")
// but ValidateManifest separately requires non-empty for declared
// skills; this is the second line of defense.
func ensureSafePath(p string) error {
	if p == "" {
		return fmt.Errorf("%w: empty skill path", ErrManifestInvalid)
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	cleaned := path.Clean(p)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	return nil
}

// ensureSafeGlob applies the same anti-traversal checks as ensureSafePath
// but tolerates the gitignore-style glob characters (`*`, `**`, `?`) the
// manifest payload spec accepts.
func ensureSafeGlob(p string) error {
	if strings.TrimSpace(p) == "" {
		return fmt.Errorf("%w: empty payload glob", ErrManifestInvalid)
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: %s", ErrUnsafePath, p)
	}
	if strings.HasPrefix(p, "!") {
		return fmt.Errorf("%w: gitignore-negation globs are not supported in v1.1 (%q)", ErrManifestInvalid, p)
	}
	// path.Clean would collapse `**`, so reject `..` segments by walking
	// the path manually.
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return fmt.Errorf("%w: %s", ErrUnsafePath, p)
		}
	}
	return nil
}
