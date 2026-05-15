package store

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

type Store struct {
	root string
	mu   sync.Mutex
}

func New(root string) (*Store, error) {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	return &Store{root: root}, nil
}

func (s *Store) Root() string {
	return s.root
}

func (s *Store) SummaryPath(chatID string) string {
	return filepath.Join(s.root, "chats", "chat-"+chatID, "summary.md")
}

// UserMemoryPath is the legacy global per-user memory file (single bulleted
// markdown). Kept so existing files keep being read by the prompt builder
// when the new per-entry directory has not yet been created.
func (s *Store) UserMemoryPath() string {
	return filepath.Join(s.root, "USER.md")
}

// ProjectMemoryPath is the legacy per-project memory file (single bulleted
// markdown). Same backward-compat purpose as UserMemoryPath.
func (s *Store) ProjectMemoryPath(projectID string) string {
	return filepath.Join(s.root, "projects", "proj-"+projectID, "MEMORY.md")
}

// UserMemoryDir is the global per-user memory directory: one MEMORY.md index
// plus one markdown file per accepted memory entry.
func (s *Store) UserMemoryDir() string {
	return filepath.Join(s.root, "memory")
}

// ProjectMemoryDir is the per-project memory directory, same shape as
// UserMemoryDir but scoped to one project.
func (s *Store) ProjectMemoryDir(projectID string) string {
	return filepath.Join(s.root, "projects", "proj-"+projectID, "memory")
}

func (s *Store) RuntimeEnvDir(agentID string) string {
	return filepath.Join(s.root, "runtime-env", "agent-"+agentID)
}

func (s *Store) ListRuntimes() ([]model.RuntimeRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var records []model.RuntimeRecord
	err := readJSON(filepath.Join(s.root, "runtimes.json"), &records)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return records, err
}

func (s *Store) SaveRuntimes(records []model.RuntimeRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(filepath.Join(s.root, "runtimes.json"), records)
}

func (s *Store) GetRuntime(id string) (model.RuntimeRecord, error) {
	records, err := s.ListRuntimes()
	if err != nil {
		return model.RuntimeRecord{}, err
	}
	for _, record := range records {
		if record.ID == id {
			return record, nil
		}
	}
	return model.RuntimeRecord{}, ErrNotFound
}

func (s *Store) ListAgents() ([]model.AgentConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	base := filepath.Join(s.root, "agents")
	entries, err := os.ReadDir(base)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	agents := make([]model.AgentConfig, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		var agent model.AgentConfig
		if err := readJSON(filepath.Join(base, entry.Name(), "config.json"), &agent); err != nil {
			return nil, err
		}
		agents = append(agents, agent)
	}
	sort.Slice(agents, func(i, j int) bool { return agents[i].CreatedAt.Before(agents[j].CreatedAt) })
	return agents, nil
}

func (s *Store) GetAgent(id string) (model.AgentConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var agent model.AgentConfig
	err := readJSON(filepath.Join(s.root, "agents", "agent-"+id, "config.json"), &agent)
	if errors.Is(err, os.ErrNotExist) {
		return model.AgentConfig{}, ErrNotFound
	}
	return agent, err
}

func (s *Store) SaveAgent(agent model.AgentConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Join(s.root, "agents", "agent-"+agent.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, "config.json"), agent)
}

func (s *Store) DeleteAgent(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.RemoveAll(filepath.Join(s.root, "agents", "agent-"+id)); err != nil {
		return err
	}
	return nil
}

func (s *Store) PresetMappingPath(presetID string) string {
	return filepath.Join(s.root, "presets", presetID+".json")
}

func (s *Store) LoadPresetMapping(presetID string) (model.PresetMapping, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mapping model.PresetMapping
	err := readJSON(s.PresetMappingPath(presetID), &mapping)
	if errors.Is(err, os.ErrNotExist) {
		return model.PresetMapping{
			PresetID: presetID,
			AgentIDs: map[string]string{},
			SkillIDs: map[string]string{},
		}, nil
	}
	if err != nil {
		return model.PresetMapping{}, err
	}
	if mapping.AgentIDs == nil {
		mapping.AgentIDs = map[string]string{}
	}
	if mapping.SkillIDs == nil {
		mapping.SkillIDs = map[string]string{}
	}
	return mapping, nil
}

func (s *Store) SavePresetMapping(mapping model.PresetMapping) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Join(s.root, "presets"), 0o755); err != nil {
		return err
	}
	return writeJSON(s.PresetMappingPath(mapping.PresetID), mapping)
}

func (s *Store) ListSkills() ([]model.SkillRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var records []model.SkillRecord
	err := readJSON(filepath.Join(s.root, "skills", "registry.json"), &records)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return records, err
}

func (s *Store) SaveSkills(records []model.SkillRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Join(s.root, "skills")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeJSON(filepath.Join(dir, "registry.json"), records)
}

func (s *Store) SkillDir(id string) string {
	return filepath.Join(s.root, "skills", "skill-"+id)
}

