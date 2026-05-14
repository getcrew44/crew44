package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/optimizer"
)

// initOptimizer is called from App.New after bootstrap. It wires the
// dispatcher, resolver, memory writer, and skill writer that the optimizer
// needs, and starts the scheduler goroutine.
func (a *App) initOptimizer() error {
	store, err := optimizer.NewStore(a.store.Root())
	if err != nil {
		return err
	}
	dispatcher := &appDispatcher{app: a}
	resolver := &partnerResolver{app: a}
	mem := &memoryWriter{store: a.store}
	skills := &skillWriter{app: a}
	scanner := optimizer.NewScanner(store, dispatcher, resolver)
	manager := optimizer.NewManager(store, scanner, mem, skills)
	scheduler := optimizer.NewScheduler(manager)
	manager.AttachScheduler(scheduler)
	scheduler.Start(context.Background())

	a.optimizer = manager
	a.optimizerScheduler = scheduler
	return nil
}

// Optimizer returns the manager so RPC method handlers can delegate.
// Returns nil if initOptimizer has not been called (only happens in
// minimal test fixtures).
func (a *App) Optimizer() *optimizer.Manager { return a.optimizer }

// ---------- ChatDispatcher impl ----------

type appDispatcher struct {
	app *App
}

func (d *appDispatcher) CreateChat(_ context.Context, projectID, title, agentID string) (string, error) {
	chat, err := d.app.CreateChat(projectID, title, agentID)
	if err != nil {
		return "", err
	}
	return chat.ID, nil
}

func (d *appDispatcher) PostMessage(_ context.Context, chatID, agentID, content string) error {
	_, err := d.app.PostMessage(chatID, content, agentID)
	return err
}

// WaitDone subscribes to the chat's event broker and returns when KindDone
// or KindError lands, when ctx expires, or when the chat is idle for
// idleTimeout. Any broker notification resets the idle timer.
func (d *appDispatcher) WaitDone(ctx context.Context, chatID string, idleTimeout time.Duration) error {
	ch, cancel := d.app.Subscribe(chatID)
	defer cancel()
	if done, err := d.doneStatus(chatID); done || err != nil {
		return err
	}
	var idle <-chan time.Time
	var timer *time.Timer
	if idleTimeout > 0 {
		timer = time.NewTimer(idleTimeout)
		defer timer.Stop()
		idle = timer.C
	}
	resetIdle := func() {
		if timer == nil {
			return
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(idleTimeout)
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-idle:
			return context.DeadlineExceeded
		case n, ok := <-ch:
			if !ok {
				return errors.New("optimizer: broker channel closed")
			}
			resetIdle()
			switch n.Kind {
			case broker.KindDone:
				return nil
			case broker.KindError:
				if done, err := d.doneStatus(chatID); done && err != nil {
					return err
				}
				if n.Error != "" {
					return errors.New(n.Error)
				}
				return errors.New("optimizer: chat ended with error")
			}
		}
	}
}

func (d *appDispatcher) doneStatus(chatID string) (bool, error) {
	chat, err := d.app.GetChat(chatID)
	if err != nil {
		return false, err
	}
	if chat.Stream.Status == "streaming" {
		return false, nil
	}
	if chat.Stream.LastError != "" {
		return true, errors.New(chat.Stream.LastError)
	}
	return true, nil
}

// AssistantText joins every assistant Message event into the response text.
// Optimizer parser ignores tool_call / thinking events; only message content
// can carry the fenced JSON block.
func (d *appDispatcher) AssistantText(_ context.Context, chatID string) (string, error) {
	events, err := d.app.ListEvents(chatID, 0)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, ev := range events {
		if ev.Type != model.EventTypeMessage || ev.Message == nil {
			continue
		}
		if ev.Message.Role != model.MessageRoleAssistant {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(ev.Message.Content)
	}
	return b.String(), nil
}

func (d *appDispatcher) BuildScanCorpus(_ context.Context, since, until time.Time, limit int) (optimizer.ScanCorpus, error) {
	if limit <= 0 {
		limit = 80
	}
	corpus := optimizer.ScanCorpus{
		WindowStart: since.UTC(),
		WindowEnd:   until.UTC(),
		Chats:       []optimizer.ChatDigest{},
	}
	projects, err := d.app.ListAllProjects()
	if err != nil {
		return corpus, err
	}
	type projectChat struct {
		project model.ProjectRecord
		chat    model.ChatRecord
	}
	candidates := make([]projectChat, 0)
	for _, project := range projects {
		if project.SystemHidden || project.ID == optimizer.SystemProjectID || !project.ArchivedAt.IsZero() {
			continue
		}
		entries, err := d.app.store.ListProjectChats(project.ID)
		if err != nil {
			return corpus, err
		}
		for _, entry := range entries {
			if !entry.ArchivedAt.IsZero() {
				continue
			}
			chat, err := d.app.store.GetChat(entry.ChatID)
			if err != nil {
				continue
			}
			if !chat.ArchivedAt.IsZero() {
				continue
			}
			if chat.UpdatedAt.Before(since) || chat.UpdatedAt.After(until) {
				continue
			}
			candidates = append(candidates, projectChat{project: project, chat: chat})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].chat.UpdatedAt.Before(candidates[j].chat.UpdatedAt)
	})
	if len(candidates) > limit {
		candidates = candidates[len(candidates)-limit:]
	}
	for _, item := range candidates {
		events, err := d.app.store.ListEvents(item.chat.ID, 0)
		if err != nil {
			continue
		}
		digest := optimizer.ChatDigest{
			ProjectID:   item.project.ID,
			ProjectName: item.project.Name,
			ChatID:      item.chat.ID,
			Title:       boundedText(item.chat.Title, 120),
			CreatedAt:   item.chat.CreatedAt.UTC(),
			UpdatedAt:   item.chat.UpdatedAt.UTC(),
			Snippets:    boundedMessageSnippets(events, since, until, 8),
		}
		corpus.Chats = append(corpus.Chats, digest)
	}
	corpus.RunsAnalyzed = len(corpus.Chats)
	return corpus, nil
}

