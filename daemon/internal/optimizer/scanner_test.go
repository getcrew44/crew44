package optimizer

import (
	"context"
	"strings"
	"testing"
	"time"
)

// fakeDispatcher returns canned LLM responses keyed by attempt number.
// Lets scanner tests skip the chat / runtime layer entirely (per T1A).
type fakeDispatcher struct {
	responses []string
	posts     int
	lastPost  string
	corpus    ScanCorpus
	createErr error
	postErr   error
}

func (f *fakeDispatcher) CreateChat(_ context.Context, _, _, _ string) (string, error) {
	if f.createErr != nil {
		return "", f.createErr
	}
	return "chat-fake", nil
}
func (f *fakeDispatcher) PostMessage(_ context.Context, _, _, content string) error {
	if f.postErr != nil {
		return f.postErr
	}
	f.posts++
	f.lastPost = content
	return nil
}
func (f *fakeDispatcher) WaitDone(_ context.Context, _ string, _ time.Duration) error { return nil }
func (f *fakeDispatcher) AssistantText(_ context.Context, _ string) (string, error) {
	idx := f.posts - 1
	if idx < 0 || idx >= len(f.responses) {
		return "", nil
	}
	return f.responses[idx], nil
}
func (f *fakeDispatcher) Cancel(_ context.Context, _ string) error { return nil }
func (f *fakeDispatcher) BuildScanCorpus(_ context.Context, since, until time.Time, _ int) (ScanCorpus, error) {
	if f.corpus.WindowStart.IsZero() {
		f.corpus.WindowStart = since
	}
	if f.corpus.WindowEnd.IsZero() {
		f.corpus.WindowEnd = until
	}
	return f.corpus, nil
}

type fakeResolver struct {
	agentID string
	err     error
}

func (r *fakeResolver) ResolvePartnerAgent() (string, error) {
	return r.agentID, r.err
}

func newTestScanner(t *testing.T, disp ChatDispatcher, resolver PartnerResolver) (*Store, *Scanner) {
	t.Helper()
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := NewScanner(store, disp, resolver)
	s.maxWait = 2 * time.Second
	s.pollTick = 10 * time.Millisecond
	return store, s
}

const validJSON = "```json\n" + `{
  "schema_version": 1,
  "scan_summary": { "window": "2026-05-06..2026-05-13", "runs_analyzed": 12 },
  "suggestions": [
    {
      "id": "k-1", "kind": "skill", "priority": "high",
      "title": "Codify the locale-video prep",
      "body": "5 runs in 8 days.", "impact": "-4m/run",
      "evidence": { "runs": ["t-1"], "windows": ["5 runs"] },
      "preview": { "type": "skill", "name": "locale-video-prep", "lines": ["# locale-video-prep"] }
    },
    {
      "id": "u-1", "kind": "memory-user", "priority": "low",
      "title": "Style: em-dash over semicolon",
      "body": "Replaced 19 semicolons.", "impact": "Style fit",
      "evidence": { "runs": ["t-2"], "windows": ["7 reviews"] },
      "preview": { "type": "memory", "scope": "Jordan", "text": "Prefer em-dashes." }
    },
    {
      "id": "broken", "kind": "memory-project", "priority": "high",
      "title": "Missing scope_id should drop",
      "preview": { "type": "memory", "scope": "x", "text": "no scope_id" }
    }
  ]
}` + "\n```"

func TestScanner_HappyPathAndFilters(t *testing.T) {
	disp := &fakeDispatcher{responses: []string{validJSON}}
	store, s := newTestScanner(t, disp, &fakeResolver{agentID: "agent-partner"})
	// Default schedule has threshold=med → drops low priority u-1; surfaces all on.
	scan, err := s.RunScan(context.Background(), "scan-1")
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	if scan.Status != ScanStatusSuccess {
		t.Fatalf("want success, got %q", scan.Status)
	}
	if len(scan.Suggestions) != 1 {
		t.Fatalf("want 1 suggestion after filtering, got %d (%+v)", len(scan.Suggestions), scan.Suggestions)
	}
	got := scan.Suggestions[0]
	if got.ID != "scan-1:k-1" {
		t.Fatalf("want rewritten id scan-1:k-1, got %q", got.ID)
	}
	if got.MinerID != "k-1" {
		t.Fatalf("want miner_id k-1, got %q", got.MinerID)
	}
	// One state event per persisted suggestion.
	states, _ := store.ListStates()
	if _, ok := states["scan-1:k-1"]; !ok {
		t.Fatalf("missing state event for accepted scan, got %+v", states)
	}
}

func TestScanner_SurfacesAndThreshold(t *testing.T) {
	disp := &fakeDispatcher{responses: []string{validJSON}}
	store, s := newTestScanner(t, disp, &fakeResolver{agentID: "agent-partner"})
	// Disable memory surface; raise threshold to high. u-1 was already low; k-1 is high so it stays.
	must(t, store.SaveSchedule(Schedule{
		Cadence:   "weekly",
		Time:      "03:00",
		Threshold: "high",
		Surfaces:  ScheduleSurfaces{Skill: true, Memory: false, Strategy: true},
	}))
	scan, err := s.RunScan(context.Background(), "scan-2")
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Suggestions) != 1 || scan.Suggestions[0].Kind != KindSkill {
		t.Fatalf("expected just the skill suggestion, got %+v", scan.Suggestions)
	}
}

