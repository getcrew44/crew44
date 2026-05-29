package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/recruit"
)

// RecruitListItem is one row in the Recruit browse view. Installed is set
// when an existing agent's Source.RepoURL matches this entry's RepoURL,
// so the UI can render the "Added" badge without an extra round-trip.
type RecruitListItem struct {
	recruit.RegistryEntry
	Installed bool `json:"installed"`
}

// ListRecruitAgents fetches the registry and annotates each entry with an
// installed flag computed from local agent.Source.RepoURL. Returns a
// flat list in registry order; UI handles sort/filter.
func (a *App) ListRecruitAgents(ctx context.Context) ([]RecruitListItem, error) {
	env, err := a.recruit.FetchRegistry(ctx)
	if err != nil {
		return nil, mapRecruitError(err)
	}
	installed, err := a.installedRepoURLs()
	if err != nil {
		return nil, err
	}
	out := make([]RecruitListItem, 0, len(env.Agents))
	for _, entry := range env.Agents {
		out = append(out, RecruitListItem{
			RegistryEntry: entry,
			Installed:     installed[entry.RepoURL],
		})
	}
	return out, nil
}

// GetRecruitAgent fetches the per-repo manifest at HEAD and the AGENT.md
// body at HEAD. Detail is intentionally read at HEAD (not at the version
// tag) so the UI shows the author's latest intent; install pins to the
// version tag separately.
func (a *App) GetRecruitAgent(ctx context.Context, registryID string) (recruit.AgentDetail, error) {
	entry, err := a.findRegistryEntry(ctx, registryID)
	if err != nil {
		return recruit.AgentDetail{}, err
	}
	manifest, coord, err := a.recruit.FetchManifest(ctx, entry.RepoURL)
	if err != nil {
		return recruit.AgentDetail{}, mapRecruitError(err)
	}
	agentBody, err := a.recruit.FetchAtRef(ctx, coord, recruit.DefaultRegistryRef, "AGENT.md")
	if err != nil {
		if errors.Is(err, recruit.ErrTagNotFound) {
			return recruit.AgentDetail{}, fmt.Errorf("%w: AGENT.md missing in repo", ErrBadRequest)
		}
		return recruit.AgentDetail{}, mapRecruitError(err)
	}
	return recruit.AgentDetail{
		Entry:     entry,
		Manifest:  manifest,
		AgentBody: agentBody,
	}, nil
}

