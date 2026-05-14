package optimizer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"
)

// ChatDispatcher abstracts the chat session machinery so the scanner can be
// unit-tested without booting a real *app.App. The production impl wraps App
// methods (CreateChat / PostMessage / GetChat / ListEvents / CancelChat).
type ChatDispatcher interface {
	CreateChat(ctx context.Context, projectID, title, agentID string) (chatID string, err error)
	PostMessage(ctx context.Context, chatID, agentID, content string) error
	WaitDone(ctx context.Context, chatID string, idleTimeout time.Duration) error
	AssistantText(ctx context.Context, chatID string) (string, error)
	BuildScanCorpus(ctx context.Context, since, until time.Time, limit int) (ScanCorpus, error)
	Cancel(ctx context.Context, chatID string) error
}

// PartnerResolver returns the runnable Partner agent ID for scan dispatch.
// Returns ErrPartnerUnavailable when Partner is archived, missing, or its
// runtime is offline. See design doc Partner agent resolution.
type PartnerResolver interface {
	ResolvePartnerAgent() (agentID string, err error)
}

var (
	ErrPartnerUnavailable = errors.New("optimizer: partner agent unavailable")
	ErrScanInFlight       = errors.New("optimizer: scan in flight")
)

// Scanner orchestrates one scan run. Concurrent scans are blocked by the
// inFlight atomic guard owned by the Manager.
type Scanner struct {
	store      *Store
	dispatcher ChatDispatcher
	resolver   PartnerResolver
	pollTick   time.Duration // default 500ms; tests override
	maxWait    time.Duration // idle timeout; default 2m
}

func NewScanner(store *Store, dispatcher ChatDispatcher, resolver PartnerResolver) *Scanner {
	return &Scanner{
		store:      store,
		dispatcher: dispatcher,
		resolver:   resolver,
		pollTick:   500 * time.Millisecond,
		maxWait:    2 * time.Minute,
	}
}

// RunScan executes one end-to-end scan and persists results.
// Always emits exactly one ScanEvent on completion (success or failure)
// so AutoRoute's banner reflects every run.
func (s *Scanner) RunScan(ctx context.Context, scanID string) (Scan, error) {
	scan := Scan{
		ID:        scanID,
		StartedAt: time.Now().UTC(),
		Status:    ScanStatusRunning,
	}
	_ = s.store.AppendScanEvent(ScanEvent{ScanID: scanID, Status: ScanStatusRunning, TS: scan.StartedAt})

	finish := func(status, errMsg string) (Scan, error) {
		scan.Status = status
		scan.Error = errMsg
		scan.FinishedAt = time.Now().UTC()
		_ = s.store.SaveScan(scan)
		_ = s.store.AppendScanEvent(ScanEvent{ScanID: scanID, Status: status, Error: errMsg, TS: scan.FinishedAt})
		if status == ScanStatusSuccess {
			_ = s.store.TouchLastScanAt(scan.FinishedAt)
		}
		if errMsg != "" {
			return scan, errors.New(errMsg)
		}
		return scan, nil
	}

	partnerID, err := s.resolver.ResolvePartnerAgent()
	if err != nil {
		return finish(ScanStatusFailed, err.Error())
	}

	sched, err := s.store.LoadSchedule()
	if err != nil {
		return finish(ScanStatusFailed, "load schedule: "+err.Error())
	}

	now := time.Now()
	windowStart := now.AddDate(0, 0, -7)
	if !sched.LastScanAt.IsZero() && sched.LastScanAt.Before(now) {
		windowStart = sched.LastScanAt
	}
	corpus, err := s.dispatcher.BuildScanCorpus(ctx, windowStart, now, 80)
	if err != nil {
		return finish(ScanStatusFailed, "build scan corpus: "+err.Error())
	}
	prompt := BuildScanPromptWithCorpus(now, sched, corpus)

	chatID, err := s.dispatcher.CreateChat(ctx, SystemProjectID, "[auto-scan] "+scanID, partnerID)
	if err != nil {
		return finish(ScanStatusFailed, "create chat: "+err.Error())
	}

	envelope, raw, err := s.runWithRetry(ctx, chatID, partnerID, prompt)
	if err != nil {
		_ = s.store.WriteFailedScanRaw(scanID, raw)
		return finish(ScanStatusFailed, err.Error())
	}

	scan.RunsAnalyzed = envelope.ScanSummary.RunsAnalyzed
	scan.Suggestions = ingestSuggestions(envelope.Suggestions, sched, scanID)
	// Append "new" state events so list calls discover the suggestions.
	for _, sug := range scan.Suggestions {
		_ = s.store.AppendStateEvent(StateEvent{
			TS:           time.Now().UTC(),
			SuggestionID: sug.ID,
			Action:       "new",
		})
	}
	return finish(ScanStatusSuccess, "")
}

