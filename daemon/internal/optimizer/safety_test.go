package optimizer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSafeID(t *testing.T) {
	cases := []struct {
		in string
		ok bool
	}{
		{"abc123", true},
		{"s-1", true},
		{"01234567-89ab-cdef-0123-456789abcdef", true},
		{"scan.2026-05-13", true},
		{"", false},
		{".", false},
		{"..", false},
		{"a/b", false},
		{"a\\b", false},
		{"../etc/passwd", false},
		{"a..b", false},
		{"foo;rm -rf /", false},
		{"with space", false},
		{strings.Repeat("x", safeIDMaxLen+1), false},
	}
	for _, c := range cases {
		_, err := safeID(c.in)
		got := err == nil
		if got != c.ok {
			t.Errorf("safeID(%q) ok=%v want=%v err=%v", c.in, got, c.ok, err)
		}
	}
}

func TestIngestSuggestionsRejectsUnsafeProjectScope(t *testing.T) {
	in := []Suggestion{{
		ID:       "raw-id",
		Kind:     KindMemoryProject,
		Priority: PriorityHigh,
		Title:    "Try em-dashes",
		Preview:  Preview{Type: "memory", ScopeID: "../etc", Text: "evil"},
	}, {
		ID:       "raw-id-2",
		Kind:     KindMemoryProject,
		Priority: PriorityHigh,
		Title:    "Good one",
		Preview:  Preview{Type: "memory", ScopeID: "proj-abc123", Text: "fine"},
	}}
	sched := Schedule{
		Surfaces:  ScheduleSurfaces{Memory: true},
		Threshold: "all",
	}
	out := ingestSuggestions(in, sched, "scan-1")
	if len(out) != 1 {
		t.Fatalf("expected 1 suggestion after filtering, got %d", len(out))
	}
	if out[0].Preview.ScopeID != "proj-abc123" {
		t.Fatalf("expected safe scope to survive, got %q", out[0].Preview.ScopeID)
	}
}

func TestIngestSuggestionsClampsRunawayFields(t *testing.T) {
	long := strings.Repeat("a", maxBodyLen+500)
	tooManyLines := make([]string, maxPreviewLines+50)
	for i := range tooManyLines {
		tooManyLines[i] = "line " + strings.Repeat("x", 1)
	}
	in := []Suggestion{{
		ID:       "s",
		Kind:     KindStrategy,
		Priority: PriorityHigh,
		Title:    strings.Repeat("T", maxTitleLen+50),
		Body:     long,
		Preview:  Preview{Type: "plan", Lines: tooManyLines},
	}}
	sched := Schedule{Surfaces: ScheduleSurfaces{Strategy: true}, Threshold: "all"}
	out := ingestSuggestions(in, sched, "scan-clamp")
	if len(out) != 1 {
		t.Fatalf("expected 1 surviving suggestion, got %d", len(out))
	}
	if len(out[0].Title) > maxTitleLen {
		t.Fatalf("title not clamped: len=%d", len(out[0].Title))
	}
	if len(out[0].Body) > maxBodyLen {
		t.Fatalf("body not clamped: len=%d", len(out[0].Body))
	}
	if len(out[0].Preview.Lines) > maxPreviewLines {
		t.Fatalf("preview lines not clamped: len=%d", len(out[0].Preview.Lines))
	}
}

func TestIngestSuggestionsRewritesUnsafeMinerID(t *testing.T) {
	in := []Suggestion{{
		ID:       "../../../tmp/poc",
		Kind:     KindStrategy,
		Priority: PriorityHigh,
		Title:    "evil",
		Preview:  Preview{Type: "plan", Lines: []string{"x"}},
	}}
	sched := Schedule{Surfaces: ScheduleSurfaces{Strategy: true}, Threshold: "all"}
	out := ingestSuggestions(in, sched, "scan-mid")
	if len(out) != 1 {
		t.Fatalf("expected 1 surviving suggestion, got %d", len(out))
	}
	if strings.ContainsAny(out[0].MinerID, "/\\") || strings.Contains(out[0].MinerID, "..") {
		t.Fatalf("MinerID should be sanitized, got %q", out[0].MinerID)
	}
}

