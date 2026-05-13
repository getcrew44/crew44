// Package presets seeds factory "default crew" agents and skills into the
// user's store on first run and provides reset-to-factory behavior for
// preset-backed records.
//
// Seed flow:
//
//	app.New()
//	  -> bootstrapDefaultState()
//	       -> ListAgents() > 0 ? skip : pickDefaultRuntime + SeedDefaultCrew()
//
// Idempotency uses preset_id/preset_key metadata, not display names.
package presets

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"strings"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

//go:embed defaultcrew
var defaultCrewFS embed.FS

// DefaultCrewPresetID matches the preset_id field inside defaultcrew/manifest.json.
const DefaultCrewPresetID = "default-crew"

// Store is the subset of *store.Store that the presets package needs.
// Defining it here keeps the package independently testable.
type Store interface {
	ListAgents() ([]model.AgentConfig, error)
	GetAgent(id string) (model.AgentConfig, error)
	SaveAgent(agent model.AgentConfig) error
	DeleteAgent(id string) error

	ListSkills() ([]model.SkillRecord, error)
	SaveSkills(records []model.SkillRecord) error
	SkillDir(id string) string
	PutSkillFile(skillID, fileID, content string) error
	DeleteSkill(id string) error

	LoadPresetMapping(presetID string) (model.PresetMapping, error)
	SavePresetMapping(mapping model.PresetMapping) error
}

// Manifest is the factory definition for a preset crew.
type Manifest struct {
	PresetID string          `json:"preset_id"`
	Version  int             `json:"version"`
	Agents   []ManifestAgent `json:"agents"`
}

type ManifestAgent struct {
	PresetKey       string   `json:"preset_key"`
	Name            string   `json:"name"`
	InstructionFile string   `json:"instruction_file"`
	IsDefault       bool     `json:"is_default"`
	SkillRefs       []string `json:"skill_refs"`
}

// PresetView is the public-facing description of a preset agent, used by
// GET /api/presets to render the "Add starter crew" UI.
type PresetView struct {
	PresetID  string `json:"preset_id"`
	PresetKey string `json:"preset_key"`
	Name      string `json:"name"`
	IsDefault bool   `json:"is_default"`
	HasCopy   bool   `json:"has_copy"`
}

// LoadDefaultCrewManifest parses the embedded manifest.json. It returns an
// error if the manifest is malformed; a broken embed is a release bug and
// must fail loudly.
func LoadDefaultCrewManifest() (Manifest, error) {
	raw, err := defaultCrewFS.ReadFile("defaultcrew/manifest.json")
	if err != nil {
		return Manifest{}, fmt.Errorf("read manifest: %w", err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return Manifest{}, fmt.Errorf("parse manifest: %w", err)
	}
	if m.PresetID == "" || len(m.Agents) == 0 {
		return Manifest{}, fmt.Errorf("manifest missing preset_id or agents")
	}
	for _, agent := range m.Agents {
		if agent.PresetKey == "" || agent.Name == "" || agent.InstructionFile == "" {
			return Manifest{}, fmt.Errorf("agent %q missing required fields", agent.Name)
		}
		if _, err := defaultCrewFS.ReadFile(path.Join("defaultcrew", agent.InstructionFile)); err != nil {
			return Manifest{}, fmt.Errorf("agent %q instruction_file %q: %w", agent.PresetKey, agent.InstructionFile, err)
		}
		for _, ref := range agent.SkillRefs {
			if _, err := defaultCrewFS.ReadFile(path.Join("defaultcrew", "skills", ref, "SKILL.md")); err != nil {
				return Manifest{}, fmt.Errorf("agent %q skill_ref %q: %w", agent.PresetKey, ref, err)
			}
		}
	}
	return m, nil
}

// ListPresetViews returns metadata for the default crew, including which
// presets currently have a user copy. Used by GET /api/presets.
func ListPresetViews(store Store) ([]PresetView, error) {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		return nil, err
	}
	mapping, err := store.LoadPresetMapping(manifest.PresetID)
	if err != nil {
		return nil, err
	}
	agents, err := store.ListAgents()
	if err != nil {
		return nil, err
	}
	hasAgent := make(map[string]bool, len(agents))
	for _, a := range agents {
		if a.PresetID == manifest.PresetID && a.PresetKey != "" && a.ArchivedAt.IsZero() {
			hasAgent[a.PresetKey] = true
		}
	}
	// Mapping is a fallback when metadata was lost (e.g. user edited config.json).
	for key, id := range mapping.AgentIDs {
		if _, ok := hasAgent[key]; ok {
			continue
		}
		if _, err := store.GetAgent(id); err == nil {
			hasAgent[key] = true
		}
	}

	views := make([]PresetView, 0, len(manifest.Agents))
	for _, agent := range manifest.Agents {
		views = append(views, PresetView{
			PresetID:  manifest.PresetID,
			PresetKey: agent.PresetKey,
			Name:      agent.Name,
			IsDefault: agent.IsDefault,
			HasCopy:   hasAgent[agent.PresetKey],
		})
	}
	return views, nil
}

// readEmbeddedInstruction returns the system prompt content for an agent.
func readEmbeddedInstruction(agent ManifestAgent) (string, error) {
	raw, err := defaultCrewFS.ReadFile(path.Join("defaultcrew", agent.InstructionFile))
	if err != nil {
		return "", fmt.Errorf("read %s: %w", agent.InstructionFile, err)
	}
	return string(raw), nil
}

// readEmbeddedSkillFiles returns the file list for a preset skill, keyed by
// file ID (e.g. "SKILL.md"). Currently only SKILL.md is shipped, but the
// listing approach generalizes when factory skills gain supplementary files.
func readEmbeddedSkillFiles(skillRef string) (map[string]string, error) {
	root := path.Join("defaultcrew", "skills", skillRef)
	files := map[string]string{}
	err := fs.WalkDir(defaultCrewFS, root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := relPath(root, p)
		if relErr != nil {
			return relErr
		}
		raw, readErr := defaultCrewFS.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		files[rel] = string(raw)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

// relPath returns the path of p relative to root using forward slashes.
func relPath(root, p string) (string, error) {
	if p == root {
		return "", fmt.Errorf("walked file equals root")
	}
	if len(p) <= len(root)+1 || p[:len(root)] != root || p[len(root)] != '/' {
		return "", fmt.Errorf("path %q not under root %q", p, root)
	}
	return p[len(root)+1:], nil
}

// nowUTC is overridable in tests if needed; defaults to time.Now().UTC().
var nowUTC = func() time.Time { return time.Now().UTC() }

func SkillDisplayName(ref string) string {
	ref = strings.TrimSpace(ref)
	if i := strings.LastIndex(ref, "/"); i >= 0 && i < len(ref)-1 {
		return ref[i+1:]
	}
	return ref
}
