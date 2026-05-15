package app

import (
	"context"
	"errors"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/optimizer"
	"github.com/getcrew44/crew44/daemon/internal/presets"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
	"github.com/getcrew44/crew44/daemon/internal/store"
)

type Config struct {
	StateDir       string
	RuntimeScanDir string
	Scanner        runtime.Scanner
	Engine         runtime.Engine
}

type App struct {
	store          *store.Store
	runtimeScanDir string
	scanner        runtime.Scanner
	engine         runtime.Engine
	broker         *broker.Broker[model.Event]

	mu      sync.Mutex
	cancels map[string]context.CancelFunc

	// presetMu serializes seed/reset operations on the same preset so two
	// concurrent API calls cannot create duplicate records.
	presetMu sync.Mutex

	// Optimizer subsystem; wired in initOptimizer after bootstrap.
	optimizer          *optimizer.Manager
	optimizerScheduler *optimizer.Scheduler
}

func New(cfg Config) (*App, error) {
	st, err := store.New(cfg.StateDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.RuntimeScanDir, 0o755); err != nil {
		return nil, err
	}
	app := &App{
		store:          st,
		runtimeScanDir: cfg.RuntimeScanDir,
		scanner:        firstScanner(cfg.Scanner),
		engine:         firstEngine(cfg.Engine),
		broker:         broker.New[model.Event](),
		cancels:        make(map[string]context.CancelFunc),
	}
	if err := app.bootstrapDefaultState(); err != nil {
		return nil, err
	}
	if err := app.recoverInterruptedStreams(); err != nil {
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

// recoverInterruptedStreams flips any chats whose stream is persisted as
// "streaming" back to "idle" on startup. Such chats represent runs interrupted
// by the previous daemon's exit (crash, quit, SIGTERM); the goroutine that
// would have called finishChatSuccess never got the chance. Without this
// sweep the UI shows them as "still working" forever and the TaskView keeps
// isStreaming pinned to true while waiting for events that will never come.
// Appends a terminal error event so the conversation shows what happened.
func (a *App) recoverInterruptedStreams() error {
	projects, err := a.store.ListProjects()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, project := range projects {
		chats, err := a.store.ListChats(project.ID)
		if err != nil {
			// A single corrupted project must not block daemon startup.
			log.Printf("recovery: list chats for project %s failed: %v", project.ID, err)
			continue
		}
		for _, chat := range chats {
			if chat.Stream.Status != "streaming" {
				continue
			}
			actorAgentID := chat.Stream.AgentID
			if actorAgentID == "" {
				actorAgentID = chat.CurrentAgentID
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
			if _, err := a.store.AppendEvent(chat.ID, model.Event{
				Type:         model.EventTypeError,
				TS:           now,
				TurnID:       chat.ActiveTurnID,
				ActorAgentID: actorAgentID,
				Error:        &payload,
			}); err != nil {
				// Better to leave the chat unannotated than to skip the status
				// flip — the user still needs the spinner to stop.
				log.Printf("recovery: append error event for chat %s failed: %v", chat.ID, err)
			}
			chat.Stream.Status = "idle"
			chat.Stream.LastError = payload.Message
			chat.Stream.CancelRequested = false
			chat.PendingHandoverAgentID = ""
			chat.UpdatedAt = now
			if err := a.store.SaveChat(chat); err != nil {
				log.Printf("recovery: save chat %s failed: %v", chat.ID, err)
			}
		}
	}
	return nil
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

func (a *App) CreateAgent(name, instruction, runtimeID, modelName string) (model.AgentConfig, error) {
	runtimeRecord, err := a.requireAvailableRuntime(runtimeID)
	if err != nil {
		return model.AgentConfig{}, err
	}
	if modelName == "" {
		modelName = defaultRuntimeModel(runtimeRecord)
	}
	now := time.Now().UTC()
	agent := model.AgentConfig{
		ID:          id.New(),
		Name:        name,
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

func (a *App) UpdateAgent(agent model.AgentConfig) (model.AgentConfig, error) {
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
	if agent.RuntimeID != "" {
		if _, err := a.requireAvailableRuntime(agent.RuntimeID); err != nil {
			return model.AgentConfig{}, err
		}
		current.RuntimeID = agent.RuntimeID
	}
	if agent.Model != "" {
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

func (a *App) UpdateProject(project model.ProjectRecord) (model.ProjectRecord, error) {
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
	current.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveProject(current); err != nil {
		return model.ProjectRecord{}, err
	}
	return current, nil
}

func (a *App) DeleteProject(id string) error {
	return a.mapError(a.store.DeleteProject(id))
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
func (a *App) ListProjectFiles(projectID, query string, limit int) ([]ProjectFile, error) {
	project, err := a.store.GetProject(projectID)
	if err != nil {
		return nil, a.mapError(err)
	}
	root := strings.TrimSpace(project.Workdir)
	if root == "" {
		return nil, ErrBadRequest
	}
	if limit <= 0 || limit > 200 {
		limit = 50
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
	return records, a.mapError(err)
}

func (a *App) CreateChat(projectID, title, mainAgentID string) (model.ChatRecord, error) {
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

	now := time.Now().UTC()
	record := model.ChatRecord{
		ID:                  id.New(),
		ProjectID:           project.ID,
		Title:               title,
		MainAgentID:         mainAgentID,
		CurrentAgentID:      mainAgentID,
		ParticipantAgentIDs: []string{mainAgentID},
		Status:              "active",
		Stream: model.ChatStreamState{
			Status: "idle",
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := a.store.SaveChat(record); err != nil {
		return model.ChatRecord{}, err
	}
	return record, nil
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
		return chats, nil
	}
	return a.store.ListChats(projectID)
}

func (a *App) GetChat(id string) (model.ChatRecord, error) {
	chat, err := a.store.GetChat(id)
	return chat, a.mapError(err)
}

func (a *App) UpdateChat(chat model.ChatRecord) (model.ChatRecord, error) {
	current, err := a.store.GetChat(chat.ID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	if chat.Title != "" {
		current.Title = chat.Title
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

func (a *App) DeleteChat(id string) error {
	return a.mapError(a.store.DeleteChat(id))
}

func (a *App) ListEvents(chatID string, after int64) ([]model.Event, error) {
	events, err := a.store.ListEvents(chatID, after)
	return events, a.mapError(err)
}

func (a *App) CancelChat(chatID string) error {
	a.mu.Lock()
	cancel := a.cancels[chatID]
	a.mu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
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
