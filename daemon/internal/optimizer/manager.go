package optimizer

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Manager is the optimizer's public surface. App wraps a Manager and exposes
// its methods over RPC.
type Manager struct {
	store     *Store
	scanner   *Scanner
	scheduler *Scheduler
	memWriter MemoryWriter
	skillFS   SkillWriter

	guard inFlightGuard

	// acceptMu serializes the Accept branch of Act so a double-clicked Accept
	// (or two RPC clients) cannot both pass the idempotency check, both run
	// applyAccept, and both append a state event. Side effects (memory line,
	// skill file, applied markdown) must happen at most once per suggestion.
	acceptMu sync.Mutex
}

// MemoryEntry is one accepted memory suggestion, materialized into a
// standalone file on disk with frontmatter and a one-line pointer in the
// scope's MEMORY.md index.
type MemoryEntry struct {
	Title       string    // suggestion title — used as the index link label and frontmatter description fallback
	Description string    // one-line index/frontmatter description (sug.Impact or short body)
	Body        string    // the actual memory content (preview.Text)
	MinerID     string    // already sanitized via safeID upstream; uniqueness suffix
	ScanID      string    // origin scan id, recorded in frontmatter
	GeneratedAt time.Time // origin scan timestamp, recorded in frontmatter
}

// MemoryWriter persists an accepted memory as a typed file plus an index line.
// Returns (bodyPath, indexFull). indexFull=true means the body file was
// written normally but the MEMORY.md index would have exceeded its cap, so
// the index pointer landed in MEMORY.md.pending. Caller routes the suggestion
// to pending_compaction in that case.
type MemoryWriter interface {
	WriteUserMemory(entry MemoryEntry) (path string, indexFull bool, err error)
	WriteProjectMemory(projectID string, entry MemoryEntry) (path string, indexFull bool, err error)
}

// SkillWriter materializes a SKILL.md draft into the user's skills directory
// when a skill suggestion is accepted. The optimizer does not own skill
// storage; this is delegated to the existing skill subsystem in app/.
type SkillWriter interface {
	CreateSkillFromDraft(name string, body string) (path string, err error)
}

func NewManager(store *Store, scanner *Scanner, mem MemoryWriter, skills SkillWriter) *Manager {
	return &Manager{store: store, scanner: scanner, memWriter: mem, skillFS: skills}
}

// AttachScheduler is called by the daemon after construction so the manager
// can stop it on shutdown if needed.
func (m *Manager) AttachScheduler(s *Scheduler) { m.scheduler = s }

// ---------- List + state read ----------

func (m *Manager) ListSuggestions() (SuggestionList, error) {
	latestID, err := m.store.LatestScanID()
	if err != nil {
		return SuggestionList{}, err
	}
	out := SuggestionList{Items: []SuggestionEntry{}, Scanning: m.guard.busy()}
	lastEv, _ := m.store.LatestScanEvent()
	out.LastScanStatus = lastEv.Status
	out.LastScanError = lastEv.Error
	if latestID == "" {
		return out, nil
	}
	scan, err := m.store.GetScan(latestID)
	if err != nil {
		return out, nil
	}
	out.LastScanID = latestID
	out.LastScanAt = scan.FinishedAt
	out.RunsAnalyzed = scan.RunsAnalyzed
	states, err := m.store.ListStates()
	if err != nil {
		return out, err
	}
	entries := make([]SuggestionEntry, 0, len(scan.Suggestions))
	for _, sug := range scan.Suggestions {
		entry := SuggestionEntry{Suggestion: sug}
		if st, ok := states[sug.ID]; ok {
			stCopy := st
			entry.State = &stCopy
		}
		entries = append(entries, entry)
	}
	sortByPriority(entries)
	out.Items = entries
	return out, nil
}

// ---------- Scan trigger ----------

// StartScan kicks off a scan asynchronously and returns immediately.
// If a scan is already in flight, returns the same scan_id and inFlight=true.
func (m *Manager) StartScan(ctx context.Context) (scanID string, inFlight bool, err error) {
	if !m.guard.tryAcquire() {
		latest, _ := m.store.LatestScanID()
		return latest, true, nil
	}
	scanID = "scan-" + time.Now().UTC().Format("20060102-150405")
	if err := m.store.SaveScan(Scan{ID: scanID, StartedAt: time.Now().UTC(), Status: ScanStatusRunning}); err != nil {
		m.guard.release()
		return "", false, err
	}
	go func() {
		defer m.guard.release()
		// Background ctx so cancellation isn't tied to the API call.
		_, _ = m.scanner.RunScan(context.Background(), scanID)
	}()
	return scanID, false, nil
}

