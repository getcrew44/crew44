package optimizer

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// StateEvent is one append-only record in suggestions.jsonl.
// Each scan ingest writes one StateEvent per suggestion with Action="new".
// Subsequent user actions (accept/edit/snooze/dismiss/reset) are appended.
// Rehydrate folds events into state.json.
type StateEvent struct {
	TS            time.Time `json:"ts"`
	SuggestionID  string    `json:"suggestion_id"`
	Action        string    `json:"action"` // "new" | accept | edit | snooze | dismiss | reset
	EditedPreview *Preview  `json:"edited_preview,omitempty"`
	AppliedTo     string    `json:"applied_to,omitempty"`
}

// Store persists optimizer state under <root>/optimizer/.
// All writes funnel through the embedded sync.Mutex; reads use the same lock
// (call volume is low; one shared lock keeps the code simple).
type Store struct {
	root string
	mu   sync.Mutex
}

func NewStore(root string) (*Store, error) {
	s := &Store{root: root}
	if err := os.MkdirAll(s.dir(), 0o755); err != nil {
		return nil, err
	}
	if err := s.rehydrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) dir() string                { return filepath.Join(s.root, "optimizer") }
func (s *Store) schedulePath() string       { return filepath.Join(s.dir(), "schedule.json") }
func (s *Store) statePath() string          { return filepath.Join(s.dir(), "state.json") }
func (s *Store) suggestionsLogPath() string { return filepath.Join(s.dir(), "suggestions.jsonl") }
func (s *Store) scanEventsPath() string     { return filepath.Join(s.dir(), "scan-events.jsonl") }
func (s *Store) scansDir() string           { return filepath.Join(s.dir(), "scans") }
func (s *Store) appliedDir() string         { return filepath.Join(s.dir(), "applied") }
func (s *Store) scanPath(id string) string  { return filepath.Join(s.scansDir(), id+".json") }
func (s *Store) failedScanPath(id string) string {
	return filepath.Join(s.scansDir(), id+".failed.txt")
}

// ---------- Schedule ----------

func (s *Store) LoadSchedule() (Schedule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var sched Schedule
	if err := readJSON(s.schedulePath(), &sched); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return DefaultSchedule(), nil
		}
		return Schedule{}, err
	}
	return sched, nil
}

func (s *Store) SaveSchedule(sched Schedule) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSONAtomic(s.schedulePath(), sched)
}

// TouchLastScanAt updates only LastScanAt under a single lock so a concurrent
// SaveSchedule (user clicking Save in the modal while a scan finishes) can't
// be silently clobbered by the stale schedule loaded before the modal write.
func (s *Store) TouchLastScanAt(t time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var sched Schedule
	if err := readJSON(s.schedulePath(), &sched); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		sched = DefaultSchedule()
	}
	sched.LastScanAt = t
	return writeJSONAtomic(s.schedulePath(), sched)
}

// ---------- Scans ----------

func (s *Store) SaveScan(scan Scan) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.scansDir(), 0o755); err != nil {
		return err
	}
	return writeJSONAtomic(s.scanPath(scan.ID), scan)
}

func (s *Store) GetScan(id string) (Scan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var scan Scan
	err := readJSON(s.scanPath(id), &scan)
	return scan, err
}

func (s *Store) LatestScanID() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.scansDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	var latest string
	var latestMtime time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().After(latestMtime) {
			latestMtime = info.ModTime()
			latest = strings.TrimSuffix(e.Name(), ".json")
		}
	}
	return latest, nil
}

// LatestFinishedScanID returns the id of the most recently completed scan
// (FinishedAt non-zero). Returns "" with nil error when no finished scan exists.
// Used by ListSuggestions so a rescan in progress does not overwrite LastScanAt
// with a zero time while the old scan's suggestions are still being displayed.
func (s *Store) LatestFinishedScanID() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.scansDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", nil
		}
		return "", err
	}
	var latest string
	var latestFinished time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".json")
		var scan Scan
		if err := readJSON(s.scanPath(id), &scan); err != nil {
			continue
		}
		if scan.FinishedAt.IsZero() {
			continue
		}
		if scan.FinishedAt.After(latestFinished) {
			latestFinished = scan.FinishedAt
			latest = id
		}
	}
	return latest, nil
}

func (s *Store) WriteFailedScanRaw(scanID, raw string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.scansDir(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(s.failedScanPath(scanID), []byte(raw), 0o644)
}

func (s *Store) PurgeScans() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.scansDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if err := os.Remove(filepath.Join(s.scansDir(), e.Name())); err == nil {
			n++
		}
	}
	return n, nil
}

