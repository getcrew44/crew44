package store

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// AgentDir is the per-agent root directory under ~/.crew44/agents.
// Houses config.json, source/, source.prev/, source.tmp-<id>/, and
// recruited-skills.json. Returned even when the agent has never been
// recruited so the install flow can mkdir it idempotently.
func (s *Store) AgentDir(agentID string) string {
	return filepath.Join(s.root, "agents", "agent-"+agentID)
}

// AgentSourceDir is the durable installed-repo payload directory for a
// recruited agent. Stored as AgentSource.SourceDir on the AgentConfig
// record and resolved against agent-private skill paths at runtime.
func (s *Store) AgentSourceDir(agentID string) string {
	return filepath.Join(s.AgentDir(agentID), "source")
}

// AgentSourceTmpDir is the staging directory the installer extracts a
// filtered payload into before the atomic source/ rotation. installID
// is per-install so two concurrent reinstalls cannot collide.
func (s *Store) AgentSourceTmpDir(agentID, installID string) string {
	return filepath.Join(s.AgentDir(agentID), "source.tmp-"+installID)
}

// AgentSourcePrevDir is the parking spot the rotation step moves the
// current source/ to right before the new source/ is renamed into
// place. Removed once the new source/ is committed; left untouched
// when a step before the final rename fails so the previous payload
// can be recovered.
func (s *Store) AgentSourcePrevDir(agentID string) string {
	return filepath.Join(s.AgentDir(agentID), "source.prev")
}

// RecruitedSkillsPath is the agent-private recruited skill metadata file.
// Indexes the manifest-declared skills with each entry pointing at a
// SKILL.md inside this same agent's source/ directory.
func (s *Store) RecruitedSkillsPath(agentID string) string {
	return filepath.Join(s.AgentDir(agentID), "recruited-skills.json")
}

// RecruitedSkillsTmpPath is the staging location for recruited-skills.json
// during install. Renamed into RecruitedSkillsPath after the source/
// rotation succeeds.
func (s *Store) RecruitedSkillsTmpPath(agentID, installID string) string {
	return filepath.Join(s.AgentDir(agentID), "recruited-skills.json.tmp-"+installID)
}

// RecruitGithubCacheDir is the reusable GitHub archive cache. Entries
// are keyed by (repo hash, tag) inside FetchArchive; the cache is an
// implementation detail and installed agents do not reference it at
// runtime.
func (s *Store) RecruitGithubCacheDir() string {
	return filepath.Join(s.root, "cache", "recruit", "github")
}

// RecruitTmpDir is reserved for short-lived extraction scratch work
// not yet bound to a specific agent (e.g., importer dry-runs in the
// future). The deterministic install path extracts straight into the
// agent's source.tmp-<install-id>/ so this dir is empty in v1.1, but
// the path is exposed so cleanup utilities can sweep it.
func (s *Store) RecruitTmpDir() string {
	return filepath.Join(s.root, "cache", "recruit", "tmp")
}

// LoadRecruitedSkills reads the agent-private recruited skill index.
// Missing file returns an empty slice with no error so callers can
// treat "never recruited" and "recruited but no skills" the same way.
func (s *Store) LoadRecruitedSkills(agentID string) ([]model.RecruitedSkill, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var entries []model.RecruitedSkill
	err := readJSON(s.RecruitedSkillsPath(agentID), &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return entries, err
}

// WriteRecruitedSkillsTmp persists the recruited-skills.json staging
// file used during install. The installer renames it into place after
// the source/ rotation completes.
func (s *Store) WriteRecruitedSkillsTmp(agentID, installID string, entries []model.RecruitedSkill) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(s.RecruitedSkillsTmpPath(agentID, installID), entries)
}

