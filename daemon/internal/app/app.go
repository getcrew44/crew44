package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	backendagent "github.com/getcrew44/crew44/daemon/internal/backendagent"
	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/optimizer"
	"github.com/getcrew44/crew44/daemon/internal/presets"
	"github.com/getcrew44/crew44/daemon/internal/recruit"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
	"github.com/getcrew44/crew44/daemon/internal/store"
)

type Config struct {
	StateDir       string
	RuntimeScanDir string
	Scanner        runtime.Scanner
	Engine         runtime.Engine
	// Recruit overrides the default registry client. Nil = use production
	// defaults (raw.githubusercontent.com / getcrew44/agent-registry).
	// Tests inject an httptest-backed client through this field.
	Recruit *recruit.Client
}

type App struct {
	store          *store.Store
	runtimeScanDir string
	scanner        runtime.Scanner
	engine         runtime.Engine
	broker         *broker.Broker[model.Event]

	mu   sync.Mutex
	runs map[string]*chatRunController

	// presetMu serializes seed/reset operations on the same preset so two
	// concurrent API calls cannot create duplicate records.
	presetMu sync.Mutex

	// Optimizer subsystem; wired in initOptimizer after bootstrap.
	optimizer          *optimizer.Manager
	optimizerScheduler *optimizer.Scheduler

	// recruit fetches the agent registry and per-repo manifests. Lazily
	// initialized to production defaults if Config.Recruit is nil.
	recruit *recruit.Client
}

func New(cfg Config) (*App, error) {
	st, err := store.New(cfg.StateDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.RuntimeScanDir, 0o755); err != nil {
		return nil, err
	}
	recruitClient := cfg.Recruit
	if recruitClient == nil {
		recruitClient = recruit.NewClient(recruit.Config{})
	}
	app := &App{
		store:          st,
		runtimeScanDir: cfg.RuntimeScanDir,
		scanner:        firstScanner(cfg.Scanner),
		engine:         firstEngine(cfg.Engine),
		broker:         broker.New[model.Event](),
		runs:           make(map[string]*chatRunController),
		recruit:        recruitClient,
	}
	if err := app.bootstrapDefaultState(); err != nil {
		return nil, err
	}
	if err := app.seedOptimizerProject(); err != nil {
		return nil, err
	}
	if err := app.initOptimizer(); err != nil {
		return nil, err
	}
	return app, nil
}

