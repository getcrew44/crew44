package presets

import (
	"fmt"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/id"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

// ResetResult describes what reset touched.
type ResetResult struct {
	PresetID    string   `json:"preset_id"`
	ResetAgents []string `json:"reset_agents"`
	ResetSkills []string `json:"reset_skills"`
}

// ResetDefaultCrew resets every preset-backed agent in the default crew back
// to factory definitions. Deleted preset agents are recreated.
//
// Per-skill semantics: only SKILL.md is overwritten. Other files in the
// skill directory (user-added) are left untouched.
func ResetDefaultCrew(store Store, runtime model.RuntimeRecord) (ResetResult, error) {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		return ResetResult{}, err
	}
	out := ResetResult{PresetID: manifest.PresetID}
	for _, agent := range manifest.Agents {
		agentResult, err := resetOneAgent(store, manifest, agent, runtime)
		if err != nil {
			return ResetResult{}, err
		}
		out.ResetAgents = append(out.ResetAgents, agentResult.ResetAgents...)
		out.ResetSkills = append(out.ResetSkills, agentResult.ResetSkills...)
	}
	return out, nil
}

// ResetAgentPreset resets a single preset-backed agent by its store ID.
// Returns ErrNotPreset if the agent has no preset metadata.
func ResetAgentPreset(store Store, agentID string, runtime model.RuntimeRecord) (ResetResult, error) {
	current, err := store.GetAgent(agentID)
	if err != nil {
		return ResetResult{}, err
	}
	if current.PresetID == "" || current.PresetKey == "" {
		return ResetResult{}, ErrNotPreset
	}
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		return ResetResult{}, err
	}
	if current.PresetID != manifest.PresetID {
		return ResetResult{}, fmt.Errorf("agent preset_id %q does not match default crew", current.PresetID)
	}
	var target ManifestAgent
	for _, a := range manifest.Agents {
		if a.PresetKey == current.PresetKey {
			target = a
			break
		}
	}
	if target.PresetKey == "" {
		return ResetResult{}, fmt.Errorf("agent preset_key %q not in default crew manifest", current.PresetKey)
	}
	return resetOneAgent(store, manifest, target, runtime)
}

// ErrNotPreset is returned by ResetAgentPreset when the target agent is not
// preset-backed.
var ErrNotPreset = fmt.Errorf("agent is not preset-backed")

func resetOneAgent(store Store, manifest Manifest, manifestAgent ManifestAgent, runtime model.RuntimeRecord) (ResetResult, error) {
	mapping, err := store.LoadPresetMapping(manifest.PresetID)
	if err != nil {
		return ResetResult{}, err
	}
	mapping.PresetID = manifest.PresetID
	mapping.Version = manifest.Version

	// Locate or recreate the agent record.
	current, foundID, err := findPresetAgent(store, manifest.PresetID, manifestAgent.PresetKey, mapping)
	if err != nil {
		return ResetResult{}, err
	}

	// Ensure all factory skills exist; overwrite their SKILL.md content.
	skillIDs, resetSkillRefs, err := resetSkillsForAgent(store, manifest.PresetID, manifestAgent, mapping)
	if err != nil {
		return ResetResult{}, err
	}

	instruction, err := readEmbeddedInstruction(manifestAgent)
	if err != nil {
		return ResetResult{}, err
	}

	// Pick runtime: keep existing if valid; else fall back to current default.
	runtimeID := current.RuntimeID
	modelName := current.Model
	if runtimeID == "" {
		runtimeID = runtime.ID
		modelName = defaultRuntimeModel(runtime)
	}

	now := nowUTC()
	resetAgent := model.AgentConfig{
		ID:          firstNonEmpty(current.ID, foundID),
		Name:        manifestAgent.Name,
		Instruction: instruction,
		RuntimeID:   runtimeID,
		Model:       modelName,
		SkillIDs:    skillIDs,
		PresetID:    manifest.PresetID,
		PresetKey:   manifestAgent.PresetKey,
		CreatedAt:   firstNonZeroTime(current.CreatedAt, now),
		UpdatedAt:   now,
	}
	if err := store.SaveAgent(resetAgent); err != nil {
		return ResetResult{}, err
	}
	mapping.AgentIDs[manifestAgent.PresetKey] = resetAgent.ID
	mapping.SeededAt = now
	if err := store.SavePresetMapping(mapping); err != nil {
		return ResetResult{}, err
	}

	return ResetResult{
		PresetID:    manifest.PresetID,
		ResetAgents: []string{manifestAgent.PresetKey},
		ResetSkills: resetSkillRefs,
	}, nil
}