// InstallRecruitAgent performs the full install: resolve the tag from
// manifest.version, download the tagged GitHub archive, extract the
// manifest-declared payload into a staged directory under the agent's
// dir, atomically rotate source/ into place, and write the agent-private
// recruited-skills.json index. suggested_runtime in the manifest is
// ignored at install time (display-only). The deterministic install
// path does not call the model — generation only happens in the
// importer (Phase 3).
func (a *App) InstallRecruitAgent(ctx context.Context, registryID string) (model.AgentConfig, error) {
	entry, err := a.findRegistryEntry(ctx, registryID)
	if err != nil {
		return model.AgentConfig{}, err
	}
	headManifest, coord, err := a.recruit.FetchManifest(ctx, entry.RepoURL)
	if err != nil {
		return model.AgentConfig{}, mapRecruitError(err)
	}
	tag, pinnedManifest, err := a.recruit.ResolveTag(ctx, coord, headManifest.Version)
	if err != nil {
		if errors.Is(err, recruit.ErrTagNotFound) {
			return model.AgentConfig{}, fmt.Errorf("%w: author has not published release %s yet", ErrBadRequest, headManifest.Version)
		}
		return model.AgentConfig{}, mapRecruitError(err)
	}

	runtimeRecord, err := a.pickAvailableRuntime()
	if err != nil {
		return model.AgentConfig{}, fmt.Errorf("install a runtime first: %w", err)
	}

	// Settle the target agent ID before extracting so the staged
	// directory lives inside the final agent dir and the rotation is
	// a same-filesystem rename. Reusing the existing agent ID keeps
	// recruited-skills.json and runtime-env continuity across version
	// bumps for the same RepoURL.
	existing, err := a.findRecruitedAgent(entry.RepoURL)
	if err != nil {
		return model.AgentConfig{}, err
	}
	agentID := ""
	if existing != nil {
		agentID = existing.ID
	} else {
		agentID = id.New()
	}

	installID := id.New()
	staged := a.store.AgentSourceTmpDir(agentID, installID)
	if err := os.MkdirAll(staged, 0o755); err != nil {
		return model.AgentConfig{}, err
	}
	// Guarantee staged + tmp recruited-skills are cleaned up on every
	// failure path. CleanupAgentSourceTmp is a no-op once the staging
	// dir has been renamed into source/.
	defer a.store.CleanupAgentSourceTmp(agentID, installID)

	archivePath, err := a.recruit.FetchArchive(ctx, coord, tag, a.store.RecruitGithubCacheDir())
	if err != nil {
		if errors.Is(err, recruit.ErrTagNotFound) {
			return model.AgentConfig{}, fmt.Errorf("%w: release archive missing at %s", ErrBadRequest, tag)
		}
		if errors.Is(err, recruit.ErrArchiveTooLarge) {
			return model.AgentConfig{}, fmt.Errorf("%w: %v", ErrBadRequest, err)
		}
		return model.AgentConfig{}, mapRecruitError(err)
	}

	resolved := recruit.ResolvePayload(&pinnedManifest)
	written, err := recruit.ExtractFilteredPayload(archivePath, staged, resolved)
	if err != nil {
		return model.AgentConfig{}, mapRecruitError(err)
	}
	writtenSet := make(map[string]bool, len(written))
	for _, p := range written {
		writtenSet[p] = true
	}

	// AGENT.md is the runtime instruction the agent uses as its system
	// prompt. Missing it after filtering means either the author forgot
	// to include it in the payload spec or stripped it via .gitattributes
	// export-ignore upstream. Either way, install can't proceed.
	if !writtenSet["AGENT.md"] {
		return model.AgentConfig{}, fmt.Errorf("%w: AGENT.md missing from release %s payload", ErrBadRequest, tag)
	}
	for _, decl := range pinnedManifest.Skills {
		if !writtenSet[decl.Path] {
			return model.AgentConfig{}, fmt.Errorf("%w: %v: %s", ErrBadRequest, recruit.ErrPayloadMissingFile, decl.Path)
		}
	}

	agentBodyBytes, err := os.ReadFile(filepath.Join(staged, "AGENT.md"))
	if err != nil {
		return model.AgentConfig{}, mapRecruitError(err)
	}
	agentBody := string(agentBodyBytes)

	// Recruited skill metadata is generated against the final source/
	// path so the file is correct as-is once the rotation completes; the
	// rotation never moves the file, only swaps the parent directory in.
	finalSource := a.store.AgentSourceDir(agentID)
	recruited := make([]model.RecruitedSkill, 0, len(pinnedManifest.Skills))
	for _, decl := range pinnedManifest.Skills {
		recruited = append(recruited, model.RecruitedSkill{
			Name:       decl.Name,
			Path:       decl.Path,
			SourcePath: filepath.Join(finalSource, filepath.FromSlash(decl.Path)),
			Version:    pinnedManifest.Version,
		})
	}
	if err := a.store.WriteRecruitedSkillsTmp(agentID, installID, recruited); err != nil {
		return model.AgentConfig{}, err
	}

	// Build the final agent record before the atomic commit so the
	// commit operates on a fully-resolved AgentConfig — any failure
	// after this rolls back to the previous source/, recruited-skills,
	// and config in one shot.
	finalAgent := a.buildRecruitedAgentRecord(agentID, existing, entry, pinnedManifest, agentBody, runtimeRecord.ID, finalSource)
	if err := a.store.CommitAgentInstall(finalAgent, installID); err != nil {
		return model.AgentConfig{}, err
	}

	// Drop any legacy global SkillRecord entries this repo created
	// under the pre-payload installer. Best-effort: agent install is
	// already durable, so a failure here only leaves stale rows in
	// the user-managed skills list (recoverable by hand) and must
	// not undo a successful install.
	if err := a.purgeLegacyGlobalRecruitedSkills(entry.RepoURL); err != nil {
		return finalAgent, err
	}
	return finalAgent, nil
}