func TestScanner_ParseRetrySucceeds(t *testing.T) {
	disp := &fakeDispatcher{responses: []string{"sorry I forgot the JSON", validJSON}}
	_, s := newTestScanner(t, disp, &fakeResolver{agentID: "agent-partner"})
	scan, err := s.RunScan(context.Background(), "scan-3")
	if err != nil {
		t.Fatalf("retry should succeed: %v", err)
	}
	if scan.Status != ScanStatusSuccess {
		t.Fatalf("want success, got %q", scan.Status)
	}
	if disp.posts != 2 {
		t.Fatalf("want 2 PostMessage calls, got %d", disp.posts)
	}
}

func TestScanner_ParseFailureAfterRetry(t *testing.T) {
	disp := &fakeDispatcher{responses: []string{"no json", "still no json"}}
	store, s := newTestScanner(t, disp, &fakeResolver{agentID: "agent-partner"})
	scan, err := s.RunScan(context.Background(), "scan-4")
	if err == nil {
		t.Fatalf("want error after retry exhausted")
	}
	if scan.Status != ScanStatusFailed {
		t.Fatalf("want failed status, got %q", scan.Status)
	}
	// Failed scans should write the raw response for debugging.
	raw, err := store.GetScan("scan-4")
	if err != nil {
		t.Fatal(err)
	}
	if raw.Error == "" {
		t.Fatalf("expected error message on failed scan")
	}
}

func TestScanner_PartnerUnavailable(t *testing.T) {
	disp := &fakeDispatcher{}
	_, s := newTestScanner(t, disp, &fakeResolver{err: ErrPartnerUnavailable})
	scan, err := s.RunScan(context.Background(), "scan-5")
	if err == nil || scan.Status != ScanStatusFailed {
		t.Fatalf("want failed scan with error, got status=%q err=%v", scan.Status, err)
	}
	if !strings.Contains(scan.Error, "partner") {
		t.Fatalf("error should mention partner, got %q", scan.Error)
	}
}

func TestBuildScanPromptRequiresBoundedMetadataFirstScanning(t *testing.T) {
	prompt := BuildScanPrompt(time.Date(2026, 5, 13, 22, 4, 0, 0, time.Local), DefaultSchedule())
	for _, want := range []string{
		"bounded incremental corpus",
		"source of truth",
		"Do not run shell, filesystem, SQLite, or JSONL discovery",
		"Do not print raw transcript bodies",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("scan prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildScanPromptIncludesFalsePositiveExamples(t *testing.T) {
	prompt := BuildScanPrompt(time.Date(2026, 5, 13, 22, 4, 0, 0, time.Local), DefaultSchedule())
	for _, want := range []string{
		"False-positive examples",
		"Electron IPC",
		"overlay textarea",
		"Reject these even if they appear in 2 sessions",
		"Return {\"suggestions\":[]} rather than a weak candidate",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("scan prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestScannerPostsIncrementalProjectChatCorpus(t *testing.T) {
	since := time.Date(2026, 5, 12, 8, 0, 0, 0, time.UTC)
	until := time.Date(2026, 5, 14, 8, 0, 0, 0, time.UTC)
	disp := &fakeDispatcher{
		responses: []string{validJSON},
		corpus: ScanCorpus{
			WindowStart:  since,
			WindowEnd:    until,
			RunsAnalyzed: 1,
			Chats: []ChatDigest{{
				ProjectID:   "proj-1",
				ProjectName: "Visible",
				ChatID:      "chat-1",
				Title:       "recent work",
				CreatedAt:   since.Add(time.Hour),
				UpdatedAt:   since.Add(2 * time.Hour),
				Snippets: []MessageSnippet{{
					TS:   since.Add(time.Hour),
					Role: "user",
					Text: "please remember this repeated workflow",
				}},
			}},
		},
	}
	store, s := newTestScanner(t, disp, &fakeResolver{agentID: "agent-partner"})
	must(t, store.SaveSchedule(Schedule{
		Cadence:    "weekly",
		Time:       "03:00",
		Threshold:  "med",
		Surfaces:   ScheduleSurfaces{Skill: true, Memory: true, Strategy: true},
		LastScanAt: since,
	}))

	if _, err := s.RunScan(context.Background(), "scan-incremental"); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Incremental project chat corpus",
		"2026-05-12T08:00:00Z",
		"chat-1",
		"please remember this repeated workflow",
		"Do not run shell, filesystem, SQLite, or JSONL discovery",
	} {
		if !strings.Contains(disp.lastPost, want) {
			t.Fatalf("scan prompt missing %q:\n%s", want, disp.lastPost)
		}
	}
}

func TestScannerDefaultIdleTimeoutIsTwoMinutes(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "agent-partner"})
	if s.maxWait != 2*time.Minute {
		t.Fatalf("default idle timeout = %s, want 2m", s.maxWait)
	}
}

func TestExtractFencedJSON(t *testing.T) {
	cases := []struct {
		in      string
		wantSub string
		wantErr bool
	}{
		{in: "before ```json\n{\"a\":1}\n``` after", wantSub: `{"a":1}`},
		{in: "no fence here {\"a\":1} trailing", wantSub: `{"a":1}`},
		{in: "completely unrelated text", wantErr: true},
		{in: "```json\nunterminated", wantErr: true},
	}
	for _, c := range cases {
		got, err := extractFencedJSON(c.in)
		if c.wantErr {
			if err == nil {
				t.Fatalf("want error, got %q", got)
			}
			continue
		}
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !strings.Contains(got, c.wantSub) {
			t.Fatalf("want substring %q in %q", c.wantSub, got)
		}
	}
}