// findPresetAgent locates the current preset-backed agent record. If no
// record exists, returns a zero AgentConfig and a freshly minted ID so the
// caller can recreate it.
func findPresetAgent(store Store, presetID, presetKey string, mapping model.PresetMapping) (model.AgentConfig, string, error) {
	agents, err := store.ListAgents()
	if err != nil {
		return model.AgentConfig{}, "", err
	}
	for _, a := range agents {
		if a.PresetID == presetID && a.PresetKey == presetKey && a.ArchivedAt.IsZero() {
			return a, a.ID, nil
		}
	}
	if id, ok := mapping.AgentIDs[presetKey]; ok {
		if a, err := store.GetAgent(id); err == nil {
			return a, a.ID, nil
		}
	}
	return model.AgentConfig{}, id.New(), nil
}

// resetSkillsForAgent ensures every factory skill_ref has a SkillRecord, then
// overwrites SKILL.md from embedded content. Returns the agent's skill_ids
// list and the list of preset_keys whose content was reset.
func resetSkillsForAgent(store Store, presetID string, agent ManifestAgent, mapping model.PresetMapping) (skillIDs []string, resetRefs []string, err error) {
	existing, err := indexSkillsByPresetKey(store, presetID)
	if err != nil {
		return nil, nil, err
	}
	records, err := store.ListSkills()
	if err != nil {
		return nil, nil, err
	}
	now := nowUTC()
	dirty := false

	for _, ref := range agent.SkillRefs {
		rec, ok := existing[ref]
		if !ok {
			if id, hasMapping := mapping.SkillIDs[ref]; hasMapping {
				for _, r := range records {
					if r.ID == id && r.ArchivedAt.IsZero() {
						rec = r
						ok = true
						break
					}
				}
			}
		}
		if !ok {
			rec = model.SkillRecord{
				ID:        id.New(),
				Name:      SkillDisplayName(ref),
				Path:      store.SkillDir(""), // placeholder; rewritten below
				PresetID:  presetID,
				PresetKey: ref,
				UpdatedAt: now,
			}
			rec.Path = store.SkillDir(rec.ID)
			records = append(records, rec)
			dirty = true
		}
		mapping.SkillIDs[ref] = rec.ID
		skillIDs = append(skillIDs, rec.ID)
		resetRefs = append(resetRefs, ref)
	}
	if dirty {
		if err := store.SaveSkills(records); err != nil {
			return nil, nil, err
		}
	}
	// Overwrite SKILL.md content for each ref.
	for _, ref := range agent.SkillRefs {
		files, fileErr := readEmbeddedSkillFiles(ref)
		if fileErr != nil {
			return nil, nil, fileErr
		}
		content, hasSkill := files["SKILL.md"]
		if !hasSkill {
			return nil, nil, fmt.Errorf("preset skill %q missing SKILL.md", ref)
		}
		skillID := mapping.SkillIDs[ref]
		if err := store.PutSkillFile(skillID, "SKILL.md", content); err != nil {
			return nil, nil, err
		}
	}
	return skillIDs, resetRefs, nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstNonZeroTime(t time.Time, fallback time.Time) time.Time {
	if !t.IsZero() {
		return t
	}
	return fallback
}
