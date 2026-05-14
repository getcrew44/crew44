package optimizer

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeMemWriter records the last AppendUserMemory / AppendProjectMemory call
// so manager tests can assert the right routing without touching disk.
type fakeMemWriter struct {
	lastUserLine    string
	lastProjectID   string
	lastProjectLine string
	overflow        bool
	err             error
}

func (w *fakeMemWriter) AppendUserMemory(line string) (string, bool, error) {
	w.lastUserLine = line
	return "/fake/USER.md", w.overflow, w.err
}

func (w *fakeMemWriter) AppendProjectMemory(projectID, line string) (string, bool, error) {
	w.lastProjectID = projectID
	w.lastProjectLine = line
	return "/fake/MEMORY.md", w.overflow, w.err
}

type fakeSkillWriter struct {
	lastName string
	lastBody string
	path     string
	err      error
}

func (w *fakeSkillWriter) CreateSkillFromDraft(name, body string) (string, error) {
	w.lastName = name
	w.lastBody = body
	if w.path == "" {
		w.path = "/fake/skills/" + name
	}
	return w.path, w.err
}

// seedScan persists a scan with the given suggestions so Manager.Act can
// find them via store.GetScan. Mirrors what the real scanner ingest path
// does after RunScan succeeds.
func seedScan(t *testing.T, s *Store, scanID string, sugs []Suggestion) {
	t.Helper()
	scan := Scan{
		ID:          scanID,
		StartedAt:   time.Now().UTC(),
		FinishedAt:  time.Now().UTC(),
		Status:      ScanStatusSuccess,
		Suggestions: sugs,
	}
	if err := s.SaveScan(scan); err != nil {
		t.Fatal(err)
	}
	for _, sug := range sugs {
		_ = s.AppendStateEvent(StateEvent{TS: time.Now().UTC(), SuggestionID: sug.ID, Action: "new"})
	}
}

func TestManager_AcceptRoutesByKind(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &fakeMemWriter{}
	skills := &fakeSkillWriter{}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, skills)

	scanID := "scan-acc"
	sugs := []Suggestion{
		{ID: scanID + ":sk-1", MinerID: "sk-1", ScanID: scanID, Kind: KindSkill, Priority: PriorityHigh, Title: "S",
			Preview: Preview{Type: "skill", Name: "my-skill", Lines: []string{"# my-skill", "body"}}},
		{ID: scanID + ":mu-1", MinerID: "mu-1", ScanID: scanID, Kind: KindMemoryUser, Priority: PriorityHigh, Title: "M",
			Preview: Preview{Type: "memory", Text: "Prefer em-dashes."}},
		{ID: scanID + ":mp-1", MinerID: "mp-1", ScanID: scanID, Kind: KindMemoryProject, Priority: PriorityHigh, Title: "P",
			Preview: Preview{Type: "memory", ScopeID: "proj-123", Text: "Uses pnpm workspaces."}},
		{ID: scanID + ":st-1", MinerID: "st-1", ScanID: scanID, Kind: KindStrategy, Priority: PriorityHigh, Title: "Strat",
			Body: "investigate", Preview: Preview{Type: "plan", Lines: []string{"step 1", "step 2"}}},
	}
	seedScan(t, store, scanID, sugs)

	// Skill accept → SkillWriter.CreateSkillFromDraft with joined lines.
	if err := mgr.Act(scanID+":sk-1", ActionAccept, nil); err != nil {
		t.Fatalf("skill accept: %v", err)
	}
	if skills.lastName != "my-skill" {
		t.Fatalf("want skill name my-skill, got %q", skills.lastName)
	}
	if !strings.Contains(skills.lastBody, "# my-skill") {
		t.Fatalf("want skill body to include header, got %q", skills.lastBody)
	}

	// memory-user accept → AppendUserMemory.
	if err := mgr.Act(scanID+":mu-1", ActionAccept, nil); err != nil {
		t.Fatalf("memory-user accept: %v", err)
	}
	if mem.lastUserLine != "Prefer em-dashes." {
		t.Fatalf("want user line set, got %q", mem.lastUserLine)
	}

	// memory-project accept → AppendProjectMemory with scope_id.
	if err := mgr.Act(scanID+":mp-1", ActionAccept, nil); err != nil {
		t.Fatalf("memory-project accept: %v", err)
	}
	if mem.lastProjectID != "proj-123" {
		t.Fatalf("want project id proj-123, got %q", mem.lastProjectID)
	}
	if mem.lastProjectLine != "Uses pnpm workspaces." {
		t.Fatalf("want project line set, got %q", mem.lastProjectLine)
	}

	// strategy accept → applied/<scan>-<miner>.md markdown rendered.
	if err := mgr.Act(scanID+":st-1", ActionAccept, nil); err != nil {
		t.Fatalf("strategy accept: %v", err)
	}

	// All four should now have state=accepted.
	states, err := store.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{":sk-1", ":mu-1", ":mp-1", ":st-1"} {
		got := states[scanID+id].State
		if got != "accepted" {
			t.Fatalf("suggestion %s state=%q, want accepted", id, got)
		}
	}
}

