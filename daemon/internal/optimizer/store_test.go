package optimizer

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStore_AppendRehydrate(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	must(t, s.AppendStateEvent(StateEvent{TS: now, SuggestionID: "scan-1:k-1", Action: "new"}))
	must(t, s.AppendStateEvent(StateEvent{TS: now, SuggestionID: "scan-1:k-1", Action: ActionAccept, AppliedTo: "/foo/SKILL.md"}))

	states, err := s.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	got := states["scan-1:k-1"]
	if got.State != "accepted" {
		t.Fatalf("want accepted, got %q", got.State)
	}
	if got.AppliedTo != "/foo/SKILL.md" {
		t.Fatalf("want applied path, got %q", got.AppliedTo)
	}

	// Simulate torn state.json — delete it and reload.
	must(t, os.Remove(filepath.Join(dir, "optimizer", "state.json")))
	s2, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	states2, err := s2.ListStates()
	if err != nil {
		t.Fatal(err)
	}
	if states2["scan-1:k-1"].State != "accepted" {
		t.Fatalf("rehydrate failed: got %+v", states2)
	}
}

func TestStore_ScheduleDefault(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	sched, err := s.LoadSchedule()
	if err != nil {
		t.Fatal(err)
	}
	if sched.Cadence != "weekly" || sched.Time != "03:00" {
		t.Fatalf("unexpected default: %+v", sched)
	}
	if !sched.Surfaces.Skill || !sched.Surfaces.Memory || !sched.Surfaces.Strategy {
		t.Fatalf("default surfaces should be all on, got %+v", sched.Surfaces)
	}
}

func TestStore_AtomicRename(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	must(t, s.SaveSchedule(Schedule{Cadence: "daily", Time: "07:00", TZ: "Local"}))
	// .tmp should never linger after a successful save.
	if _, err := os.Stat(s.schedulePath() + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("expected no .tmp file, got %v", err)
	}
	sched, err := s.LoadSchedule()
	if err != nil {
		t.Fatal(err)
	}
	if sched.Cadence != "daily" {
		t.Fatalf("want daily, got %q", sched.Cadence)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