// reconcileStaleStream detects and repairs a chat whose stream.status is
// persisted as "streaming" but has no live runChat goroutine. Such chats
// represent runs interrupted by the previous daemon exit (crash, quit,
// SIGTERM); the goroutine that would have called finishChatSuccess never got
// the chance. Returns the chat record (possibly updated to "idle"). Idempotent
// and safe under concurrent callers: serialized on a.mu.
//
// Detection signal: PostMessage holds a.mu while it both writes
// stream.status="streaming" and inserts into a.runs, so the pair is atomic.
// status=="streaming" AND no a.runs entry therefore means a stale record.
func (a *App) reconcileStaleStream(chat model.ChatRecord) model.ChatRecord {
	if chat.Stream.Status != "streaming" {
		return chat
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.reconcileStaleStreamLocked(chat)
}

func (a *App) reconcileStaleStreamLocked(chat model.ChatRecord) model.ChatRecord {
	if chat.Stream.Status != "streaming" {
		return chat
	}
	fresh, err := a.store.GetChat(chat.ID)
	if err != nil {
		return chat
	}
	if fresh.Stream.Status != "streaming" {
		return fresh
	}
	if _, active := a.runs[chat.ID]; active {
		return fresh
	}
	now := time.Now().UTC()
	actorAgentID := fresh.Stream.AgentID
	if actorAgentID == "" {
		actorAgentID = fresh.CurrentAgentID
	}
	payload := model.ErrorPayload{
		Subtype: "interrupted",
		Code:    "stream_interrupted",
		Message: "Daemon restarted while the agent was running. The turn was interrupted.",
		AgentID: actorAgentID,
	}
	if payload.AgentID != "" {
		if agent, agentErr := a.store.GetAgent(payload.AgentID); agentErr == nil {
			payload.AgentName = agent.Name
		}
	}
	if _, err := a.store.AppendEvent(fresh.ID, model.Event{
		Type:         model.EventTypeError,
		TS:           now,
		TurnID:       fresh.ActiveTurnID,
		ActorAgentID: actorAgentID,
		Error:        &payload,
	}); err != nil {
		log.Printf("reconcile: append error event for chat %s failed: %v", fresh.ID, err)
	}
	fresh.Stream.Status = "idle"
	fresh.Stream.LastError = payload.Message
	fresh.Stream.CancelRequested = false
	fresh.PendingHandoverAgentID = ""
	fresh.UpdatedAt = now
	if err := a.store.SaveChat(fresh); err != nil {
		log.Printf("reconcile: save chat %s failed: %v", fresh.ID, err)
	}
	return fresh
}

func (a *App) reconcileStaleStreams(records []model.ChatRecord) []model.ChatRecord {
	for i := range records {
		records[i] = a.reconcileStaleStream(records[i])
	}
	return records
}

// seedOptimizerProject ensures the hidden __optimizer__ project exists.
// Auto-scan chats live here so they don't pollute real project chat lists.
// Idempotent: also migrates older hidden projects that were seeded without a
// workdir before runtime skill injection required one, or whose workdir
// still points at the legacy projects/proj-__optimizer__/workdir location.
//
// Trust boundary: Partner runs against untrusted historical transcripts and
// can be prompt-injected into invoking its bash/file tools. The workdir
// becomes the cwd for that process, and the runtime's workspace-write
// sandbox confines writes to the cwd subtree. We deliberately place this
// workdir OUTSIDE state/projects/ so a sandbox escape would still not land
// next to user projects' MEMORY.md files.
func (a *App) seedOptimizerProject() error {
	workdir := a.optimizerProjectWorkdir()
	if err := os.MkdirAll(workdir, 0o755); err != nil {
		return err
	}
	legacyWorkdir := a.legacyOptimizerProjectWorkdir()
	if project, err := a.store.GetProject(optimizer.SystemProjectID); err == nil {
		changed := false
		current := strings.TrimSpace(project.Workdir)
		if current == "" || current == legacyWorkdir {
			project.Workdir = workdir
			changed = true
		}
		if !project.SystemHidden {
			project.SystemHidden = true
			changed = true
		}
		if !changed {
			return nil
		}
		project.UpdatedAt = time.Now().UTC()
		return a.store.SaveProject(project)
	} else if !errors.Is(err, store.ErrNotFound) {
		return err
	}
	now := time.Now().UTC()
	return a.store.SaveProject(model.ProjectRecord{
		ID:           optimizer.SystemProjectID,
		Name:         "Auto-optimizer",
		Workdir:      workdir,
		SystemHidden: true,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
}

func (a *App) optimizerProjectWorkdir() string {
	return filepath.Join(a.store.Root(), "optimizer", "scan-workdir")
}

func (a *App) legacyOptimizerProjectWorkdir() string {
	return filepath.Join(a.store.Root(), "projects", "proj-"+optimizer.SystemProjectID, "workdir")
}

func firstEngine(engine runtime.Engine) runtime.Engine {
	if engine != nil {
		return engine
	}
	return runtime.RealEngine{}
}

func firstScanner(scanner runtime.Scanner) runtime.Scanner {
	if scanner != nil {
		return scanner
	}
	return runtime.LocalScanner{}
}

func (a *App) bootstrapDefaultState() error {
	runtimes, err := a.store.ListRuntimes()
	if err != nil {
		return err
	}
	if len(runtimes) == 0 {
		runtimes, err = a.RescanRuntimes()
		if err != nil {
			return err
		}
	}

	agents, err := a.store.ListAgents()
	if err != nil {
		return err
	}
	if len(agents) > 0 {
		return nil
	}

	runtimeRecord, ok := pickDefaultRuntime(runtimes)
	if !ok {
		return nil
	}

	return presets.SeedDefaultCrew(a.store, runtimeRecord)
}

func pickDefaultRuntime(records []model.RuntimeRecord) (model.RuntimeRecord, bool) {
	available := make([]model.RuntimeRecord, 0, len(records))
	for _, record := range records {
		if record.Status == model.RuntimeStatusAvailable {
			available = append(available, record)
		}
	}
	if len(available) == 0 {
		return model.RuntimeRecord{}, false
	}

	preferred := []string{"codex", "claude"}
	for _, provider := range preferred {
		for _, record := range available {
			if record.Provider == provider || record.ID == provider {
				return record, true
			}
		}
	}

	sort.Slice(available, func(i, j int) bool { return available[i].ID < available[j].ID })
	return available[0], true
}

func defaultRuntimeModel(record model.RuntimeRecord) string {
	if value, ok := record.Metadata["model"].(string); ok {
		return value
	}
	return ""
}

func (a *App) StateDir() string {
	return a.store.Root()
}

func (a *App) Subscribe(chatID string) (<-chan broker.Notification[model.Event], func()) {
	return a.broker.Subscribe(chatID)
}

func (a *App) ListRuntimes() ([]model.RuntimeRecord, error) {
	return a.store.ListRuntimes()
}

func (a *App) GetRuntime(id string) (model.RuntimeRecord, error) {
	record, err := a.store.GetRuntime(id)
	return record, a.mapError(err)
}

func (a *App) RescanRuntimes() ([]model.RuntimeRecord, error) {
	current, err := a.store.ListRuntimes()
	if err != nil {
		return nil, err
	}
	agents, err := a.store.ListAgents()
	if err != nil {
		return nil, err
	}

	referenced := make(map[string]struct{}, len(agents))
	for _, agent := range agents {
		if agent.RuntimeID != "" {
			referenced[agent.RuntimeID] = struct{}{}
		}
	}

	currentByID := make(map[string]model.RuntimeRecord, len(current))
	for _, record := range current {
		currentByID[record.ID] = record
	}

	scanned, err := a.scanner.Scan(context.Background())
	if err != nil {
		return nil, err
	}

	var next []model.RuntimeRecord
	now := time.Now().UTC()
	for _, record := range scanned {
		record.Status = model.RuntimeStatusAvailable
		record.DetectedAt = now
		next = append(next, record)
		delete(currentByID, record.ID)
	}

	for _, record := range currentByID {
		if _, ok := referenced[record.ID]; ok {
			record.Status = model.RuntimeStatusMissing
			record.DetectedAt = now
			next = append(next, record)
		}
	}

	sort.Slice(next, func(i, j int) bool { return next[i].ID < next[j].ID })
	if err := a.store.SaveRuntimes(next); err != nil {
		return nil, err
	}
	return next, nil
}

func (a *App) UpdateRuntime(id string, patch map[string]any) (model.RuntimeRecord, error) {
	runtimes, err := a.store.ListRuntimes()
	if err != nil {
		return model.RuntimeRecord{}, err
	}
	found := false
	for i, record := range runtimes {
		if record.ID != id {
			continue
		}
		found = true
		if value, ok := patch["name"].(string); ok && value != "" {
			record.Name = value
		}
		if value, ok := patch["binary_path"].(string); ok && value != "" {
			record.BinaryPath = value
		}
		if value, ok := patch["version"].(string); ok {
			record.Version = value
		}
		if value, ok := patch["metadata"].(map[string]any); ok {
			record.Metadata = value
		}
		runtimes[i] = record
	}
	if !found {
		return model.RuntimeRecord{}, ErrNotFound
	}
	if err := a.store.SaveRuntimes(runtimes); err != nil {
		return model.RuntimeRecord{}, err
	}
	return a.GetRuntime(id)
}

// ListRuntimeModels returns the static catalog of models supported
// by the given runtime's provider, used to populate the model
// dropdown in the agent-creation form.
func (a *App) ListRuntimeModels(ctx context.Context, runtimeID string) ([]backendagent.Model, error) {
	record, err := a.store.GetRuntime(runtimeID)
	if err != nil {
		return nil, a.mapError(err)
	}
	return backendagent.ListModels(ctx, record.Provider, record.BinaryPath)
}

func (a *App) ListAgents() ([]model.AgentConfig, error) {
	agents, err := a.store.ListAgents()
	if err != nil {
		return nil, err
	}
	active := make([]model.AgentConfig, 0, len(agents))
	for _, agent := range agents {
		if agent.ArchivedAt.IsZero() {
			active = append(active, agent)
		}
	}
	return active, nil
}

func (a *App) GetAgent(id string) (model.AgentConfig, error) {
	record, err := a.store.GetAgent(id)
	return record, a.mapError(err)
}

func (a *App) CreateAgent(name, description, instruction, runtimeID, modelName string) (model.AgentConfig, error) {
	runtimeRecord, err := a.requireAvailableRuntime(runtimeID)
	if err != nil {
		return model.AgentConfig{}, err
	}
	if modelName == "" {
		modelName = defaultRuntimeModel(runtimeRecord)
	}
	description = strings.TrimSpace(description)
	if description == "" {
		description = model.DeriveAgentDescription(instruction)
	}
	now := time.Now().UTC()
	agent := model.AgentConfig{
		ID:          id.New(),
		Name:        name,
		Description: description,
		Instruction: instruction,
		RuntimeID:   runtimeID,
		Model:       modelName,
		SkillIDs:    []string{},
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := a.store.SaveAgent(agent); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

// AgentPatch wraps an AgentConfig payload with explicit presence flags for
// fields whose absent-vs-empty distinction matters. Today only Description
// needs this: omitting the key leaves the existing value alone; sending an
// empty string asks the server to regenerate from the instruction.
type AgentPatch struct {
	model.AgentConfig
	DescriptionSet bool
}

func (a *App) UpdateAgent(patch AgentPatch) (model.AgentConfig, error) {
	agent := patch.AgentConfig
	current, err := a.store.GetAgent(agent.ID)
	if err != nil {
		return model.AgentConfig{}, a.mapError(err)
	}
	if agent.Name != "" {
		current.Name = agent.Name
	}
	if agent.Instruction != "" {
		current.Instruction = agent.Instruction
	}
	if patch.DescriptionSet {
		next := strings.TrimSpace(agent.Description)
		if next == "" {
			next = model.DeriveAgentDescription(current.Instruction)
		}
		current.Description = next
	} else if current.Description == "" {
		// Lazy backfill for legacy agents stored before this field existed.
		current.Description = model.DeriveAgentDescription(current.Instruction)
	}
	runtimeChanged := false
	if agent.RuntimeID != "" {
		if _, err := a.requireAvailableRuntime(agent.RuntimeID); err != nil {
			return model.AgentConfig{}, err
		}
		runtimeChanged = agent.RuntimeID != current.RuntimeID
		current.RuntimeID = agent.RuntimeID
	}
	// When the runtime changes, drop any model from the payload — IDs are
	// provider-specific (gpt-5.5 vs claude-opus-4-7), so the stale value
	// carried in the partial-update payload would be passed to the new
	// backend and either error or silently misroute. The runtime engine
	// then falls back to the new runtime's catalog default at execution.
	// Callers that want to pin a model on the new runtime must issue a
	// second update.
	if runtimeChanged {
		current.Model = ""
	} else if agent.Model != "" {
		current.Model = agent.Model
	}
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveAgent(current); err != nil {
		return model.AgentConfig{}, err
	}
	return current, nil
}

func (a *App) SetAgentArchived(id string, archived bool) (model.AgentConfig, error) {
	agent, err := a.store.GetAgent(id)
	if err != nil {
		return model.AgentConfig{}, a.mapError(err)
	}
	if archived && isProtectedPresetAgent(agent) {
		return model.AgentConfig{}, ErrBadRequest
	}
	if archived {
		agent.ArchivedAt = time.Now().UTC()
	} else {
		agent.ArchivedAt = time.Time{}
	}
	agent.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveAgent(agent); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

func isProtectedPresetAgent(agent model.AgentConfig) bool {
	return agent.PresetID == presets.DefaultCrewPresetID && agent.PresetKey == "partner"
}

func (a *App) ReplaceAgentSkills(id string, skillIDs []string) (model.AgentConfig, error) {
	agent, err := a.store.GetAgent(id)
	if err != nil {
		return model.AgentConfig{}, a.mapError(err)
	}
	if _, err := a.resolveAgentSkills(skillIDs); err != nil {
		return model.AgentConfig{}, err
	}
	agent.SkillIDs = append([]string(nil), skillIDs...)
	agent.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveAgent(agent); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

func (a *App) ListSkills() ([]model.SkillRecord, error) {
	skills, err := a.store.ListSkills()
	if err != nil {
		return nil, err
	}
	for i := range skills {
		if skills[i].PresetKey != "" {
			skills[i].Name = presets.SkillDisplayName(skills[i].PresetKey)
		}
	}
	return skills, nil
}

func (a *App) GetSkill(id string) (model.SkillRecord, error) {
	skills, err := a.store.ListSkills()
	if err != nil {
		return model.SkillRecord{}, err
	}
	for _, skill := range skills {
		if skill.ID == id {
			return skill, nil
		}
	}
	return model.SkillRecord{}, ErrNotFound
}

func (a *App) CreateSkill(name string) (model.SkillRecord, error) {
	now := time.Now().UTC()
	record := model.SkillRecord{
		ID:        id.New(),
		Name:      name,
		Path:      a.store.SkillDir(id.New()),
		UpdatedAt: now,
	}
	record.Path = a.store.SkillDir(record.ID)
	skills, err := a.store.ListSkills()
	if err != nil {
		return model.SkillRecord{}, err
	}
	skills = append(skills, record)
	if err := a.store.SaveSkills(skills); err != nil {
		return model.SkillRecord{}, err
	}
	if err := a.store.EnsureSkillFile(record.ID, record.Name); err != nil {
		return model.SkillRecord{}, err
	}
	return record, nil
}

func (a *App) UpdateSkill(id, name string) (model.SkillRecord, error) {
	skills, err := a.store.ListSkills()
	if err != nil {
		return model.SkillRecord{}, err
	}
	for i, skill := range skills {
		if skill.ID == id {
			if name != "" {
				skill.Name = name
			}
			skill.UpdatedAt = time.Now().UTC()
			skills[i] = skill
			if err := a.store.SaveSkills(skills); err != nil {
				return model.SkillRecord{}, err
			}
			return skill, nil
		}
	}
	return model.SkillRecord{}, ErrNotFound
}

func (a *App) DeleteSkill(id string) error {
	return a.mapError(a.store.DeleteSkill(id))
}

func (a *App) ListSkillFiles(id string) ([]model.SkillFile, error) {
	files, err := a.store.ListSkillFiles(id)
	return files, a.mapError(err)
}

func (a *App) PutSkillFile(id, fileID, content string) error {
	return a.mapError(a.store.PutSkillFile(id, fileID, content))
}

func (a *App) DeleteSkillFile(id, fileID string) error {
	return a.mapError(a.store.DeleteSkillFile(id, fileID))
}

// ListPresets returns the catalog of factory presets and whether each one
// currently has a user copy.
func (a *App) ListPresets() ([]presets.PresetView, error) {
	return presets.ListPresetViews(a.store)
}

// SeedDefaultCrew is the manual-add path. Creates any missing default-crew
// agents/skills, returns a per-key summary. Idempotent.
func (a *App) SeedDefaultCrew() (presets.SeedResult, error) {
	a.presetMu.Lock()
	defer a.presetMu.Unlock()
	runtimeRecord, err := a.pickAvailableRuntime()
	if err != nil {
		return presets.SeedResult{}, err
	}
	return presets.MergeDefaultCrew(a.store, runtimeRecord)
}

// ResetDefaultCrew resets every default-crew agent's instruction, name,
// skill_ids, and preset skills (SKILL.md only) back to factory.
func (a *App) ResetDefaultCrew() (presets.ResetResult, error) {
	a.presetMu.Lock()
	defer a.presetMu.Unlock()
	runtimeRecord, err := a.pickAvailableRuntime()
	if err != nil {
		return presets.ResetResult{}, err
	}
	return presets.ResetDefaultCrew(a.store, runtimeRecord)
}

// ResetAgentPreset resets one preset-backed agent. Returns ErrBadRequest if
// the target agent has no preset metadata.
func (a *App) ResetAgentPreset(agentID string) (presets.ResetResult, error) {
	a.presetMu.Lock()
	defer a.presetMu.Unlock()
	runtimeRecord, err := a.pickAvailableRuntime()
	if err != nil {
		return presets.ResetResult{}, err
	}
	result, err := presets.ResetAgentPreset(a.store, agentID, runtimeRecord)
	if err == presets.ErrNotPreset {
		return presets.ResetResult{}, ErrBadRequest
	}
	return result, a.mapError(err)
}

func (a *App) pickAvailableRuntime() (model.RuntimeRecord, error) {
	runtimes, err := a.store.ListRuntimes()
	if err != nil {
		return model.RuntimeRecord{}, err
	}
	if record, ok := pickDefaultRuntime(runtimes); ok {
		return record, nil
	}
	return model.RuntimeRecord{}, ErrConflict
}

func (a *App) resolveAgentSkills(skillIDs []string) ([]runtime.SkillContext, error) {
	if len(skillIDs) == 0 {
		return nil, nil
	}
	records, err := a.store.ListSkills()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]model.SkillRecord, len(records))
	for _, record := range records {
		byID[record.ID] = record
	}

	out := make([]runtime.SkillContext, 0, len(skillIDs))
	for _, skillID := range skillIDs {
		record, ok := byID[skillID]
		if !ok {
			return nil, ErrBadRequest
		}
		files, err := a.store.ListSkillFiles(skillID)
		if err != nil {
			return nil, a.mapError(err)
		}
		ctx := runtime.SkillContext{
			ID:   record.ID,
			Name: record.Name,
		}
		for _, file := range files {
			if file.ID == "SKILL.md" {
				ctx.Content = file.Content
				continue
			}
			ctx.Files = append(ctx.Files, runtime.SkillFileContext{
				Path:    file.ID,
				Content: file.Content,
			})
		}
		if strings.TrimSpace(ctx.Content) == "" {
			ctx.Content = "# " + record.Name + "\n"
		}
		out = append(out, ctx)
	}
	return out, nil
}

// resolveRunSkills returns the full set of SkillContexts a chat run
// should inject into the runtime: global skills referenced by
// AgentConfig.SkillIDs plus the agent-private recruited skills under
// the installed agent's recruited-skills.json. The merged slice
// preserves SkillIDs order followed by recruited entries in manifest
// order so the runtime's "first match wins" behavior stays predictable.
//
// A recruited skill whose SourcePath is missing on disk is a hard error:
// the install rotation guarantees source/ is intact, so a missing file
// after a successful install means the user (or some other process)
// damaged the installed payload.
func (a *App) resolveRunSkills(agent model.AgentConfig) ([]runtime.SkillContext, error) {
	out, err := a.resolveAgentSkills(agent.SkillIDs)
	if err != nil {
		return nil, err
	}
	recruited, err := a.store.LoadRecruitedSkills(agent.ID)
	if err != nil {
		return nil, err
	}
	for _, entry := range recruited {
		body, err := os.ReadFile(entry.SourcePath)
		if err != nil {
			return nil, fmt.Errorf("installed agent source is incomplete: %s: %w", entry.SourcePath, err)
		}
		out = append(out, runtime.SkillContext{
			ID:      "recruited:" + entry.Path,
			Name:    entry.Name,
			Content: string(body),
		})
	}
	return out, nil
}

func (a *App) ListProjects() ([]model.ProjectRecord, error) {
	all, err := a.store.ListProjects()
	if err != nil {
		return nil, err
	}
	visible := make([]model.ProjectRecord, 0, len(all))
	for _, p := range all {
		if p.SystemHidden {
			continue
		}
		visible = append(visible, p)
	}
	return visible, nil
}

// ListAllProjects returns every project including hidden system projects.
// Optimizer internals use this; user-facing endpoints stay on ListProjects.
func (a *App) ListAllProjects() ([]model.ProjectRecord, error) {
	return a.store.ListProjects()
}

func (a *App) GetProject(id string) (model.ProjectRecord, error) {
	project, err := a.store.GetProject(id)
	return project, a.mapError(err)
}

func (a *App) CreateProject(name, workdir, mainAgentID string) (model.ProjectRecord, error) {
	if strings.TrimSpace(workdir) == "" {
		return model.ProjectRecord{}, ErrBadRequest
	}
	if strings.TrimSpace(mainAgentID) == "" {
		return model.ProjectRecord{}, ErrBadRequest
	}
	if _, err := a.requireRunnableAgent(mainAgentID); err != nil {
		return model.ProjectRecord{}, err
	}
	now := time.Now().UTC()
	project := model.ProjectRecord{
		ID:          id.New(),
		Name:        name,
		Workdir:     workdir,
		MainAgentID: mainAgentID,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := a.store.SaveProject(project); err != nil {
		return model.ProjectRecord{}, err
	}
	return project, nil
}

// UpdateProject applies a partial update. useWorktreeDefault is a tri-state
// pointer so the toggle can be set to false (a bare bool would be
// indistinguishable from "omitted").
func (a *App) UpdateProject(project model.ProjectRecord, useWorktreeDefault *bool) (model.ProjectRecord, error) {
	current, err := a.store.GetProject(project.ID)
	if err != nil {
		return model.ProjectRecord{}, a.mapError(err)
	}
	if project.Name != "" {
		current.Name = project.Name
	}
	if project.Workdir != "" {
		current.Workdir = project.Workdir
	}
	if project.MainAgentID != "" {
		if _, err := a.requireRunnableAgent(project.MainAgentID); err != nil {
			return model.ProjectRecord{}, err
		}
		current.MainAgentID = project.MainAgentID
	}
	if useWorktreeDefault != nil {
		current.UseWorktreeDefault = *useWorktreeDefault
	}
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveProject(current); err != nil {
		return model.ProjectRecord{}, err
	}
	return current, nil
}

func (a *App) DeleteProject(id string) error {
	if project, err := a.store.GetProject(id); err == nil {
		a.removeProjectWorktrees(project)
	}
	return a.mapError(a.store.DeleteProject(id))
}

// removeProjectWorktrees detaches every chat worktree from the source repo so
// no stale admin refs linger after the project's state dir is deleted.
// Best-effort: failures don't block project deletion.
func (a *App) removeProjectWorktrees(project model.ProjectRecord) {
	root := strings.TrimSpace(project.Workdir)
	if root == "" || !isGitRepo(root) {
		return
	}
	top, err := gitToplevel(root)
	if err != nil {
		return
	}
	// ListProjectChats (not ListChats) so archived chats are included —
	// otherwise their worktrees keep stale admin refs in the source repo
	// after the project state dir is gone.
	chats, err := a.store.ListProjectChats(project.ID)
	if err != nil {
		return
	}
	for _, chat := range chats {
		if chat.Worktree != nil {
			_ = gitWorktreeRemove(top, chat.Worktree.Path)
		}
	}
}

// GitInfo reports a project workdir's git state for the New Task composer:
// whether it's a repo, its current branch, HEAD sha, and the local branches
// available as worktree bases.
type GitInfo struct {
	IsGitRepo     bool     `json:"is_git_repo"`
	CurrentBranch string   `json:"current_branch,omitempty"`
	HeadSHA       string   `json:"head_sha,omitempty"`
	Branches      []string `json:"branches,omitempty"`
}

func (a *App) GitInfo(projectID string) (GitInfo, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return GitInfo{}, a.mapError(err)
	}
	root := strings.TrimSpace(project.Workdir)
	if root == "" || !isGitRepo(root) {
		return GitInfo{IsGitRepo: false}, nil
	}
	info := GitInfo{IsGitRepo: true, CurrentBranch: gitCurrentBranch(root), Branches: gitLocalBranches(root)}
	if sha, err := gitRevParse(root, "HEAD"); err == nil {
		info.HeadSHA = sha
	}
	return info, nil
}

// ProjectFile is a relative entry inside a project's workdir.
type ProjectFile struct {
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
}

// projectFileSkipDirs are folder names ListProjectFiles will never descend
// into. They are typically large, generated, or vendored; the composer wants
// to surface source files, not megabytes of build output.
var projectFileSkipDirs = map[string]bool{
	".git":          true,
	"node_modules":  true,
	"dist":          true,
	"build":         true,
	".next":         true,
	".cache":        true,
	".turbo":        true,
	"target":        true,
	"vendor":        true,
	"__pycache__":   true,
	".venv":         true,
	"venv":          true,
	".idea":         true,
	".vscode":       true,
	".DS_Store":     true,
	".pytest_cache": true,
}

// ListProjectFiles walks the project's workdir and returns up to limit entries
// whose relative path contains query (case-insensitive). Symlinks are not
// followed. Hidden top-level entries (other than common dotfile configs) are
// skipped to keep the suggestion list focused on user-relevant content.
func (a *App) ListProjectFiles(projectID, chatID, query string, limit int) ([]ProjectFile, error) {
	root, err := a.resolveWorkdir(projectID, chatID)
	if err != nil {
		return nil, err
	}
	if root == "" {
		return nil, ErrBadRequest
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 10000 {
		limit = 10000
	}
	q := strings.ToLower(strings.TrimSpace(query))

	results := make([]ProjectFile, 0, limit)
	walk := func() error {
		return filepath.WalkDir(root, func(absPath string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if absPath == root {
				return nil
			}
			name := d.Name()
			if d.IsDir() && projectFileSkipDirs[name] {
				return filepath.SkipDir
			}
			rel, err := filepath.Rel(root, absPath)
			if err != nil || rel == "" || rel == "." {
				return nil
			}
			rel = filepath.ToSlash(rel)
			if q == "" || strings.Contains(strings.ToLower(rel), q) {
				results = append(results, ProjectFile{Path: rel, IsDir: d.IsDir()})
				if len(results) >= limit {
					return filepath.SkipAll
				}
			}
			return nil
		})
	}
	if err := walk(); err != nil && !errors.Is(err, filepath.SkipAll) {
		return nil, err
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].IsDir != results[j].IsDir {
			return results[i].IsDir
		}
		return results[i].Path < results[j].Path
	})
	return results, nil
}

func (a *App) ListProjectChats(projectID string) ([]model.ChatRecord, error) {
	records, err := a.store.ListChats(projectID)
	if err != nil {
		return records, a.mapError(err)
	}
	return a.reconcileStaleStreams(records), nil
}

// chatWorkdir is the cwd for a chat: its worktree when bound, else the
// project workdir. Single source of truth for every project-scoped operation.
func chatWorkdir(chat model.ChatRecord, project model.ProjectRecord) string {
	if chat.Worktree != nil && strings.TrimSpace(chat.Worktree.Workdir) != "" {
		return chat.Worktree.Workdir
	}
	return project.Workdir
}

// resolveWorkdir returns the workdir for a project operation, honoring a chat's
// worktree binding when chatID is set. The chat must belong to the project.
func (a *App) resolveWorkdir(projectID, chatID string) (string, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return "", a.mapError(err)
	}
	if strings.TrimSpace(chatID) == "" {
		return strings.TrimSpace(project.Workdir), nil
	}
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return "", a.mapError(err)
	}
	if chat.ProjectID != projectID {
		return "", ErrBadRequest
	}
	return strings.TrimSpace(chatWorkdir(chat, project)), nil
}

// CreateChat creates a chat under a project. useWorktree is tri-state: nil
// falls back to the project default, otherwise it's an explicit request. When
// a worktree is wanted but the workdir isn't a git repo, an explicit request
// is rejected while a default-derived one silently falls back to no worktree.
//
// chatIDOverride lets a caller pre-allocate the chat's ID — the new-task UI
// supplies one so it can preview the exact worktree branch (crew/<id8>) before
// the chat exists. Ignored unless it is a single, syntactically safe value;
// otherwise a fresh ID is minted.
func (a *App) CreateChat(projectID, title, mainAgentID string, useWorktree *bool, baseRef string, chatIDOverride ...string) (model.ChatRecord, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	if strings.TrimSpace(mainAgentID) == "" {
		return model.ChatRecord{}, ErrBadRequest
	}
	if _, err := a.requireRunnableAgent(mainAgentID); err != nil {
		return model.ChatRecord{}, err
	}

	want := project.UseWorktreeDefault
	explicit := useWorktree != nil
	if explicit {
		want = *useWorktree
	}
	chatID := id.New()
	if len(chatIDOverride) > 0 && safeChatID(chatIDOverride[0]) {
		// store.SaveChat upserts by ID (and would even move the chat across
		// projects), so honoring an ID that already belongs to a chat would
		// silently overwrite that record and orphan any worktree it held.
		// Only take the client-supplied ID when it's actually free; on a
		// collision keep the freshly minted one rather than clobber.
		if _, err := a.store.GetChat(chatIDOverride[0]); err != nil {
			chatID = chatIDOverride[0]
		}
	}
	var binding *model.WorktreeBinding
	if want {
		if !isGitRepo(strings.TrimSpace(project.Workdir)) {
			if explicit {
				return model.ChatRecord{}, fmt.Errorf("not a git repository: %w", ErrBadRequest)
			}
			// Project default points at a workdir that is no longer a git
			// repo; quietly create the chat without a worktree.
		} else if binding, err = a.provisionWorktree(project, chatID, baseRef); err != nil {
			return model.ChatRecord{}, err
		}
	}

	now := time.Now().UTC()
	record := model.ChatRecord{
		ID:                  chatID,
		ProjectID:           project.ID,
		Title:               model.NormalizeChatTitle(title),
		MainAgentID:         mainAgentID,
		CurrentAgentID:      mainAgentID,
		ParticipantAgentIDs: []string{mainAgentID},
		Status:              "active",
		Worktree:            binding,
		Stream: model.ChatStreamState{
			Status: "idle",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := a.store.SaveChat(record); err != nil {
		// Don't leak a worktree for a chat that was never persisted.
		if binding != nil {
			if top, e := gitToplevel(project.Workdir); e == nil {
				_ = gitWorktreeRemove(top, binding.Path)
			}
		}
		return model.ChatRecord{}, err
	}
	return record, nil
}

func shortID(s string) string {
	if len(s) > 8 {
		return s[:8]
	}
	return s
}

// safeChatID reports whether s is acceptable as a client-supplied chat ID. The
// ID becomes a filesystem path component (chat-<id>) and a git branch suffix,
// so we restrict it to the shape of a minted UUID: hex digits and hyphens, no
// separators or traversal sequences.
func safeChatID(s string) bool {
	if len(s) < 8 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'f', r == '-':
		default:
			return false
		}
	}
	return true
}

// provisionWorktree creates an isolated git worktree for a chat, forked from
// baseRef (defaulting to the project repo's current branch). The branch is the
// placeholder crew/<chatID8>, renamed later once the chat earns a title.
func (a *App) provisionWorktree(project model.ProjectRecord, chatID, baseRef string) (*model.WorktreeBinding, error) {
	root := strings.TrimSpace(project.Workdir)
	if strings.TrimSpace(baseRef) == "" {
		baseRef = gitCurrentBranch(root)
	}
	baseSHA, err := gitRevParse(root, baseRef)
	if err != nil {
		return nil, fmt.Errorf("base ref %q not found: %w", baseRef, ErrBadRequest)
	}
	toplevel, err := gitToplevel(root)
	if err != nil {
		return nil, err
	}
	path := a.store.ChatWorktreePath(project.ID, chatID)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	branch := "crew/" + shortID(chatID)
	if err := gitWorktreeAdd(toplevel, path, branch, baseRef); err != nil {
		return nil, err
	}
	workdir := path
	if prefix := gitPathPrefix(root); prefix != "" {
		workdir = filepath.Join(path, filepath.FromSlash(prefix))
	}
	return &model.WorktreeBinding{
		Path:      path,
		Workdir:   workdir,
		Branch:    branch,
		BaseRef:   baseRef,
		BaseSHA:   baseSHA,
		CreatedAt: time.Now().UTC(),
	}, nil
}

func (a *App) ListChats(projectID string) ([]model.ChatRecord, error) {
	if projectID == "" {
		projects, err := a.ListProjects()
		if err != nil {
			return nil, err
		}
		chats := make([]model.ChatRecord, 0)
		for _, project := range projects {
			projectChats, err := a.store.ListChats(project.ID)
			if err != nil {
				return nil, a.mapError(err)
			}
			chats = append(chats, projectChats...)
		}
		sort.Slice(chats, func(i, j int) bool { return chats[i].CreatedAt.Before(chats[j].CreatedAt) })
		return a.reconcileStaleStreams(chats), nil
	}
	chats, err := a.store.ListChats(projectID)
	if err != nil {
		return nil, a.mapError(err)
	}
	return a.reconcileStaleStreams(chats), nil
}

func (a *App) GetChat(id string) (model.ChatRecord, error) {
	chat, err := a.store.GetChat(id)
	if err != nil {
		return chat, a.mapError(err)
	}
	return a.reconcileStaleStream(chat), nil
}

func (a *App) UpdateChat(chat model.ChatRecord) (model.ChatRecord, error) {
	current, err := a.store.GetChat(chat.ID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	if chat.Title != "" {
		current.Title = model.NormalizeChatTitle(chat.Title)
		// Any title that lands here came from a user-driven rename
		// (RPC chats.update). Lock it against the auto-summarizer.
		current.TitleSetByUser = true
		applyWorktreeRename(&current)
	}
	if chat.Status != "" {
		current.Status = chat.Status
	}
	current.ArchivedAt = chat.ArchivedAt
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveChat(current); err != nil {
		return model.ChatRecord{}, err
	}
	return current, nil
}

// applyAutoChatTitle writes a machine-derived title onto the chat, but only
// when the user has not explicitly renamed it. Returns the resulting chat
// (or the unchanged record when the auto-title was rejected). Errors from
// the store flow back to the caller; a locked title is not an error.
func (a *App) applyAutoChatTitle(chatID, title string) (model.ChatRecord, bool, error) {
	title = model.NormalizeChatTitle(title)
	if title == "" {
		return model.ChatRecord{}, false, nil
	}
	current, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, false, a.mapError(err)
	}
	if current.TitleSetByUser {
		return current, false, nil
	}
	if current.Title == title {
		return current, false, nil
	}
	current.Title = title
	applyWorktreeRename(&current)
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveChat(current); err != nil {
		return model.ChatRecord{}, false, err
	}
	// Notify any subscribers (TaskView's chat stream, the sidebar) that the
	// chat's metadata changed. The auto-summarizer can finish after the main
	// chat run's done event has already triggered a refetch, so without this
	// push the sidebar would keep showing the raw first-message title until
	// the next app reload. Value is zero — the subscriber refetches.
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindChatMeta})
	return current, true, nil
}

