package presets

import (
	"fmt"

	"github.com/sqtech/crew-ai/crewai-repo/internal/id"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

// SeedDefaultCrew is the startup-time seed. It creates the four preset agents
// and their skills, writes the preset mapping, and returns an error if any
// step fails. On error it rolls back records created during this call so the
// store does not end with a partial crew.
//
// Caller is responsible for the empty-state check; SeedDefaultCrew unconditionally
// creates records. bootstrapDefaultState() guards on ListAgents()==0.
func SeedDefaultCrew(store Store, runtime model.RuntimeRecord) error {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		return err
	}
	_, err = applyPresetSeed(store, manifest, runtime, applyOptions{recreateMissing: true})
	return err
}

// MergeDefaultCrew is the manual-add path (POST /api/presets/default-crew/seed).
// It creates any preset agents that are missing by preset_key/mapping, skips
// those that already exist, and reports per-agent results. Idempotent.
func MergeDefaultCrew(store Store, runtime model.RuntimeRecord) (SeedResult, error) {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		return SeedResult{}, err
	}
	return applyPresetSeed(store, manifest, runtime, applyOptions{recreateMissing: true})
}

// SeedResult describes what changed in a seed or merge call.
type SeedResult struct {
	PresetID      string   `json:"preset_id"`
	CreatedAgents []string `json:"created_agents"`
	SkippedAgents []string `json:"skipped_agents"`
	CreatedSkills int      `json:"created_skills"`
	SkippedSkills int      `json:"skipped_skills"`
}

type applyOptions struct {
	// recreateMissing controls whether a mapped agent whose record was deleted
	// gets recreated. True for both startup seed (empty state) and manual seed.
	recreateMissing bool
}

// applyPresetSeed is the shared engine for SeedDefaultCrew and MergeDefaultCrew.
// It creates only what is missing, rolls back on failure, and updates the
// preset mapping atomically per agent.
func applyPresetSeed(store Store, manifest Manifest, runtime model.RuntimeRecord, opts applyOptions) (SeedResult, error) {
	mapping, err := store.LoadPresetMapping(manifest.PresetID)
	if err != nil {
		return SeedResult{}, err
	}
	mapping.PresetID = manifest.PresetID
	mapping.Version = manifest.Version

	existing, err := indexAgentsByPresetKey(store, manifest.PresetID)
	if err != nil {
		return SeedResult{}, err
	}

	result := SeedResult{PresetID: manifest.PresetID}

	// Track records created in THIS call for rollback on failure.
	var createdAgentIDs []string
	var createdSkillIDs []string
	rollback := func() {
		for _, sid := range createdSkillIDs {
			_ = store.DeleteSkill(sid)
		}
		for _, aid := range createdAgentIDs {
			_ = store.DeleteAgent(aid)
		}
	}

	for _, agent := range manifest.Agents {
		existingAgent, isPresent := existing[agent.PresetKey]
		if !isPresent && opts.recreateMissing {
			if id, ok := mapping.AgentIDs[agent.PresetKey]; ok {
				if a, err := store.GetAgent(id); err == nil && a.ArchivedAt.IsZero() {
					existingAgent = a
					isPresent = true
				}
			}
		}
		if isPresent {
			result.SkippedAgents = append(result.SkippedAgents, agent.PresetKey)
			result.SkippedSkills += len(agent.SkillRefs)
			// Keep mapping pointed at the actual existing agent.
			mapping.AgentIDs[agent.PresetKey] = existingAgent.ID
			continue
		}

		skillIDs, newSkillIDs, err := createSkillsForAgent(store, manifest.PresetID, agent, mapping)
		if err != nil {
			rollback()
			return SeedResult{}, err
		}
		createdSkillIDs = append(createdSkillIDs, newSkillIDs...)
		result.CreatedSkills += len(newSkillIDs)
		result.SkippedSkills += len(agent.SkillRefs) - len(newSkillIDs)

		instruction, err := readEmbeddedInstruction(agent)
		if err != nil {
			rollback()
			return SeedResult{}, err
		}

		now := nowUTC()
		newAgent := model.AgentConfig{
			ID:          id.New(),
			Name:        agent.Name,
			Instruction: instruction,
			RuntimeID:   runtime.ID,
			Model:       defaultRuntimeModel(runtime),
			SkillIDs:    skillIDs,
			PresetID:    manifest.PresetID,
			PresetKey:   agent.PresetKey,
			CreatedAt:   now,
			UpdatedAt:   now,
		}
		if err := store.SaveAgent(newAgent); err != nil {
			rollback()
			return SeedResult{}, err
		}
		createdAgentIDs = append(createdAgentIDs, newAgent.ID)
		result.CreatedAgents = append(result.CreatedAgents, agent.PresetKey)
		mapping.AgentIDs[agent.PresetKey] = newAgent.ID
	}

	mapping.SeededAt = nowUTC()
	if err := store.SavePresetMapping(mapping); err != nil {
		rollback()
		return SeedResult{}, err
	}
	return result, nil
}