// ---------- Scan events (failure banner) ----------

func (s *Store) AppendScanEvent(ev ScanEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return appendJSONLine(s.scanEventsPath(), ev)
}

func (s *Store) LatestScanEvent() (ScanEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var events []ScanEvent
	if err := readJSONL(s.scanEventsPath(), &events); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ScanEvent{}, nil
		}
		return ScanEvent{}, err
	}
	if len(events) == 0 {
		return ScanEvent{}, nil
	}
	return events[len(events)-1], nil
}

// ---------- Suggestion state ----------

func (s *Store) AppendStateEvent(ev StateEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := appendJSONLine(s.suggestionsLogPath(), ev); err != nil {
		return err
	}
	return s.projectLocked()
}

func (s *Store) ListStates() (map[string]SuggestionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var state map[string]SuggestionState
	err := readJSON(s.statePath(), &state)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if state == nil {
		state = map[string]SuggestionState{}
	}
	return state, nil
}

// rehydrate replays suggestions.jsonl into state.json.
// Called once on startup so a torn state.json self-heals.
func (s *Store) rehydrate() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.projectLocked()
}

func (s *Store) projectLocked() error {
	var events []StateEvent
	if err := readJSONL(s.suggestionsLogPath(), &events); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	state := map[string]SuggestionState{}
	for _, ev := range events {
		st, ok := state[ev.SuggestionID]
		if !ok {
			st = SuggestionState{SuggestionID: ev.SuggestionID, State: "pending"}
		}
		switch ev.Action {
		case "new":
			// First sighting; keep pending.
		case ActionEdit:
			st.EditedPreview = ev.EditedPreview
		case ActionAccept:
			st.State = "accepted"
			st.AppliedTo = ev.AppliedTo
		case ActionPendingCompaction:
			st.State = "pending_compaction"
			st.AppliedTo = ev.AppliedTo
		case ActionSnooze:
			st.State = "snoozed"
		case ActionDismiss:
			st.State = "dismissed"
		case ActionReset:
			st.State = "pending"
			st.AppliedTo = ""
		}
		st.UpdatedAt = ev.TS
		state[ev.SuggestionID] = st
	}
	return writeJSONAtomic(s.statePath(), state)
}

// ---------- Applied records ----------

// WriteAppliedMarkdown materializes a strategy accept under applied/.
// Both scanID (server-generated, but defense in depth) and suggestionID
// (LLM-emitted MinerID) are re-validated here; if either fails the safe-ID
// check the write is refused rather than escaping the applied/ sandbox.
func (s *Store) WriteAppliedMarkdown(scanID, suggestionID, body string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	safeScan, err := safeID(scanID)
	if err != nil {
		return "", fmt.Errorf("optimizer: unsafe scan id: %w", err)
	}
	safeSug, err := safeID(suggestionID)
	if err != nil {
		return "", fmt.Errorf("optimizer: unsafe suggestion id: %w", err)
	}
	if err := os.MkdirAll(s.appliedDir(), 0o755); err != nil {
		return "", err
	}
	name := safeScan + "-" + safeSug + ".md"
	full := filepath.Join(s.appliedDir(), name)
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		return "", err
	}
	return full, nil
}

// ---------- I/O helpers (file-scoped, mirror store/store.go style) ----------

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

// writeJSONAtomic is the v1 store concurrency contract: write to .tmp, rename.
// Renames are atomic on macOS/Linux so a torn write self-heals on next rehydrate.
func writeJSONAtomic(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readJSONL[T any](path string, out *[]T) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	items := make([]T, 0)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var item T
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			// Skip a torn line; rehydrate must survive partial writes.
			continue
		}
		items = append(items, item)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	*out = items
	return nil
}

func appendJSONLine(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(data, '\n')); err != nil {
		return err
	}
	return nil
}

// sortByPriority is a small helper used by Manager.List for stable UI ordering.
func sortByPriority(items []SuggestionEntry) {
	order := map[string]int{PriorityHigh: 0, PriorityMed: 1, PriorityLow: 2}
	sort.SliceStable(items, func(i, j int) bool {
		oi := order[items[i].Suggestion.Priority]
		oj := order[items[j].Suggestion.Priority]
		if oi != oj {
			return oi < oj
		}
		return items[i].Suggestion.GeneratedAt.Before(items[j].Suggestion.GeneratedAt)
	})
}