func boundedMessageSnippets(events []model.Event, since, until time.Time, limit int) []optimizer.MessageSnippet {
	if limit <= 0 {
		return nil
	}
	snippets := make([]optimizer.MessageSnippet, 0, limit)
	for _, ev := range events {
		if ev.TS.Before(since) || ev.TS.After(until) {
			continue
		}
		switch {
		case ev.Message != nil:
			text := boundedText(ev.Message.Content, 240)
			if text == "" {
				continue
			}
			snippets = append(snippets, optimizer.MessageSnippet{
				TS:   ev.TS.UTC(),
				Role: string(ev.Message.Role),
				Text: text,
			})
		case ev.Error != nil:
			text := boundedText(ev.Error.Message, 240)
			if text == "" {
				continue
			}
			snippets = append(snippets, optimizer.MessageSnippet{
				TS:   ev.TS.UTC(),
				Role: "error",
				Text: text,
			})
		}
		if len(snippets) >= limit {
			break
		}
	}
	return snippets
}

func boundedText(text string, max int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if max <= 0 || len(runes) <= max {
		return text
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
}

func (d *appDispatcher) Cancel(_ context.Context, chatID string) error {
	return d.app.CancelChat(chatID)
}

// ---------- PartnerResolver impl ----------

const partnerPresetKey = "partner"

type partnerResolver struct {
	app *App
}

func (r *partnerResolver) ResolvePartnerAgent() (string, error) {
	agents, err := r.app.store.ListAgents()
	if err != nil {
		return "", err
	}
	for _, ag := range agents {
		if ag.PresetKey != partnerPresetKey {
			continue
		}
		if !ag.ArchivedAt.IsZero() {
			continue
		}
		if _, err := r.app.requireRunnableAgent(ag.ID); err != nil {
			continue
		}
		return ag.ID, nil
	}
	return "", optimizer.ErrPartnerUnavailable
}

// ---------- MemoryWriter impl ----------

type memoryWriter struct {
	store storeIface
}

// storeIface is the subset of *store.Store the memoryWriter needs. Lets us
// avoid a circular import.
type storeIface interface {
	UserMemoryPath() string
	ProjectMemoryPath(projectID string) string
}

func (w *memoryWriter) AppendUserMemory(line string) (string, bool, error) {
	return appendMemoryLine(w.store.UserMemoryPath(), line, optimizer.UserMemoryCap)
}

func (w *memoryWriter) AppendProjectMemory(projectID, line string) (string, bool, error) {
	if strings.TrimSpace(projectID) == "" {
		return "", false, errors.New("optimizer: project memory requires scope_id")
	}
	return appendMemoryLine(w.store.ProjectMemoryPath(projectID), line, optimizer.ProjectMemoryCap)
}

// appendMemoryLine appends "- <line>\n" to path. If the resulting size would
// exceed cap, the entry is written to path+".pending" instead and overflowed
// is true. v1 leaves compaction to a future TODO.
func appendMemoryLine(path, line string, cap int) (string, bool, error) {
	line = strings.TrimSpace(line)
	if line == "" {
		return "", false, errors.New("optimizer: memory text is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", false, err
	}
	existing, _ := os.ReadFile(path)
	entry := fmt.Sprintf("- %s\n", line)
	if len(existing)+len(entry) > cap {
		pending := path + ".pending"
		return pending, true, appendFile(pending, entry)
	}
	return path, false, appendFile(path, entry)
}

func appendFile(path, content string) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(content)
	return err
}

// ---------- SkillWriter impl ----------

type skillWriter struct {
	app *App
}

func (w *skillWriter) CreateSkillFromDraft(name, body string) (string, error) {
	if strings.TrimSpace(name) == "" {
		name = "auto-optimized-" + time.Now().UTC().Format("20060102-150405")
	}
	record, err := w.app.CreateSkill(name)
	if err != nil {
		return "", err
	}
	if err := w.app.PutSkillFile(record.ID, "SKILL.md", body); err != nil {
		return "", err
	}
	return record.Path, nil
}