func (s *Store) EnsureSkillFile(id, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := s.SkillDir(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "SKILL.md")
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		content := fmt.Sprintf("---\nname: %s\ndescription: Use this skill when it is relevant to the user's task.\n---\n\n# %s\n", name, name)
		return os.WriteFile(path, []byte(content), 0o644)
	}
	return nil
}

func (s *Store) ListSkillFiles(id string) ([]model.SkillFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := s.SkillDir(id)
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	var files []model.SkillFile
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		files = append(files, model.SkillFile{
			ID:        filepath.ToSlash(rel),
			Content:   string(content),
			UpdatedAt: info.ModTime(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ID < files[j].ID })
	return files, nil
}

func (s *Store) PutSkillFile(id, fileID, content string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := s.SkillDir(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path, err := safeSkillFilePath(dir, fileID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func (s *Store) DeleteSkillFile(id, fileID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := safeSkillFilePath(s.SkillDir(id), fileID)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return ErrNotFound
	}
	return err
}

func safeSkillFilePath(root, fileID string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimSpace(fileID)))
	if cleaned == "." || filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %q", ErrInvalidPath, fileID)
	}
	return filepath.Join(root, cleaned), nil
}

func (s *Store) DeleteSkill(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	skills, err := readSkillsRegistry(filepath.Join(s.root, "skills", "registry.json"))
	if err != nil {
		return err
	}
	filtered := make([]model.SkillRecord, 0, len(skills))
	for _, skill := range skills {
		if skill.ID != id {
			filtered = append(filtered, skill)
		}
	}
	if err := writeJSON(filepath.Join(s.root, "skills", "registry.json"), filtered); err != nil {
		return err
	}
	return os.RemoveAll(s.SkillDir(id))
}

func (s *Store) ListProjects() ([]model.ProjectRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var entries []model.ProjectIndexEntry
	err := readJSONL(filepath.Join(s.root, "projects", "registry.jsonl"), &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	projects := make([]model.ProjectRecord, 0, len(entries))
	for _, entry := range entries {
		var record model.ProjectRecord
		if err := readJSON(filepath.Join(s.root, "projects", "proj-"+entry.ID, "project.json"), &record); err != nil {
			return nil, err
		}
		projects = append(projects, record)
	}
	sort.Slice(projects, func(i, j int) bool { return projects[i].CreatedAt.Before(projects[j].CreatedAt) })
	return projects, nil
}

func (s *Store) GetProject(id string) (model.ProjectRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var record model.ProjectRecord
	err := readJSON(filepath.Join(s.root, "projects", "proj-"+id, "project.json"), &record)
	if errors.Is(err, os.ErrNotExist) {
		return model.ProjectRecord{}, ErrNotFound
	}
	return record, err
}

func (s *Store) SaveProject(project model.ProjectRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Join(s.root, "projects", "proj-"+project.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "project.json"), project); err != nil {
		return err
	}
	entries, err := readProjectRegistry(filepath.Join(s.root, "projects", "registry.jsonl"))
	if err != nil {
		return err
	}
	entries = upsertProjectIndex(entries, model.ProjectIndexEntry{
		ID:         project.ID,
		Name:       project.Name,
		Workdir:    project.Workdir,
		ArchivedAt: project.ArchivedAt,
	})
	if err := os.MkdirAll(filepath.Join(s.root, "projects"), 0o755); err != nil {
		return err
	}
	if err := writeJSONL(filepath.Join(s.root, "projects", "registry.jsonl"), entries); err != nil {
		return err
	}
	_, err = os.Stat(filepath.Join(dir, "chats.jsonl"))
	if errors.Is(err, os.ErrNotExist) {
		return os.WriteFile(filepath.Join(dir, "chats.jsonl"), nil, 0o644)
	}
	return err
}

func (s *Store) DeleteProject(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	chats, err := readChatIndex(filepath.Join(s.root, "projects", "proj-"+id, "chats.jsonl"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, chat := range chats {
		if err := os.RemoveAll(filepath.Join(s.root, "chats", "chat-"+chat.ChatID)); err != nil {
			return err
		}
	}
	projects, err := readProjectRegistry(filepath.Join(s.root, "projects", "registry.jsonl"))
	if err != nil {
		return err
	}
	filtered := make([]model.ProjectIndexEntry, 0, len(projects))
	for _, project := range projects {
		if project.ID != id {
			filtered = append(filtered, project)
		}
	}
	if err := writeJSONL(filepath.Join(s.root, "projects", "registry.jsonl"), filtered); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.root, "projects", "proj-"+id))
}

func (s *Store) ListProjectChats(projectID string) ([]model.ChatIndexEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var entries []model.ChatIndexEntry
	err := readJSONL(filepath.Join(s.root, "projects", "proj-"+projectID, "chats.jsonl"), &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	return entries, err
}

func (s *Store) GetChat(id string) (model.ChatRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var chat model.ChatRecord
	err := readJSON(filepath.Join(s.root, "chats", "chat-"+id, "chat.json"), &chat)
	if errors.Is(err, os.ErrNotExist) {
		return model.ChatRecord{}, ErrNotFound
	}
	return chat, err
}

func (s *Store) SaveChat(chat model.ChatRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	dir := filepath.Join(s.root, "chats", "chat-"+chat.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(dir, "chat.json"), chat); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(dir, "events.jsonl")); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(filepath.Join(dir, "events.jsonl"), nil, 0o644); err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "summary.md")); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(filepath.Join(dir, "summary.md"), nil, 0o644); err != nil {
			return err
		}
	}
	return s.saveProjectChatIndexLocked(chat)
}