// createSkillsForAgent ensures every skill_ref for an agent has a SkillRecord
// in the store. Returns the full skill_ids list for the agent and the subset
// of skill IDs newly created in this call (for rollback).
func createSkillsForAgent(store Store, presetID string, agent ManifestAgent, mapping model.PresetMapping) (allIDs []string, newIDs []string, err error) {
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
		if rec, ok := existing[ref]; ok && rec.ArchivedAt.IsZero() {
			allIDs = append(allIDs, rec.ID)
			mapping.SkillIDs[ref] = rec.ID
			continue
		}
		// Mapping fallback for skills whose metadata was lost.
		if id, ok := mapping.SkillIDs[ref]; ok {
			for _, rec := range records {
				if rec.ID == id && rec.ArchivedAt.IsZero() {
					allIDs = append(allIDs, rec.ID)
					existing[ref] = rec
					goto next
				}
			}
		}

		{
			newID := id.New()
			rec := model.SkillRecord{
				ID:        newID,
				Name:      SkillDisplayName(ref),
				Path:      store.SkillDir(newID),
				PresetID:  presetID,
				PresetKey: ref,
				UpdatedAt: now,
			}
			records = append(records, rec)
			dirty = true
			files, fileErr := readEmbeddedSkillFiles(ref)
			if fileErr != nil {
				return nil, newIDs, fileErr
			}
			if _, hasSkill := files["SKILL.md"]; !hasSkill {
				return nil, newIDs, fmt.Errorf("preset skill %q missing SKILL.md", ref)
			}
			// Persist registry BEFORE writing files so PutSkillFile validates the skill exists.
			if err := store.SaveSkills(records); err != nil {
				return nil, newIDs, err
			}
			dirty = false
			for fileID, content := range files {
				if err := store.PutSkillFile(newID, fileID, content); err != nil {
					return nil, append(newIDs, newID), err
				}
			}
			allIDs = append(allIDs, newID)
			newIDs = append(newIDs, newID)
			existing[ref] = rec
			mapping.SkillIDs[ref] = newID
		}
	next:
	}
	if dirty {
		if err := store.SaveSkills(records); err != nil {
			return nil, newIDs, err
		}
	}
	return allIDs, newIDs, nil
}

// indexAgentsByPresetKey returns active preset-backed agents keyed by preset_key.
func indexAgentsByPresetKey(store Store, presetID string) (map[string]model.AgentConfig, error) {
	agents, err := store.ListAgents()
	if err != nil {
		return nil, err
	}
	out := make(map[string]model.AgentConfig, len(agents))
	for _, a := range agents {
		if a.PresetID == presetID && a.PresetKey != "" && a.ArchivedAt.IsZero() {
			out[a.PresetKey] = a
		}
	}
	return out, nil
}

// indexSkillsByPresetKey returns preset-backed skills keyed by preset_key.
func indexSkillsByPresetKey(store Store, presetID string) (map[string]model.SkillRecord, error) {
	skills, err := store.ListSkills()
	if err != nil {
		return nil, err
	}
	out := make(map[string]model.SkillRecord, len(skills))
	for _, s := range skills {
		if s.PresetID == presetID && s.PresetKey != "" && s.ArchivedAt.IsZero() {
			out[s.PresetKey] = s
		}
	}
	return out, nil
}

func defaultRuntimeModel(record model.RuntimeRecord) string {
	if value, ok := record.Metadata["model"].(string); ok {
		return value
	}
	return ""
}
