package app

import (
	"context"
	"errors"
	"fmt"
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

// InstallRecruitAgent performs the full install: resolve tag from
// manifest.version, fetch AGENT.md + each SKILL.md at the pinned tag,
// pick the local default runtime, create or update the agent and its
// declared skills idempotently. Suggested_runtime in the manifest is
// ignored at install time (display-only).
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
	agentBody, err := a.recruit.FetchAtRef(ctx, coord, tag, "AGENT.md")
	if err != nil {
		if errors.Is(err, recruit.ErrTagNotFound) {
			return model.AgentConfig{}, fmt.Errorf("%w: AGENT.md missing at release %s", ErrBadRequest, tag)
		}
		return model.AgentConfig{}, mapRecruitError(err)
	}

	runtimeRecord, err := a.pickAvailableRuntime()
	if err != nil {
		return model.AgentConfig{}, fmt.Errorf("install a runtime first: %w", err)
	}

	skillFiles := make(map[string]string, len(pinnedManifest.Skills))
	for _, decl := range pinnedManifest.Skills {
		body, err := a.recruit.FetchAtRef(ctx, coord, tag, decl.Path)
		if err != nil {
			if errors.Is(err, recruit.ErrTagNotFound) {
				return model.AgentConfig{}, fmt.Errorf("%w: skill file missing at release %s: %s", ErrBadRequest, tag, decl.Path)
			}
			return model.AgentConfig{}, mapRecruitError(err)
		}
		skillFiles[decl.Path] = body
	}

	skillIDs, err := a.upsertRecruitSkills(entry.RepoURL, pinnedManifest, skillFiles)
	if err != nil {
		return model.AgentConfig{}, err
	}

	return a.upsertRecruitAgent(entry, pinnedManifest, agentBody, runtimeRecord.ID, skillIDs)
}

// upsertRecruitAgent finds an existing agent with the same Source.RepoURL
// and overwrites it; otherwise creates a new one. The agent's UpdatedAt
// bumps either way so the UI's list-by-mtime sort puts the just-recruited
// agent on top.
func (a *App) upsertRecruitAgent(
	entry recruit.RegistryEntry,
	manifest recruit.Manifest,
	agentBody string,
	runtimeID string,
	skillIDs []string,
) (model.AgentConfig, error) {
	agents, err := a.store.ListAgents()
	if err != nil {
		return model.AgentConfig{}, err
	}
	now := time.Now().UTC()
	source := &model.AgentSource{
		RegistryID:  entry.ID,
		RepoURL:     entry.RepoURL,
		Version:     manifest.Version,
		InstalledAt: now,
	}
	for _, existing := range agents {
		if existing.Source != nil && existing.Source.RepoURL == entry.RepoURL {
			existing.Name = manifest.Name
			existing.Description = strings.TrimSpace(manifest.Description)
			existing.Instruction = agentBody
			existing.RuntimeID = runtimeID
			existing.Model = ""
			existing.SkillIDs = skillIDs
			existing.Source = source
			existing.ArchivedAt = time.Time{}
			existing.UpdatedAt = now
			if err := a.store.SaveAgent(existing); err != nil {
				return model.AgentConfig{}, err
			}
			return existing, nil
		}
	}
	agent := model.AgentConfig{
		ID:          id.New(),
		Name:        manifest.Name,
		Description: strings.TrimSpace(manifest.Description),
		Instruction: agentBody,
		RuntimeID:   runtimeID,
		Model:       "",
		SkillIDs:    skillIDs,
		Source:      source,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := a.store.SaveAgent(agent); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

// upsertRecruitSkills creates or updates skill records keyed by the
// (RepoURL, in-repo Path) tuple. Same source tuple = reuse the record
// and overwrite SKILL.md; different tuple (including same name from a
// different repo) = new record. Returns the ordered skill IDs to attach
// to the agent.
func (a *App) upsertRecruitSkills(
	repoURL string,
	manifest recruit.Manifest,
	files map[string]string,
) ([]string, error) {
	skills, err := a.store.ListSkills()
	if err != nil {
		return nil, err
	}
	bySource := make(map[string]int, len(skills))
	for i, s := range skills {
		if s.Source != nil && s.Source.RepoURL == repoURL {
			bySource[s.Source.Path] = i
		}
	}
	now := time.Now().UTC()
	out := make([]string, 0, len(manifest.Skills))
	for _, decl := range manifest.Skills {
		if _, ok := files[decl.Path]; !ok {
			return nil, fmt.Errorf("missing skill body for %s", decl.Path)
		}
		source := &model.SkillSource{
			RepoURL: repoURL,
			Path:    decl.Path,
			Version: manifest.Version,
		}
		if idx, hit := bySource[decl.Path]; hit {
			skills[idx].Name = decl.Name
			skills[idx].Source = source
			skills[idx].UpdatedAt = now
			skills[idx].ArchivedAt = time.Time{}
			out = append(out, skills[idx].ID)
			continue
		}
		newID := id.New()
		record := model.SkillRecord{
			ID:        newID,
			Name:      decl.Name,
			Path:      a.store.SkillDir(newID),
			Source:    source,
			UpdatedAt: now,
		}
		skills = append(skills, record)
		out = append(out, newID)
	}
	if err := a.store.SaveSkills(skills); err != nil {
		return nil, err
	}
	for _, decl := range manifest.Skills {
		var skillID string
		for _, s := range skills {
			if s.Source != nil && s.Source.RepoURL == repoURL && s.Source.Path == decl.Path {
				skillID = s.ID
				break
			}
		}
		if skillID == "" {
			return nil, fmt.Errorf("internal: skill id not found after save: %s", decl.Path)
		}
		if err := a.store.PutSkillFile(skillID, "SKILL.md", files[decl.Path]); err != nil {
			return nil, err
		}
	}
	return out, nil
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
		errors.Is(err, recruit.ErrRepoURLInvalid):
		return errors.Join(ErrBadRequest, err)
	}
	return err
}