// buildRecruitedAgentRecord returns the AgentConfig the atomic commit
// step will persist. For first-time installs the record is brand new;
// for reinstalls of the same repo, existing CreatedAt is preserved so
// the UI's by-creation sort doesn't shuffle agents on every update.
func (a *App) buildRecruitedAgentRecord(
	agentID string,
	existing *model.AgentConfig,
	entry recruit.RegistryEntry,
	manifest recruit.Manifest,
	agentBody string,
	runtimeID string,
	sourceDir string,
) model.AgentConfig {
	now := time.Now().UTC()
	source := &model.AgentSource{
		RegistryID:  entry.ID,
		RepoURL:     entry.RepoURL,
		Version:     manifest.Version,
		InstalledAt: now,
		SourceDir:   sourceDir,
	}
	if existing != nil {
		existing.Name = manifest.Name
		existing.Description = strings.TrimSpace(manifest.Description)
		existing.Instruction = agentBody
		existing.RuntimeID = runtimeID
		existing.Model = ""
		// Agent-private recruited skills do not live in SkillIDs.
		// Clear any legacy IDs from the old installer so the runtime
		// path doesn't try to load now-deleted global skill records.
		existing.SkillIDs = nil
		existing.Source = source
		existing.ArchivedAt = time.Time{}
		existing.UpdatedAt = now
		return *existing
	}
	return model.AgentConfig{
		ID:          agentID,
		Name:        manifest.Name,
		Description: strings.TrimSpace(manifest.Description),
		Instruction: agentBody,
		RuntimeID:   runtimeID,
		Model:       "",
		SkillIDs:    nil,
		Source:      source,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// purgeLegacyGlobalRecruitedSkills removes SkillRecord entries created
// by the pre-payload recruit installer (which wrote agent-recruited
// skills to the global ~/.crew44/skills/ store). New recruit-installed
// skills are agent-private; leftover global records from past installs
// would shadow the new layout.
func (a *App) purgeLegacyGlobalRecruitedSkills(repoURL string) error {
	skills, err := a.store.ListSkills()
	if err != nil {
		return err
	}
	keep := make([]model.SkillRecord, 0, len(skills))
	var dropped []string
	for _, s := range skills {
		if s.Source != nil && s.Source.RepoURL == repoURL {
			dropped = append(dropped, s.ID)
			continue
		}
		keep = append(keep, s)
	}
	if len(dropped) == 0 {
		return nil
	}
	if err := a.store.SaveSkills(keep); err != nil {
		return err
	}
	for _, skillID := range dropped {
		if err := os.RemoveAll(a.store.SkillDir(skillID)); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) installedRepoURLs() (map[string]bool, error) {
	agents, err := a.store.ListAgents()
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(agents))
	for _, agent := range agents {
		if agent.Source != nil && agent.Source.RepoURL != "" && agent.ArchivedAt.IsZero() {
			out[agent.Source.RepoURL] = true
		}
	}
	return out, nil
}

// findRecruitedAgent returns the existing recruited agent for repoURL,
// or nil if none exists. Used to settle the agent ID and resolve the
// idempotent reinstall path.
func (a *App) findRecruitedAgent(repoURL string) (*model.AgentConfig, error) {
	agents, err := a.store.ListAgents()
	if err != nil {
		return nil, err
	}
	for i := range agents {
		ag := agents[i]
		if ag.Source != nil && ag.Source.RepoURL == repoURL {
			return &ag, nil
		}
	}
	return nil, nil
}

func (a *App) findRegistryEntry(ctx context.Context, registryID string) (recruit.RegistryEntry, error) {
	env, err := a.recruit.FetchRegistry(ctx)
	if err != nil {
		return recruit.RegistryEntry{}, mapRecruitError(err)
	}
	for _, entry := range env.Agents {
		if entry.ID == registryID {
			return entry, nil
		}
	}
	return recruit.RegistryEntry{}, ErrNotFound
}

// mapRecruitError converts errors emitted by the registry client into
// app-layer sentinels the RPC boundary already knows how to translate.
// Metadata problems (invalid manifest, unsafe path, invalid registry,
// version mismatch, bad repo url) are joined with ErrBadRequest so the
// UI sees the underlying message instead of a generic "internal error",
// and tests can still detect the original recruit sentinel via
// errors.Is. Network errors and other unexpected failures pass through
// unchanged and remain internal.
func mapRecruitError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, recruit.ErrManifestInvalid),
		errors.Is(err, recruit.ErrUnsafePath),
		errors.Is(err, recruit.ErrRegistryInvalid),
		errors.Is(err, recruit.ErrVersionMismatch),
		errors.Is(err, recruit.ErrRepoURLInvalid),
		errors.Is(err, recruit.ErrArchiveTraversal),
		errors.Is(err, recruit.ErrArchiveSymlinkEscape),
		errors.Is(err, recruit.ErrArchiveUnsupported),
		errors.Is(err, recruit.ErrPayloadTooLarge),
		errors.Is(err, recruit.ErrPayloadFileTooLarge),
		errors.Is(err, recruit.ErrPayloadTooManyFiles),
		errors.Is(err, recruit.ErrPayloadMissingFile):
		return errors.Join(ErrBadRequest, err)
	}
	return err
}