// applyWorktreeRename renames a chat's placeholder worktree branch
// (crew/<chatID8>) to a slug derived from its title, exactly once. No-op for
// chats without a worktree, already-renamed branches, or empty slugs. Mutates
// the binding in place so the caller persists it in the same save.
func applyWorktreeRename(chat *model.ChatRecord) {
	wt := chat.Worktree
	if wt == nil {
		return
	}
	short := shortID(chat.ID)
	if wt.Branch != "crew/"+short {
		return // already renamed
	}
	slug := branchSlug(chat.Title)
	if slug == "" {
		return
	}
	target := "crew/" + slug
	if gitBranchExists(wt.Path, target) {
		target += "-" + short
	}
	if err := gitRenameBranch(wt.Path, target); err != nil {
		return // keep the placeholder; not worth failing the title update
	}
	wt.Branch = target
}

// branchSlug derives a git-safe slug from a chat title: the first line,
// lowercased, alphanumerics only, up to four words joined by hyphens.
func branchSlug(title string) string {
	line := strings.SplitN(strings.TrimSpace(title), "\n", 2)[0]
	var b strings.Builder
	for _, r := range strings.ToLower(line) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte(' ')
		}
	}
	words := strings.Fields(b.String())
	if len(words) > 4 {
		words = words[:4]
	}
	return strings.Join(words, "-")
}