func TestManager_EditPreviewIsUsedOnAccept(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &fakeMemWriter{}
	skills := &fakeSkillWriter{}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, skills)

	scanID := "scan-edit"
	sugs := []Suggestion{
		{ID: scanID + ":mu-1", MinerID: "mu-1", ScanID: scanID, Kind: KindMemoryUser, Priority: PriorityHigh, Title: "M",
			Preview: Preview{Type: "memory", Text: "ORIGINAL TEXT"}},
	}
	seedScan(t, store, scanID, sugs)

	// User edits the preview before accepting.
	edited := &Preview{Type: "memory", Text: "EDITED TEXT"}
	if err := mgr.Act(scanID+":mu-1", ActionEdit, edited); err != nil {
		t.Fatalf("edit: %v", err)
	}
	// Edit alone must NOT have called the memory writer yet.
	if mem.lastUserLine != "" {
		t.Fatalf("edit must not write memory; got %q", mem.lastUserLine)
	}

	// Accept now uses the edited preview, not the original.
	if err := mgr.Act(scanID+":mu-1", ActionAccept, nil); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if mem.lastUserLine != "EDITED TEXT" {
		t.Fatalf("accept should use edited preview, got %q", mem.lastUserLine)
	}

	// Edit without an edited_preview must fail.
	if err := mgr.Act(scanID+":mu-1", ActionEdit, nil); err == nil {
		t.Fatalf("edit without preview should error")
	}

	// Unknown action returns an error.
	if err := mgr.Act(scanID+":mu-1", "telekinesis", nil); err == nil {
		t.Fatalf("unknown action should error")
	}
}

func TestManager_StartScanInFlightGuard(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Use a dispatcher that blocks long enough for the second call to race.
	blockedDisp := &blockingDispatcher{release: make(chan struct{})}
	scanner := NewScanner(store, blockedDisp, &fakeResolver{agentID: "p"})
	scanner.maxWait = 2 * time.Second
	mgr := NewManager(store, scanner, &fakeMemWriter{}, &fakeSkillWriter{})

	firstID, inFlight, err := mgr.StartScan(context.Background())
	if err != nil {
		t.Fatalf("first start: %v", err)
	}
	if inFlight {
		t.Fatalf("first call should not report inFlight")
	}
	if firstID == "" {
		t.Fatalf("expected a scan id from first start")
	}

	// Second call while the first is still running must short-circuit
	// with inFlight=true and return the in-progress scan id (latest known).
	_, inFlight2, err := mgr.StartScan(context.Background())
	if err != nil {
		t.Fatalf("second start: %v", err)
	}
	if !inFlight2 {
		t.Fatalf("second call should report inFlight=true while a scan is running")
	}
	if inFlightID := latestScanID(t, store); inFlightID != firstID {
		t.Fatalf("store should know in-progress scan id %q, got %q", firstID, inFlightID)
	}

	// Release the first scan so the goroutine can exit cleanly.
	close(blockedDisp.release)
	for i := 0; i < 50; i++ {
		if !mgr.guard.busy() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("scan goroutine did not exit")
}

func latestScanID(t *testing.T, s *Store) string {
	t.Helper()
	id, err := s.LatestScanID()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestManager_MemoryOverflowQueuesPendingCompactionWithoutDuplicateWrites(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &fakeMemWriter{overflow: true}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, &fakeSkillWriter{})

	scanID := "scan-overflow"
	sugID := scanID + ":mu-1"
	seedScan(t, store, scanID, []Suggestion{
		{ID: sugID, MinerID: "mu-1", ScanID: scanID, Kind: KindMemoryUser, Priority: PriorityHigh, Title: "M",
			Preview: Preview{Type: "memory", Text: "Remember this once."}},
	})

	if err := mgr.Act(sugID, ActionAccept, nil); err != nil {
		t.Fatalf("overflow accept should queue pending compaction, got err: %v", err)
	}
	if mem.lastUserLine != "Remember this once." {
		t.Fatalf("expected first accept to write pending entry once, got %q", mem.lastUserLine)
	}

	states, err := store.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	if got := states[sugID].State; got != "pending_compaction" {
		t.Fatalf("state=%q, want pending_compaction", got)
	}
	if got := states[sugID].AppliedTo; got != "/fake/USER.md" {
		t.Fatalf("applied_to=%q, want pending path", got)
	}

	mem.lastUserLine = ""
	if err := mgr.Act(sugID, ActionAccept, nil); err != nil {
		t.Fatalf("second overflow accept should be idempotent, got err: %v", err)
	}
	if mem.lastUserLine != "" {
		t.Fatalf("second accept must not append duplicate pending entry, got %q", mem.lastUserLine)
	}
}

// countingMemWriter is a thread-safe MemoryWriter that counts how many times
// AppendUserMemory ran. Used to assert concurrent Accept calls don't double-write.
type countingMemWriter struct {
	calls atomic.Int32
}

func (w *countingMemWriter) AppendUserMemory(string) (string, bool, error) {
	w.calls.Add(1)
	return "/fake/USER.md", false, nil
}
func (w *countingMemWriter) AppendProjectMemory(string, string) (string, bool, error) {
	w.calls.Add(1)
	return "/fake/MEMORY.md", false, nil
}

// TestManager_ConcurrentAcceptIsSerializedAndIdempotent simulates a
// double-click (or two RPC clients hitting Accept at the same time). Before
// the acceptMu fix, both goroutines passed the state-read short-circuit,
// both invoked applyAccept, and both appended a state event — leaving the
// user with a duplicate memory line. The mutex serializes the check + apply
// + record-state window so the second call short-circuits cleanly.
func TestManager_ConcurrentAcceptIsSerializedAndIdempotent(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	mem := &countingMemWriter{}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, mem, &fakeSkillWriter{})

	scanID := "scan-race"
	sugID := scanID + ":mu-1"
	seedScan(t, store, scanID, []Suggestion{
		{ID: sugID, MinerID: "mu-1", ScanID: scanID, Kind: KindMemoryUser, Priority: PriorityHigh, Title: "M",
			Preview: Preview{Type: "memory", Text: "Race-test memory."}},
	})

	const goroutines = 16
	var wg sync.WaitGroup
	wg.Add(goroutines)
	errs := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			if err := mgr.Act(sugID, ActionAccept, nil); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent accept returned error: %v", err)
	}

	if got := mem.calls.Load(); got != 1 {
		t.Fatalf("AppendUserMemory called %d times under concurrent Accept; want exactly 1", got)
	}

	states, err := store.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	if got := states[sugID].State; got != "accepted" {
		t.Fatalf("state=%q, want accepted", got)
	}
}

