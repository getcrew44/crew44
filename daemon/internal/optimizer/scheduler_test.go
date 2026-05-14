package optimizer

import (
	"testing"
	"time"
)

func TestShouldFire(t *testing.T) {
	mk := func(year, month, day, hour, min int) time.Time {
		return time.Date(year, time.Month(month), day, hour, min, 0, 0, time.UTC)
	}

	cases := []struct {
		name string
		s    Schedule
		now  time.Time
		want bool
	}{
		{
			name: "off never fires",
			s:    Schedule{Cadence: "off", Time: "03:00"},
			now:  mk(2026, 5, 13, 3, 0),
			want: false,
		},
		{
			name: "daily at HH:MM",
			s:    Schedule{Cadence: "daily", Time: "03:00"},
			now:  mk(2026, 5, 13, 3, 0),
			want: true,
		},
		{
			name: "daily wrong minute",
			s:    Schedule{Cadence: "daily", Time: "03:00"},
			now:  mk(2026, 5, 13, 3, 1),
			want: false,
		},
		{
			name: "weekly Sunday matches",
			s:    Schedule{Cadence: "weekly", Time: "03:00", Day: 0},
			now:  mk(2026, 5, 17, 3, 0), // 2026-05-17 is a Sunday
			want: true,
		},
		{
			name: "weekly wrong day",
			s:    Schedule{Cadence: "weekly", Time: "03:00", Day: 0},
			now:  mk(2026, 5, 13, 3, 0), // Wednesday
			want: false,
		},
		{
			name: "monthly day of month matches",
			s:    Schedule{Cadence: "monthly", Time: "03:00", DOM: 13},
			now:  mk(2026, 5, 13, 3, 0),
			want: true,
		},
		{
			name: "monthly wrong day",
			s:    Schedule{Cadence: "monthly", Time: "03:00", DOM: 14},
			now:  mk(2026, 5, 13, 3, 0),
			want: false,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := shouldFire(c.s, c.now); got != c.want {
				t.Fatalf("shouldFire(%+v, %v) = %v, want %v", c.s, c.now, got, c.want)
			}
		})
	}
}

func TestParseHHMM(t *testing.T) {
	cases := []struct {
		in   string
		h, m int
		ok   bool
	}{
		{"03:00", 3, 0, true},
		{"23:59", 23, 59, true},
		{"00:00", 0, 0, true},
		{"24:00", 0, 0, false},
		{"3:00", 3, 0, true},
		{"03:60", 0, 0, false},
		{"abc", 0, 0, false},
		{"", 0, 0, false},
	}
	for _, c := range cases {
		h, m, ok := parseHHMM(c.in)
		if ok != c.ok || (ok && (h != c.h || m != c.m)) {
			t.Fatalf("parseHHMM(%q) = %d, %d, %v; want %d, %d, %v", c.in, h, m, ok, c.h, c.m, c.ok)
		}
	}
}
