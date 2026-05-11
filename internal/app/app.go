package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/id"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
	"github.com/sqtech/crew-ai/crewai-repo/internal/store"
)

type Config struct {
	StateDir       string
	RuntimeScanDir string
}

type App struct {
	store          *store.Store
	runtimeScanDir string
	engine         runtime.Engine
	broker         *broker.Broker[model.Event]

	mu      sync.Mutex
	cancels map[string]context.CancelFunc
}

func New(cfg Config) (*App, error) {
	st, err := store.New(cfg.StateDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(cfg.RuntimeScanDir, 0o755); err != nil {
		return nil, err
	}
	return &App{
		store:          st,
		runtimeScanDir: cfg.RuntimeScanDir,
		engine:         runtime.MockEngine{},
		broker:         broker.New[model.Event](),
		cancels:        make(map[string]context.CancelFunc),
	}, nil
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

	matches, err := filepath.Glob(filepath.Join(a.runtimeScanDir, "*.crewai-runtime.json"))
	if err != nil {
		return nil, err
	}

	var next []model.RuntimeRecord
	now := time.Now().UTC()
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil {
			return nil, err
		}
		var record model.RuntimeRecord
		if err := json.Unmarshal(data, &record); err != nil {
			return nil, err
		}
		record.Status = model.RuntimeStatusAvailable
		record.DetectedAt = now
		if record.Metadata == nil {
			record.Metadata = map[string]any{}
		}
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
	return a.store.ListAgents()
}

func (a *App) GetAgent(id string) (model.AgentConfig, error) {
	record, err := a.store.GetAgent(id)
	return record, a.mapError(err)
}

func (a *App) CreateAgent(name, instruction, runtimeID, modelName string) (model.AgentConfig, error) {
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

func (a *App) ReplaceAgentSkills(id string, skillIDs []string) (model.AgentConfig, error) {
	agent, err := a.store.GetAgent(id)
	if err != nil {
		return model.AgentConfig{}, a.mapError(err)
	}
	agent.SkillIDs = append([]string(nil), skillIDs...)
	agent.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveAgent(agent); err != nil {
		return model.AgentConfig{}, err
	}
	return agent, nil
}

func (a *App) ListSkills() ([]model.SkillRecord, error) {
	return a.store.ListSkills()
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

func (a *App) ListProjects() ([]model.ProjectRecord, error) {
	return a.store.ListProjects()
}

func (a *App) GetProject(id string) (model.ProjectRecord, error) {
	project, err := a.store.GetProject(id)
	return project, a.mapError(err)
}

func (a *App) CreateProject(name, workdir, mainAgentID string) (model.ProjectRecord, error) {
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

func (a *App) ListProjectChats(projectID string) ([]model.ChatRecord, error) {
	records, err := a.store.ListChats(projectID)
	return records, a.mapError(err)
}

func (a *App) CreateChat(projectID, title, mainAgentID string) (model.ChatRecord, error) {
	now := time.Now().UTC()
	record := model.ChatRecord{
		ID:                  id.New(),
		ProjectID:           projectID,
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
	default:
		return err
	}
}