// ---------- Suggestion actions ----------

func (m *Manager) Act(suggestionID, action string, editedPreview *Preview) error {
	now := time.Now().UTC()
	switch action {
	case ActionEdit:
		if editedPreview == nil {
			return errors.New("optimizer: edit action requires edited_preview")
		}
		return m.store.AppendStateEvent(StateEvent{TS: now, SuggestionID: suggestionID, Action: ActionEdit, EditedPreview: editedPreview})
	case ActionSnooze, ActionDismiss, ActionReset:
		return m.store.AppendStateEvent(StateEvent{TS: now, SuggestionID: suggestionID, Action: action})
	case ActionAccept:
		m.acceptMu.Lock()
		defer m.acceptMu.Unlock()
		states, _ := m.store.ListStates()
		if st, ok := states[suggestionID]; ok {
			if st.State == "accepted" || st.State == ActionPendingCompaction {
				return nil
			}
		}
		// Resolve the suggestion to figure out the side effect.
		sug, err := m.findSuggestion(suggestionID)
		if err != nil {
			return err
		}
		preview := sug.Preview
		// If user edited before accepting, use the edited preview.
		if st, ok := states[suggestionID]; ok && st.EditedPreview != nil {
			preview = *st.EditedPreview
		}
		appliedTo, err := m.applyAccept(sug, preview)
		if errors.Is(err, errMemoryCapHit) {
			return m.store.AppendStateEvent(StateEvent{
				TS:           now,
				SuggestionID: suggestionID,
				Action:       ActionPendingCompaction,
				AppliedTo:    appliedTo,
			})
		}
		if err != nil {
			return err
		}
		return m.store.AppendStateEvent(StateEvent{
			TS:           now,
			SuggestionID: suggestionID,
			Action:       ActionAccept,
			AppliedTo:    appliedTo,
		})
	default:
		return fmt.Errorf("optimizer: unknown action %q", action)
	}
}

// applyAccept routes the accepted suggestion to the right side effect:
// memory → write a typed file under memory/ + append a line to MEMORY.md
// skill  → drop a SKILL.md file
// strategy → write a markdown record under applied/ (no schedule mutation in v1)
//
// LLM-emitted strings used in filesystem paths (ScopeID, MinerID, scanID) are
// re-validated here even though ingestSuggestions already filtered them; an
// edited preview can override the original ScopeID before accept fires.
func (m *Manager) applyAccept(sug Suggestion, preview Preview) (string, error) {
	switch sug.Kind {
	case KindMemoryUser:
		entry := buildMemoryEntry(sug, preview)
		path, indexFull, err := m.memWriter.WriteUserMemory(entry)
		if err != nil {
			return "", err
		}
		if indexFull {
			return path, errMemoryCapHit
		}
		return path, nil
	case KindMemoryProject:
		scopeID, err := safeID(strings.TrimSpace(preview.ScopeID))
		if err != nil {
			return "", fmt.Errorf("optimizer: unsafe project scope: %w", err)
		}
		entry := buildMemoryEntry(sug, preview)
		path, indexFull, err := m.memWriter.WriteProjectMemory(scopeID, entry)
		if err != nil {
			return "", err
		}
		if indexFull {
			return path, errMemoryCapHit
		}
		return path, nil
	case KindSkill:
		body := strings.Join(preview.Lines, "\n")
		return m.skillFS.CreateSkillFromDraft(preview.Name, body)
	case KindStrategy:
		return m.store.WriteAppliedMarkdown(sug.ScanID, sug.MinerID, renderStrategyMarkdown(sug, preview))
	}
	return "", fmt.Errorf("optimizer: unsupported kind %q", sug.Kind)
}

// buildMemoryEntry packs the fields the writer needs out of the suggestion
// and (possibly edited) preview. Description prefers the impact tag, falling
// back to a short slice of the body so the index line is always informative.
func buildMemoryEntry(sug Suggestion, preview Preview) MemoryEntry {
	description := strings.TrimSpace(sug.Impact)
	if description == "" {
		description = firstLine(sug.Body)
	}
	const maxDescription = 160
	if len(description) > maxDescription {
		description = strings.TrimRight(description[:maxDescription-1], " ") + "…"
	}
	return MemoryEntry{
		Title:       strings.TrimSpace(sug.Title),
		Description: description,
		Body:        strings.TrimSpace(preview.Text),
		MinerID:     sug.MinerID,
		ScanID:      sug.ScanID,
		GeneratedAt: sug.GeneratedAt,
	}
}

func firstLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			return line
		}
	}
	return ""
}

var errMemoryCapHit = errors.New("optimizer: MEMORY.md index cap reached; index line queued under .pending")

func renderStrategyMarkdown(sug Suggestion, preview Preview) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", sug.Title)
	fmt.Fprintf(&b, "_scan_id_: %s  \n_suggestion_id_: %s  \n_status_: logged  \n_logged_at_: %s\n\n",
		sug.ScanID, sug.MinerID, time.Now().UTC().Format(time.RFC3339))
	if sug.Body != "" {
		b.WriteString(sug.Body + "\n\n")
	}
	if len(sug.Evidence.Runs) > 0 || len(sug.Evidence.Windows) > 0 {
		b.WriteString("## Evidence\n")
		for _, r := range sug.Evidence.Runs {
			fmt.Fprintf(&b, "- run: %s\n", r)
		}
		for _, w := range sug.Evidence.Windows {
			fmt.Fprintf(&b, "- window: %s\n", w)
		}
		b.WriteString("\n")
	}
	b.WriteString("## Preview\n")
	if preview.Type == "diff" || preview.Type == "plan" {
		b.WriteString("```\n")
		b.WriteString(strings.Join(preview.Lines, "\n"))
		b.WriteString("\n```\n")
	} else {
		b.WriteString(strings.Join(preview.Lines, "\n") + "\n")
	}
	return b.String()
}

func (m *Manager) findSuggestion(suggestionID string) (Suggestion, error) {
	parts := strings.SplitN(suggestionID, ":", 2)
	if len(parts) != 2 {
		return Suggestion{}, fmt.Errorf("optimizer: bad suggestion id %q", suggestionID)
	}
	scan, err := m.store.GetScan(parts[0])
	if err != nil {
		return Suggestion{}, err
	}
	for _, s := range scan.Suggestions {
		if s.ID == suggestionID {
			return s, nil
		}
	}
	return Suggestion{}, fmt.Errorf("optimizer: suggestion %q not found", suggestionID)
}

// ---------- Schedule ----------

func (m *Manager) GetSchedule() (Schedule, error) { return m.store.LoadSchedule() }

func (m *Manager) SetSchedule(sched Schedule) (Schedule, error) {
	if err := validateSchedule(&sched); err != nil {
		return Schedule{}, err
	}
	if err := m.store.SaveSchedule(sched); err != nil {
		return Schedule{}, err
	}
	if m.scheduler != nil {
		m.scheduler.Refresh()
	}
	return sched, nil
}

func validateSchedule(s *Schedule) error {
	switch s.Cadence {
	case "off", "daily", "weekly", "monthly":
	default:
		return fmt.Errorf("optimizer: bad cadence %q", s.Cadence)
	}
	if s.Cadence == "weekly" && (s.Day < 0 || s.Day > 6) {
		return fmt.Errorf("optimizer: day must be 0..6")
	}
	if s.Cadence == "monthly" && (s.DOM < 1 || s.DOM > 28) {
		return fmt.Errorf("optimizer: dom must be 1..28")
	}
	switch s.Threshold {
	case "", "all":
		s.Threshold = "all"
	case "med", "high":
	default:
		return fmt.Errorf("optimizer: bad threshold %q", s.Threshold)
	}
	if s.TZ == "" {
		s.TZ = "Local"
	}
	if s.Time == "" {
		s.Time = "03:00"
	}
	if _, _, ok := parseHHMM(s.Time); !ok {
		return fmt.Errorf("optimizer: bad time %q (want HH:MM)", s.Time)
	}
	return nil
}

// ---------- Scans (privacy modal) ----------

// GetScan returns the named scan, or the most recent one when id is empty.
func (m *Manager) GetScan(id string) (Scan, error) {
	if id == "" {
		latest, err := m.store.LatestScanID()
		if err != nil {
			return Scan{}, err
		}
		if latest == "" {
			return Scan{}, errors.New("optimizer: no scans available")
		}
		id = latest
	}
	return m.store.GetScan(id)
}

func (m *Manager) PurgeScans() (int, error) {
	return m.store.PurgeScans()
}