// runWithRetry posts the scan prompt, waits, parses the response.
// On a parse failure, sends a single corrective re-prompt before giving up.
func (s *Scanner) runWithRetry(ctx context.Context, chatID, agentID, prompt string) (Envelope, string, error) {
	if err := s.dispatcher.PostMessage(ctx, chatID, agentID, prompt); err != nil {
		return Envelope{}, "", fmt.Errorf("post message: %w", err)
	}
	if err := s.dispatcher.WaitDone(ctx, chatID, s.maxWait); err != nil {
		_ = s.dispatcher.Cancel(context.Background(), chatID)
		return Envelope{}, "", fmt.Errorf("wait: %w", err)
	}
	text, err := s.dispatcher.AssistantText(ctx, chatID)
	if err != nil {
		return Envelope{}, "", fmt.Errorf("read response: %w", err)
	}
	if env, ok := parseEnvelope(text); ok {
		return env, text, nil
	}

	// One corrective retry. See design doc JSON output parsing.
	retry := "Your previous response did not contain a valid JSON block matching the schema. Please re-emit only the JSON block, nothing else."
	if err := s.dispatcher.PostMessage(ctx, chatID, agentID, retry); err != nil {
		return Envelope{}, text, fmt.Errorf("retry post: %w", err)
	}
	if err := s.dispatcher.WaitDone(ctx, chatID, s.maxWait); err != nil {
		return Envelope{}, text, fmt.Errorf("retry wait: %w", err)
	}
	text2, err := s.dispatcher.AssistantText(ctx, chatID)
	if err != nil {
		return Envelope{}, text + "\n---retry---\n" + text2, fmt.Errorf("retry read: %w", err)
	}
	if env, ok := parseEnvelope(text2); ok {
		return env, text2, nil
	}
	return Envelope{}, text + "\n---retry---\n" + text2, errors.New("parse failed after retry")
}

func parseEnvelope(text string) (Envelope, bool) {
	raw, err := extractFencedJSON(text)
	if err != nil {
		return Envelope{}, false
	}
	var env Envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return Envelope{}, false
	}
	if env.SchemaVersion != 1 {
		return Envelope{}, false
	}
	return env, true
}

// ingestSuggestions filters by surfaces+threshold, rewrites IDs to be globally
// unique, and drops anything that fails per-suggestion validation. One bad
// item never kills the scan; we drop it silently and keep the rest.
//
// LLM-emitted strings used in filesystem paths (MinerID, Preview.ScopeID) are
// run through safeID before they reach the accept handler; bounded text fields
// are clamped so a runaway suggestion can't blow up the prompt or applied file.
func ingestSuggestions(in []Suggestion, sched Schedule, scanID string) []Suggestion {
	out := make([]Suggestion, 0, len(in))
	now := time.Now().UTC()
	for _, sug := range in {
		if !validSuggestion(sug) {
			continue
		}
		if !surfaceAllowed(sug.Kind, sched.Surfaces) {
			continue
		}
		if !thresholdAllowed(sug.Priority, sched.Threshold) {
			continue
		}
		raw := strings.TrimSpace(sug.ID)
		miner := raw
		if miner != "" {
			if cleaned, err := safeID(miner); err == nil {
				miner = cleaned
			} else {
				miner = ""
			}
		}
		if miner == "" {
			miner = fmt.Sprintf("s-%d", len(out)+1)
		}
		if sug.Kind == KindMemoryProject {
			if _, err := safeID(strings.TrimSpace(sug.Preview.ScopeID)); err != nil {
				// Reject the suggestion outright; an unsafe ScopeID is the
				// path-traversal vector the accept handler defends against.
				continue
			}
		}
		sug.MinerID = miner
		sug.ID = scanID + ":" + miner
		sug.ScanID = scanID
		sug.Title = clamp(strings.TrimSpace(sug.Title), maxTitleLen)
		sug.Impact = clamp(strings.TrimSpace(sug.Impact), maxImpactLen)
		sug.Body = clamp(sug.Body, maxBodyLen)
		sug.Evidence.Runs = clampEvidence(sug.Evidence.Runs)
		sug.Evidence.Windows = clampEvidence(sug.Evidence.Windows)
		sug.Preview.Lines = clampLines(sug.Preview.Lines)
		if sug.Kind == KindMemoryUser || sug.Kind == KindMemoryProject {
			sug.Preview.Text = clamp(strings.TrimSpace(sug.Preview.Text), maxMemoryText)
		}
		if sug.GeneratedAt.IsZero() {
			sug.GeneratedAt = now
		}
		out = append(out, sug)
	}
	return out
}

func validSuggestion(s Suggestion) bool {
	switch s.Kind {
	case KindStrategy, KindSkill, KindMemoryProject, KindMemoryUser:
	default:
		return false
	}
	switch s.Priority {
	case PriorityHigh, PriorityMed, PriorityLow:
	default:
		return false
	}
	if strings.TrimSpace(s.Title) == "" {
		return false
	}
	if s.Kind == KindMemoryUser || s.Kind == KindMemoryProject {
		if strings.TrimSpace(s.Preview.Text) == "" {
			return false
		}
		if s.Kind == KindMemoryProject && strings.TrimSpace(s.Preview.ScopeID) == "" {
			return false
		}
	}
	if s.Kind == KindSkill && strings.TrimSpace(s.Preview.Name) == "" {
		return false
	}
	return true
}

func surfaceAllowed(kind string, surfaces ScheduleSurfaces) bool {
	switch kind {
	case KindSkill:
		return surfaces.Skill
	case KindStrategy:
		return surfaces.Strategy
	case KindMemoryProject, KindMemoryUser:
		return surfaces.Memory
	}
	return false
}

func thresholdAllowed(priority, threshold string) bool {
	rank := map[string]int{PriorityLow: 0, PriorityMed: 1, PriorityHigh: 2}
	gate := map[string]int{"all": 0, "med": 1, "high": 2}
	return rank[priority] >= gate[threshold]
}

// inFlightGuard is a small helper used by Manager to serialize scans.
type inFlightGuard struct {
	flag atomic.Bool
}

func (g *inFlightGuard) tryAcquire() bool { return g.flag.CompareAndSwap(false, true) }
func (g *inFlightGuard) release()         { g.flag.Store(false) }
func (g *inFlightGuard) busy() bool       { return g.flag.Load() }