// blockingDispatcher pauses inside CreateChat until release is closed, so
// the guard test can observe the in-flight state deterministically.
type blockingDispatcher struct {
	release chan struct{}
}

func (b *blockingDispatcher) CreateChat(ctx context.Context, _, _, _ string) (string, error) {
	select {
	case <-b.release:
	case <-ctx.Done():
	}
	return "chat", nil
}
func (b *blockingDispatcher) PostMessage(context.Context, string, string, string) error { return nil }
func (b *blockingDispatcher) WaitDone(context.Context, string, time.Duration) error     { return nil }
func (b *blockingDispatcher) AssistantText(context.Context, string) (string, error)     { return "", nil }
func (b *blockingDispatcher) BuildScanCorpus(_ context.Context, since, until time.Time, _ int) (ScanCorpus, error) {
	return ScanCorpus{WindowStart: since, WindowEnd: until}, nil
}
func (b *blockingDispatcher) Cancel(context.Context, string) error { return nil }

func TestManager_SetScheduleValidation(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scanner := NewScanner(store, &fakeDispatcher{}, &fakeResolver{agentID: "p"})
	mgr := NewManager(store, scanner, &fakeMemWriter{}, &fakeSkillWriter{})

	cases := []struct {
		name string
		s    Schedule
		ok   bool
	}{
		{"bad cadence", Schedule{Cadence: "yearly"}, false},
		{"weekly bad day", Schedule{Cadence: "weekly", Day: 9, Time: "03:00"}, false},
		{"monthly bad dom", Schedule{Cadence: "monthly", DOM: 31, Time: "03:00"}, false},
		{"bad threshold", Schedule{Cadence: "daily", Threshold: "ridiculous"}, false},
		{"valid weekly", Schedule{Cadence: "weekly", Day: 0, Time: "03:00", Threshold: "med"}, true},
		{"valid off", Schedule{Cadence: "off"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := mgr.SetSchedule(c.s)
			if c.ok && err != nil {
				t.Fatalf("want ok, got err: %v", err)
			}
			if !c.ok && err == nil {
				t.Fatalf("want validation error for %+v", c.s)
			}
		})
	}

	// After saving a valid schedule, defaults are filled in (TZ, threshold).
	saved, err := mgr.SetSchedule(Schedule{Cadence: "daily", Time: "07:00"})
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.TZ == "" {
		t.Fatalf("TZ default should be filled in")
	}
	if saved.Threshold == "" {
		t.Fatalf("Threshold default should be filled in")
	}
}
