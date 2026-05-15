package optimizer

import "time"

// SystemProjectID is the hidden project that owns auto-scan chats.
const SystemProjectID = "__optimizer__"

// Memory file caps. See design doc memory-file-design section.
const (
	UserMemoryCap    = 1500
	ProjectMemoryCap = 2500
)

// Suggestion kinds match the mock's KIND_META keys.
const (
	KindStrategy      = "strategy"
	KindSkill         = "skill"
	KindMemoryProject = "memory-project"
	KindMemoryUser    = "memory-user"
)

const (
	PriorityHigh = "high"
	PriorityMed  = "med"
	PriorityLow  = "low"
)

const (
	ActionAccept            = "accept"
	ActionEdit              = "edit"
	ActionSnooze            = "snooze"
	ActionDismiss           = "dismiss"
	ActionReset             = "reset"
	ActionPendingCompaction = "pending_compaction"
)

const (
	ScanStatusSuccess = "success"
	ScanStatusFailed  = "failed"
	ScanStatusRunning = "running"
)

type Evidence struct {
	Runs    []string `json:"runs"`
	Windows []string `json:"windows"`
}

// Preview holds the mock's plan/diff/skill/memory variants in one union struct.
// Fields populated depend on Type.
type Preview struct {
	Type    string   `json:"type"`               // "plan" | "diff" | "skill" | "memory"
	Lines   []string `json:"lines,omitempty"`    // plan, diff, skill
	Name    string   `json:"name,omitempty"`     // skill: target SKILL.md name
	Scope   string   `json:"scope,omitempty"`    // memory: display name ("Jordan" or "crew44")
	ScopeID string   `json:"scope_id,omitempty"` // memory-project: project UUID; memory-user: empty
	Text    string   `json:"text,omitempty"`     // memory: the bullet to append
}

type Suggestion struct {
	ID          string    `json:"id"`       // server-assigned: "<scan_id>:<miner_id>"
	MinerID     string    `json:"miner_id"` // model-emitted hint, debugging only
	Kind        string    `json:"kind"`
	Priority    string    `json:"priority"`
	Title       string    `json:"title"`
	Body        string    `json:"body"`
	Impact      string    `json:"impact"`
	Evidence    Evidence  `json:"evidence"`
	Preview     Preview   `json:"preview"`
	GeneratedAt time.Time `json:"generated_at"`
	ScanID      string    `json:"scan_id"`
}

type SuggestionState struct {
	SuggestionID  string    `json:"suggestion_id"`
	State         string    `json:"state"` // "pending" | "accepted" | "snoozed" | "dismissed" | "pending_compaction"
	EditedPreview *Preview  `json:"edited_preview,omitempty"`
	UpdatedAt     time.Time `json:"updated_at"`
	AppliedTo     string    `json:"applied_to,omitempty"` // file path the accept wrote
}

type Scan struct {
	ID           string       `json:"id"`
	StartedAt    time.Time    `json:"started_at"`
	FinishedAt   time.Time    `json:"finished_at,omitempty"`
	Status       string       `json:"status"`
	Error        string       `json:"error,omitempty"`
	RunsAnalyzed int          `json:"runs_analyzed"`
	Suggestions  []Suggestion `json:"suggestions"`
}

// ScanCorpus is the bounded, daemon-curated activity slice handed to Partner.
// It deliberately contains user project chat metadata and message snippets,
// not raw transcript bodies, tool outputs, or optimizer-internal chats.
type ScanCorpus struct {
	WindowStart  time.Time    `json:"window_start"`
	WindowEnd    time.Time    `json:"window_end"`
	RunsAnalyzed int          `json:"runs_analyzed"`
	Chats        []ChatDigest `json:"chats"`
}

type ChatDigest struct {
	ProjectID   string           `json:"project_id"`
	ProjectName string           `json:"project_name"`
	ChatID      string           `json:"chat_id"`
	Title       string           `json:"title"`
	CreatedAt   time.Time        `json:"created_at"`
	UpdatedAt   time.Time        `json:"updated_at"`
	Snippets    []MessageSnippet `json:"snippets"`
}

type MessageSnippet struct {
	TS   time.Time `json:"ts"`
	Role string    `json:"role"`
	Text string    `json:"text"`
}

// ScanEvent is the append-only feed AutoRoute reads to drive the failure banner.
type ScanEvent struct {
	ScanID string    `json:"scan_id"`
	Status string    `json:"status"` // success | failed | running
	Error  string    `json:"error,omitempty"`
	TS     time.Time `json:"ts"`
}

type Schedule struct {
	Cadence    string           `json:"cadence"` // "off" | "daily" | "weekly" | "monthly"
	Day        int              `json:"day"`     // 0=Sun..6=Sat
	DOM        int              `json:"dom"`     // 1..28
	Time       string           `json:"time"`    // "HH:MM"
	TZ         string           `json:"tz"`      // IANA name, default "Local"
	Surfaces   ScheduleSurfaces `json:"surfaces"`
	Threshold  string           `json:"threshold"` // "all" | "med" | "high"
	Notify     string           `json:"notify"`    // "silent" | "badge" | "email"
	LastScanAt time.Time        `json:"last_scan_at,omitempty"`
}

type ScheduleSurfaces struct {
	Skill    bool `json:"skill"`
	Memory   bool `json:"memory"`
	Strategy bool `json:"strategy"`
}

func DefaultSchedule() Schedule {
	return Schedule{
		Cadence:   "weekly",
		Day:       0,
		DOM:       1,
		Time:      "03:00",
		TZ:        "Local",
		Surfaces:  ScheduleSurfaces{Skill: true, Memory: true, Strategy: true},
		Threshold: "med",
		Notify:    "badge",
	}
}

// SuggestionList is the RPC reply shape for the AutoRoute list call.
type SuggestionList struct {
	Items          []SuggestionEntry `json:"items"`
	LastScanID     string            `json:"last_scan_id,omitempty"`
	LastScanAt     time.Time         `json:"last_scan_at,omitempty"`
	LastScanStatus string            `json:"last_scan_status,omitempty"`
	LastScanError  string            `json:"last_scan_error,omitempty"`
	RunsAnalyzed   int               `json:"runs_analyzed,omitempty"`
	Scanning       bool              `json:"scanning"`
}

// SuggestionEntry pairs a Suggestion with its current state for one-shot UI rendering.
type SuggestionEntry struct {
	Suggestion Suggestion       `json:"suggestion"`
	State      *SuggestionState `json:"state,omitempty"`
}