func (a *App) DeleteChat(id string) error {
	// Detach the chat's worktree before dropping its record, otherwise the
	// source repo keeps a stale linked checkout and branch with nothing left
	// in Crew44 to clean them up. Best-effort: don't block the delete on it.
	if chat, err := a.store.GetChat(id); err == nil && chat.Worktree != nil {
		if project, perr := a.store.GetProject(chat.ProjectID); perr == nil {
			if top, terr := gitToplevel(strings.TrimSpace(project.Workdir)); terr == nil {
				_ = gitWorktreeRemove(top, chat.Worktree.Path)
			}
		}
	}
	return a.mapError(a.store.DeleteChat(id))
}

func (a *App) ListEvents(chatID string, after int64) ([]model.Event, error) {
	events, err := a.store.ListEvents(chatID, after)
	if err != nil {
		return nil, a.mapError(err)
	}
	return a.enrichEventAgentNames(events), nil
}

func (a *App) GetEvent(chatID string, seq int64) (model.Event, error) {
	event, err := a.store.GetEvent(chatID, seq)
	if err != nil {
		return event, a.mapError(err)
	}
	return a.enrichEventAgentName(event), nil
}

func (a *App) GetToolCallDetails(chatID string, toolCallSeq int64) (model.Event, *model.Event, error) {
	events, err := a.store.ListEvents(chatID, 0)
	if err != nil {
		return model.Event{}, nil, a.mapError(err)
	}
	var call model.Event
	var result *model.Event
	for _, event := range events {
		if event.Seq == toolCallSeq {
			if event.Type != model.EventTypeToolCall {
				return model.Event{}, nil, a.mapError(store.ErrNotFound)
			}
			call = event
			continue
		}
		if event.Type == model.EventTypeToolCallResult && event.ToolCallResult != nil && event.ToolCallResult.ToolCallSeq == toolCallSeq {
			copy := event
			result = &copy
		}
	}
	if call.Seq == 0 {
		return model.Event{}, nil, a.mapError(store.ErrNotFound)
	}
	call = a.enrichEventAgentName(call)
	if result != nil {
		enriched := a.enrichEventAgentName(*result)
		result = &enriched
	}
	return call, result, nil
}

