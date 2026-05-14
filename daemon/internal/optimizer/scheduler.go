package optimizer

import (
	"context"
	"time"
)

// MinScanInterval is the floor between consecutive scheduled scans.
// Manual "Scan now" bypasses this guard.
const MinScanInterval = 1 * time.Hour

// Clock is the time injection seam for tests. Production uses realClock.
type Clock interface {
	Now() time.Time
	LoadLocation(name string) (*time.Location, error)
}

type realClock struct{}

func (realClock) Now() time.Time                                  { return time.Now() }
func (realClock) LoadLocation(name string) (*time.Location, error) { return time.LoadLocation(name) }

// Scheduler ticks every minute and fires a scan whenever the configured
// cadence falls due. cadence:"off" short-circuits to a sleep loop.
type Scheduler struct {
	manager *Manager
	clock   Clock
	tick    time.Duration
	refresh chan struct{}
	stop    chan struct{}
}

func NewScheduler(m *Manager) *Scheduler {
	return &Scheduler{
		manager: m,
		clock:   realClock{},
		tick:    time.Minute,
		refresh: make(chan struct{}, 1),
		stop:    make(chan struct{}),
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	go s.run(ctx)
}

func (s *Scheduler) Stop() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
}

// Refresh prompts the scheduler to re-read its schedule on the next tick.
// Called by Manager.SetSchedule so cadence changes take effect immediately.
func (s *Scheduler) Refresh() {
	select {
	case s.refresh <- struct{}{}:
	default:
	}
}

func (s *Scheduler) run(ctx context.Context) {
	ticker := time.NewTicker(s.tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stop:
			return
		case <-s.refresh:
			s.evaluate(ctx)
		case <-ticker.C:
			s.evaluate(ctx)
		}
	}
}

func (s *Scheduler) evaluate(ctx context.Context) {
	sched, err := s.manager.GetSchedule()
	if err != nil || sched.Cadence == "off" {
		return
	}
	if s.manager.guard.busy() {
		return
	}
	now := s.clock.Now()
	if !sched.LastScanAt.IsZero() && now.Sub(sched.LastScanAt) < MinScanInterval {
		return
	}
	loc, err := s.clock.LoadLocation(sched.TZ)
	if err != nil {
		loc = time.Local
	}
	if !shouldFire(sched, now.In(loc)) {
		return
	}
	_, _, _ = s.manager.StartScan(ctx)
}

// shouldFire encodes the four cadences against a localized clock.
func shouldFire(sched Schedule, nowLocal time.Time) bool {
	h, m, ok := parseHHMM(sched.Time)
	if !ok {
		return false
	}
	// Match the minute-level scheduling: fire if we're in the same minute as the configured time.
	if nowLocal.Hour() != h || nowLocal.Minute() != m {
		return false
	}
	switch sched.Cadence {
	case "daily":
		return true
	case "weekly":
		return int(nowLocal.Weekday()) == sched.Day
	case "monthly":
		return nowLocal.Day() == sched.DOM
	}
	return false
}

func parseHHMM(s string) (int, int, bool) {
	if len(s) < 4 || len(s) > 5 {
		return 0, 0, false
	}
	var h, m int
	parts := splitTime(s)
	if len(parts) != 2 {
		return 0, 0, false
	}
	if _, ok := atoi(parts[0], &h); !ok {
		return 0, 0, false
	}
	if _, ok := atoi(parts[1], &m); !ok {
		return 0, 0, false
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

func splitTime(s string) []string {
	for i := 0; i < len(s); i++ {
		if s[i] == ':' {
			return []string{s[:i], s[i+1:]}
		}
	}
	return nil
}

func atoi(s string, out *int) (int, bool) {
	v := 0
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, false
		}
		v = v*10 + int(c-'0')
	}
	*out = v
	return v, true
}