func (s *Store) ListChats(projectID string) ([]model.ChatRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := readChatIndex(filepath.Join(s.root, "projects", "proj-"+projectID, "chats.jsonl"))
	if err != nil {
		return nil, err
	}
	chats := make([]model.ChatRecord, 0, len(entries))
	for _, entry := range entries {
		var chat model.ChatRecord
		if err := readJSON(filepath.Join(s.root, "chats", "chat-"+entry.ChatID, "chat.json"), &chat); err != nil {
			return nil, err
		}
		chats = append(chats, chat)
	}
	return chats, nil
}

func (s *Store) AppendEvent(chatID string, event model.Event) (model.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.root, "chats", "chat-"+chatID, "events.jsonl")
	events, err := readEvents(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return model.Event{}, err
	}
	event.Seq = int64(len(events) + 1)
	events = append(events, event)
	if err := writeJSONL(path, events); err != nil {
		return model.Event{}, err
	}
	return event, nil
}

func (s *Store) ListEvents(chatID string, after int64) ([]model.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	events, err := readEvents(filepath.Join(s.root, "chats", "chat-"+chatID, "events.jsonl"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if after <= 0 {
		return events, nil
	}
	filtered := make([]model.Event, 0, len(events))
	for _, event := range events {
		if event.Seq > after {
			filtered = append(filtered, event)
		}
	}
	return filtered, nil
}

func (s *Store) WriteSummary(chatID, summary string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return os.WriteFile(filepath.Join(s.root, "chats", "chat-"+chatID, "summary.md"), []byte(summary), 0o644)
}

func (s *Store) saveProjectChatIndexLocked(chat model.ChatRecord) error {
	dir := filepath.Join(s.root, "projects", "proj-"+chat.ProjectID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, "chats.jsonl")
	entries, err := readChatIndex(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	index := model.ChatIndexEntry{
		ChatID:         chat.ID,
		Title:          chat.Title,
		Status:         chat.Status,
		CurrentAgentID: chat.CurrentAgentID,
		UpdatedAt:      chat.UpdatedAt,
		ArchivedAt:     chat.ArchivedAt,
	}
	entries = upsertChatIndex(entries, index)
	return writeJSONL(path, entries)
}

func (s *Store) DeleteChat(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var chat model.ChatRecord
	if err := readJSON(filepath.Join(s.root, "chats", "chat-"+id, "chat.json"), &chat); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	entries, err := readChatIndex(filepath.Join(s.root, "projects", "proj-"+chat.ProjectID, "chats.jsonl"))
	if err != nil {
		return err
	}
	filtered := make([]model.ChatIndexEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.ChatID != id {
			filtered = append(filtered, entry)
		}
	}
	if err := writeJSONL(filepath.Join(s.root, "projects", "proj-"+chat.ProjectID, "chats.jsonl"), filtered); err != nil {
		return err
	}
	return os.RemoveAll(filepath.Join(s.root, "chats", "chat-"+id))
}

func readProjectRegistry(path string) ([]model.ProjectIndexEntry, error) {
	var entries []model.ProjectIndexEntry
	err := readJSONL(path, &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return entries, err
}

func readSkillsRegistry(path string) ([]model.SkillRecord, error) {
	var entries []model.SkillRecord
	err := readJSON(path, &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return entries, err
}

func readChatIndex(path string) ([]model.ChatIndexEntry, error) {
	var entries []model.ChatIndexEntry
	err := readJSONL(path, &entries)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return entries, err
}

func readEvents(path string) ([]model.Event, error) {
	var events []model.Event
	err := readJSONL(path, &events)
	if errors.Is(err, os.ErrNotExist) {
		return nil, os.ErrNotExist
	}
	return events, err
}

func upsertProjectIndex(entries []model.ProjectIndexEntry, next model.ProjectIndexEntry) []model.ProjectIndexEntry {
	for i, entry := range entries {
		if entry.ID == next.ID {
			entries[i] = next
			return entries
		}
	}
	return append(entries, next)
}

func upsertChatIndex(entries []model.ChatIndexEntry, next model.ChatIndexEntry) []model.ChatIndexEntry {
	for i, entry := range entries {
		if entry.ChatID == next.ChatID {
			entries[i] = next
			return entries
		}
	}
	return append(entries, next)
}

func writeJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

func readJSONL[T any](path string, out *[]T) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	items := make([]T, 0)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var item T
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		items = append(items, item)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	*out = items
	return nil
}

func writeJSONL[T any](path string, items []T) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, item := range items {
		if err := enc.Encode(item); err != nil {
			return err
		}
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}