func (a *App) enrichEventAgentNames(events []model.Event) []model.Event {
	out := make([]model.Event, len(events))
	cache := map[string]string{}
	for i, event := range events {
		out[i] = a.enrichEventAgentNameWithCache(event, cache)
	}
	return out
}

func (a *App) enrichEventAgentName(event model.Event) model.Event {
	return a.enrichEventAgentNameWithCache(event, nil)
}

func (a *App) enrichEventAgentNameWithCache(event model.Event, cache map[string]string) model.Event {
	if event.ActorAgentName != "" || event.ActorAgentID == "" || event.ActorAgentID == "__human__" {
		return event
	}
	if cache != nil {
		if name, ok := cache[event.ActorAgentID]; ok {
			event.ActorAgentName = name
			return event
		}
	}
	agent, err := a.store.GetAgent(event.ActorAgentID)
	if err != nil || agent.Name == "" {
		return event
	}
	if cache != nil {
		cache[event.ActorAgentID] = agent.Name
	}
	event.ActorAgentName = agent.Name
	return event
}

func (a *App) CancelChat(chatID string) error {
	a.mu.Lock()
	controller := a.runs[chatID]
	a.mu.Unlock()
	if controller == nil || controller.cancel == nil {
		return nil
	}
	controller.cancel()
	return nil
}

func (a *App) mapError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrNotFound):
		return ErrNotFound
	case errors.Is(err, store.ErrConflict):
		return ErrConflict
	case errors.Is(err, store.ErrInvalidPath):
		return ErrBadRequest
	default:
		return err
	}
}

func (a *App) requireRunnableAgent(agentID string) (model.AgentConfig, error) {
	if strings.TrimSpace(agentID) == "" {
		return model.AgentConfig{}, ErrBadRequest
	}
	agent, err := a.store.GetAgent(agentID)
	if err != nil {
		return model.AgentConfig{}, a.mapError(err)
	}
	if _, err := a.requireAvailableRuntime(agent.RuntimeID); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

func (a *App) requireAvailableRuntime(runtimeID string) (model.RuntimeRecord, error) {
	if strings.TrimSpace(runtimeID) == "" {
		return model.RuntimeRecord{}, ErrBadRequest
	}
	record, err := a.store.GetRuntime(runtimeID)
	if err != nil {
		return model.RuntimeRecord{}, ErrBadRequest
	}
	if record.Status != model.RuntimeStatusAvailable {
		return model.RuntimeRecord{}, ErrBadRequest
	}
	return record, nil
}