func TestWriteAppliedMarkdownRejectsTraversal(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.WriteAppliedMarkdown("scan-1", "../etc/passwd", "body"); err == nil {
		t.Fatalf("expected WriteAppliedMarkdown to reject traversal suggestionID")
	}
	if _, err := store.WriteAppliedMarkdown("../scan", "sug-1", "body"); err == nil {
		t.Fatalf("expected WriteAppliedMarkdown to reject traversal scanID")
	}
	// Sanity: a legitimate write still succeeds and lands inside applied/.
	full, err := store.WriteAppliedMarkdown("scan-ok", "sug-ok", "ok")
	if err != nil {
		t.Fatalf("legitimate write should succeed: %v", err)
	}
	if rel, err := filepath.Rel(filepath.Join(store.root, "optimizer", "applied"), full); err != nil || strings.HasPrefix(rel, "..") {
		t.Fatalf("legitimate write escaped applied/: %q", full)
	}
}

func TestApplyAcceptRejectsUnsafeScopeOnEdit(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &fakeMemWriter{}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, &fakeSkillWriter{})

	scanID := "scan-evil"
	sugs := []Suggestion{{
		ID: scanID + ":mp-1", MinerID: "mp-1", ScanID: scanID, Kind: KindMemoryProject,
		Priority: PriorityHigh, Title: "p",
		Preview: Preview{Type: "memory", ScopeID: "proj-abc", Text: "fine"},
	}}
	seedScan(t, store, scanID, sugs)

	// User edits the preview to inject a path-traversal scope_id.
	edited := &Preview{Type: "memory", ScopeID: "../../../etc", Text: "evil"}
	if err := mgr.Act(scanID+":mp-1", ActionEdit, edited); err != nil {
		t.Fatalf("edit should record: %v", err)
	}
	// Accept must refuse to apply the unsafe edit.
	if err := mgr.Act(scanID+":mp-1", ActionAccept, nil); err == nil {
		t.Fatalf("accept with unsafe edited scope must error")
	}
	if mem.lastProjectID != "" {
		t.Fatalf("memory writer should not see unsafe scope, got %q", mem.lastProjectID)
	}
}

func TestApplyAcceptQueuesOverflowForCompaction(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &fakeMemWriter{overflow: true}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, &fakeSkillWriter{})

	scanID := "scan-cap"
	sugs := []Suggestion{{
		ID: scanID + ":mu-1", MinerID: "mu-1", ScanID: scanID, Kind: KindMemoryUser,
		Priority: PriorityHigh, Title: "m",
		Preview: Preview{Type: "memory", Text: "Prefer em-dashes."},
	}}
	seedScan(t, store, scanID, sugs)

	if err := mgr.Act(scanID+":mu-1", ActionAccept, nil); err != nil {
		t.Fatalf("overflow accept should not surface as error: %v", err)
	}
	states, err := store.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	if got := states[scanID+":mu-1"].State; got != "pending_compaction" {
		t.Fatalf("overflow should record pending_compaction state, got %q", got)
	}
	if !strings.HasSuffix(states[scanID+":mu-1"].AppliedTo, "/USER.md") {
		t.Fatalf("AppliedTo should be a path, got %q", states[scanID+":mu-1"].AppliedTo)
	}
}

func TestTouchLastScanAtBeatsConcurrentSave(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Seed an explicit, non-default schedule. A racing Touch must not clobber it.
	custom := Schedule{
		Cadence:   "daily",
		Time:      "07:30",
		TZ:        "Local",
		Threshold: "high",
		Surfaces:  ScheduleSurfaces{Skill: true},
	}
	if err := store.SaveSchedule(custom); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := store.TouchLastScanAt(now); err != nil {
		t.Fatal(err)
	}
	got, err := store.LoadSchedule()
	if err != nil {
		t.Fatal(err)
	}
	if got.Cadence != "daily" || got.Time != "07:30" || got.Threshold != "high" || !got.Surfaces.Skill {
		t.Fatalf("Touch overwrote unrelated schedule fields: %+v", got)
	}
	if got.LastScanAt.IsZero() {
		t.Fatalf("LastScanAt not recorded")
	}
}

func TestValidateScheduleRejectsBadTime(t *testing.T) {
	if err := validateSchedule(&Schedule{Cadence: "daily", Time: "25:99"}); err == nil {
		t.Fatalf("expected bad time to fail validation")
	}
	if err := validateSchedule(&Schedule{Cadence: "daily", Time: "abc"}); err == nil {
		t.Fatalf("expected non-HH:MM string to fail validation")
	}
	s := &Schedule{Cadence: "daily", Time: "09:15"}
	if err := validateSchedule(s); err != nil {
		t.Fatalf("valid HH:MM should pass: %v", err)
	}
}

// hint to keep `os` imported for any future expansions.
var _ = os.PathSeparator