// RemoveRecruitedSkills deletes the recruited skill index. Used when
// an agent is archived/deleted so the next install of the same repo
// onto a fresh agent record cannot inherit stale skill metadata.
// Missing-file is not an error.
func (s *Store) RemoveRecruitedSkills(agentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.RecruitedSkillsPath(agentID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// CommitAgentInstall atomically swaps the staged source/ payload, the
// staged recruited-skills.json, and the agent's config.json into place
// in a single critical section. The previous source/, recruited-skills.json,
// and config.json are moved aside to .prev parking spots before any of
// the new artifacts are renamed in, so a failure in any step rolls back
// to the pre-install state. The .prev files are removed only after the
// new config.json is on disk; this is the point of no return.
//
// Caller contract: the staging dir (source.tmp-<installID>) and the
// staged recruited-skills.json.tmp-<installID> must already be fully
// populated. CommitAgentInstall does not validate their contents; the
// installer is expected to call ExtractFilteredPayload and verify
// required-file presence beforehand.
func (s *Store) CommitAgentInstall(agent model.AgentConfig, installID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	agentID := agent.ID
	sourceDir := s.AgentSourceDir(agentID)
	stagedSource := s.AgentSourceTmpDir(agentID, installID)
	prevSource := s.AgentSourcePrevDir(agentID)
	skillsPath := s.RecruitedSkillsPath(agentID)
	stagedSkills := s.RecruitedSkillsTmpPath(agentID, installID)
	prevSkills := skillsPath + ".prev"
	configPath := filepath.Join(s.AgentDir(agentID), "config.json")
	prevConfig := configPath + ".prev"

	if _, err := os.Stat(stagedSource); err != nil {
		return fmt.Errorf("recruit: staged source missing: %w", err)
	}
	if _, err := os.Stat(stagedSkills); err != nil {
		return fmt.Errorf("recruit: staged recruited-skills.json missing: %w", err)
	}
	if err := os.MkdirAll(s.AgentDir(agentID), 0o755); err != nil {
		return err
	}

	// Sweep stale parking artifacts from a previously aborted install.
	// Anything under a .prev path is by definition a previous install
	// the user has already left behind; rolling those back would
	// resurrect arbitrarily old state.
	if err := os.RemoveAll(prevSource); err != nil {
		return err
	}
	if err := os.Remove(prevSkills); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Remove(prevConfig); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	hadSource := pathExists(sourceDir)
	hadSkills := pathExists(skillsPath)
	hadConfig := pathExists(configPath)

	// Stage 1: park existing artifacts under .prev paths so the
	// new artifacts can drop into the canonical locations.
	parked := []func(){}
	parkErr := func(restore []func(), err error) error {
		for i := len(restore) - 1; i >= 0; i-- {
			restore[i]()
		}
		return err
	}
	if hadSource {
		if err := os.Rename(sourceDir, prevSource); err != nil {
			return err
		}
		parked = append(parked, func() { os.Rename(prevSource, sourceDir) })
	}
	if hadSkills {
		if err := os.Rename(skillsPath, prevSkills); err != nil {
			return parkErr(parked, err)
		}
		parked = append(parked, func() { os.Rename(prevSkills, skillsPath) })
	}
	if hadConfig {
		if err := os.Rename(configPath, prevConfig); err != nil {
			return parkErr(parked, err)
		}
		parked = append(parked, func() { os.Rename(prevConfig, configPath) })
	}

	rollback := func(err error) error {
		// Undo any partially-applied new artifacts before restoring.
		os.RemoveAll(sourceDir)
		os.Remove(skillsPath)
		os.Remove(configPath)
		return parkErr(parked, err)
	}

	// Stage 2: apply new artifacts. After every rename succeeds, the
	// staged paths no longer exist so the deferred CleanupAgentSourceTmp
	// becomes a no-op for the consumed entries.
	if err := os.Rename(stagedSource, sourceDir); err != nil {
		return rollback(err)
	}
	if err := os.Rename(stagedSkills, skillsPath); err != nil {
		return rollback(err)
	}
	if err := writeJSON(configPath, agent); err != nil {
		return rollback(err)
	}

	// Point of no return: the new install is durable, so it's safe to
	// drop the parked previous artifacts. Errors here are logged
	// implicitly — leftover .prev files only waste disk and do not
	// affect agent runtime correctness.
	os.RemoveAll(prevSource)
	os.Remove(prevSkills)
	os.Remove(prevConfig)
	return nil
}

func pathExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// CleanupAgentSourceTmp removes a staging directory and the staged
// recruited-skills tmp file. Called by the installer on the failure
// path so a failed install never leaks orphan directories.
func (s *Store) CleanupAgentSourceTmp(agentID, installID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	os.RemoveAll(s.AgentSourceTmpDir(agentID, installID))
	os.Remove(s.RecruitedSkillsTmpPath(agentID, installID))
}

// RemoveAgentSourceTree wipes source/, source.prev/, and any leftover
// staging dirs for an agent. Called when the agent is deleted so
// disk usage tracks the visible agent list.
func (s *Store) RemoveAgentSourceTree(agentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.RemoveAll(s.AgentSourceDir(agentID)); err != nil {
		return err
	}
	if err := os.RemoveAll(s.AgentSourcePrevDir(agentID)); err != nil {
		return err
	}
	// Sweep any source.tmp-* siblings.
	entries, err := os.ReadDir(s.AgentDir(agentID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		name := e.Name()
		if len(name) > len("source.tmp-") && name[:len("source.tmp-")] == "source.tmp-" {
			os.RemoveAll(filepath.Join(s.AgentDir(agentID), name))
		}
	}
	return nil
}
