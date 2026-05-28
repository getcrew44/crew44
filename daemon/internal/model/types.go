package model

import "time"

type RuntimeStatus string

const (
	RuntimeStatusAvailable RuntimeStatus = "available"
	RuntimeStatusMissing   RuntimeStatus = "missing"
)

type RuntimeRecord struct {
	ID         string         `json:"id"`
	Provider   string         `json:"provider"`
	Name       string         `json:"name"`
	Status     RuntimeStatus  `json:"status"`
	BinaryPath string         `json:"binary_path"`
	Version    string         `json:"version"`
	DetectedAt time.Time      `json:"detected_at"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

type AgentConfig struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Instruction string       `json:"instruction"`
	RuntimeID   string       `json:"runtime_id"`
	Model       string       `json:"model"`
	SkillIDs    []string     `json:"skill_ids"`
	PresetID    string       `json:"preset_id,omitempty"`
	PresetKey   string       `json:"preset_key,omitempty"`
	Source      *AgentSource `json:"source,omitempty"`
	ArchivedAt  time.Time    `json:"archived_at,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// AgentSource identifies the upstream registry entry a recruited agent
// was installed from. Idempotency key for re-install is RepoURL.
type AgentSource struct {
	RegistryID  string    `json:"registry_id,omitempty"`
	RepoURL     string    `json:"repo_url"`
	Version     string    `json:"version"`
	InstalledAt time.Time `json:"installed_at"`
}

type SkillRecord struct {
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Path       string       `json:"path"`
	PresetID   string       `json:"preset_id,omitempty"`
	PresetKey  string       `json:"preset_key,omitempty"`
	Source     *SkillSource `json:"source,omitempty"`
	UpdatedAt  time.Time    `json:"updated_at"`
	ArchivedAt time.Time    `json:"archived_at,omitempty"`
}

// SkillSource identifies the recruited agent repo and in-repo path a
// recruited skill came from. Dedupe key on install is (RepoURL, Path).
type SkillSource struct {
	RepoURL string `json:"repo_url"`
	Path    string `json:"path"`
	Version string `json:"version"`
}

// PresetMapping records the user copies created from a preset definition.
// Version is informational; no automatic migration.
type PresetMapping struct {
	PresetID string            `json:"preset_id"`
	Version  int               `json:"version"`
	SeededAt time.Time         `json:"seeded_at"`
	AgentIDs map[string]string `json:"agent_ids"`
	SkillIDs map[string]string `json:"skill_ids"`
}

type SkillFile struct {
	ID        string    `json:"id"`
	Content   string    `json:"content"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ProjectIndexEntry struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Workdir    string    `json:"workdir"`
	ArchivedAt time.Time `json:"archived_at,omitempty"`
}

type ProjectRecord struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Workdir      string    `json:"workdir"`
	MainAgentID  string    `json:"main_agent_id"`
	SystemHidden bool      `json:"system_hidden,omitempty"`
	// UseWorktreeDefault is the default state of the New Task worktree toggle
	// for chats created under this project. Ignored for non-git workdirs.
	UseWorktreeDefault bool      `json:"use_worktree_default,omitempty"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	ArchivedAt         time.Time `json:"archived_at,omitempty"`
}

// WorktreeBinding records the git worktree a chat is pinned to. Path is the
// worktree checkout root (the repo toplevel inside the worktree); Workdir is
// the actual cwd, which equals Path plus the project workdir's repo-relative
// subdirectory. Branch starts as crew/<chatID8> and is renamed to a
// title-derived slug once the chat earns a meaningful title.
type WorktreeBinding struct {
	Path      string    `json:"path"`
	Workdir   string    `json:"workdir"`
	Branch    string    `json:"branch"`
	BaseRef   string    `json:"base_ref"`
	BaseSHA   string    `json:"base_sha"`
	CreatedAt time.Time `json:"created_at"`
}

type LastRuntimeSession struct {
	AgentID   string    `json:"agent_id"`
	SessionID string    `json:"session_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatStreamState struct {
	Status          string              `json:"status"`
	AgentID         string              `json:"agent_id,omitempty"`
	StartedAt       time.Time           `json:"started_at,omitempty"`
	CancelRequested bool                `json:"cancel_requested"`
	LastError       string              `json:"last_error,omitempty"`
	PendingSteers   []PendingSteerState `json:"pending_steers,omitempty"`
}

type PendingSteerState struct {
	ID          string              `json:"id"`
	Content     string              `json:"content"`
	Attachments []MessageAttachment `json:"attachments,omitempty"`
	QueuedAt    time.Time           `json:"queued_at"`
}

type ChatRecord struct {
	ID                     string             `json:"id"`
	ProjectID              string             `json:"project_id"`
	Title                  string             `json:"title"`
	// TitleSetByUser is true when the user explicitly renamed this chat.
	// Locks the title against automatic summarization so a manual rename
	// always wins over the LLM-derived title.
	TitleSetByUser         bool               `json:"title_set_by_user,omitempty"`
	MainAgentID            string             `json:"main_agent_id"`
	CurrentAgentID         string             `json:"current_agent_id"`
	PendingHandoverAgentID string             `json:"pending_handover_agent_id,omitempty"`
	ParticipantAgentIDs    []string           `json:"participant_agent_ids"`
	Status                 string             `json:"status"`
	ActiveTurnID           string             `json:"active_turn_id,omitempty"`
	LastRuntimeSession     LastRuntimeSession `json:"last_runtime_session"`
	Stream                 ChatStreamState    `json:"stream"`
	// Worktree is set when the chat runs in an isolated git worktree. Nil
	// chats (legacy or worktree-disabled) fall back to ProjectRecord.Workdir.
	Worktree               *WorktreeBinding   `json:"worktree,omitempty"`
	CreatedAt              time.Time          `json:"created_at"`
	UpdatedAt              time.Time          `json:"updated_at"`
	ArchivedAt             time.Time          `json:"archived_at,omitempty"`
}

type EventType string

const (
	EventTypeMessage        EventType = "message"
	EventTypeThinking       EventType = "thinking"
	EventTypeToolCall       EventType = "tool_call"
	EventTypeToolCallResult EventType = "tool_call_result"
	EventTypeRuntimeSession EventType = "runtime_session"
	EventTypeHandover       EventType = "handover"
	EventTypeError          EventType = "error"
)

type MessageRole string

const (
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
)

type Event struct {
	Seq            int64                  `json:"seq"`
	Type           EventType              `json:"type"`
	TS             time.Time              `json:"ts"`
	TurnID         string                 `json:"turn_id"`
	ActorAgentID   string                 `json:"actor_agent_id"`
	ActorAgentName string                 `json:"actor_agent_name,omitempty"`
	Message        *MessagePayload        `json:"message,omitempty"`
	Thinking       *ThinkingPayload       `json:"thinking,omitempty"`
	ToolCall       *ToolCallPayload       `json:"tool_call,omitempty"`
	ToolCallResult *ToolCallResultPayload `json:"tool_call_result,omitempty"`
	RuntimeSession *RuntimeSessionPayload `json:"runtime_session,omitempty"`
	Handover       *HandoverPayload       `json:"handover,omitempty"`
	Error          *ErrorPayload          `json:"error,omitempty"`
}

type MessagePayload struct {
	Role         MessageRole         `json:"role"`
	Content      string              `json:"content"`
	Attachments  []MessageAttachment `json:"attachments,omitempty"`
	UserSteer    bool                `json:"user_steer,omitempty"`
	SteerAgentID string              `json:"steer_agent_id,omitempty"`
	Interrupted  bool                `json:"interrupted,omitempty"`
}

type MessageAttachment struct {
	DisplayName      string `json:"display_name"`
	Path             string `json:"path"`
	Kind             string `json:"kind"`
	ThumbnailJPEGB64 string `json:"thumbnail_jpeg_base64,omitempty"`
	ThumbnailFailed  bool   `json:"thumbnail_failed,omitempty"`
}

type ThinkingPayload struct {
	Content string `json:"content"`
}

type ToolCallPayload struct {
	CallID  string         `json:"call_id,omitempty"`
	Name    string         `json:"name"`
	Input   map[string]any `json:"input,omitempty"`
	Compact bool           `json:"compact,omitempty"`
}

type ToolCallResultPayload struct {
	CallID      string `json:"call_id,omitempty"`
	ToolCallSeq int64  `json:"tool_call_seq,omitempty"`
	Name        string `json:"name"`
	Output      string `json:"output,omitempty"`
	Compact     bool   `json:"compact,omitempty"`
}

type RuntimeSessionPayload struct {
	RuntimeID string `json:"runtime_id,omitempty"`
	Provider  string `json:"provider,omitempty"`
	SessionID string `json:"session_id"`
	Status    string `json:"status,omitempty"`
}

type HandoverPayload struct {
	Subtype   string `json:"subtype"`
	AgentID   string `json:"agent_id"`
	AgentName string `json:"agent_name"`
	Note      string `json:"note,omitempty"`
}

type ErrorPayload struct {
	Subtype         string `json:"subtype"`
	Code            string `json:"code"`
	Message         string `json:"message"`
	AgentID         string `json:"agent_id,omitempty"`
	AgentName       string `json:"agent_name,omitempty"`
	TargetAgentID   string `json:"target_agent_id,omitempty"`
	TargetAgentName string `json:"target_agent_name,omitempty"`
}
