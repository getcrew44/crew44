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
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Instruction string    `json:"instruction"`
	RuntimeID   string    `json:"runtime_id"`
	Model       string    `json:"model"`
	SkillIDs    []string  `json:"skill_ids"`
	PresetID    string    `json:"preset_id,omitempty"`
	PresetKey   string    `json:"preset_key,omitempty"`
	ArchivedAt  time.Time `json:"archived_at,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type SkillRecord struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	PresetID   string    `json:"preset_id,omitempty"`
	PresetKey  string    `json:"preset_key,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
	ArchivedAt time.Time `json:"archived_at,omitempty"`
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
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	ArchivedAt   time.Time `json:"archived_at,omitempty"`
}

type ChatIndexEntry struct {
	ChatID         string    `json:"chat_id"`
	Title          string    `json:"title"`
	Status         string    `json:"status"`
	CurrentAgentID string    `json:"current_agent_id"`
	UpdatedAt      time.Time `json:"updated_at"`
	ArchivedAt     time.Time `json:"archived_at,omitempty"`
}

type LastRuntimeSession struct {
	AgentID   string    `json:"agent_id"`
	SessionID string    `json:"session_id"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ChatStreamState struct {
	Status          string    `json:"status"`
	AgentID         string    `json:"agent_id,omitempty"`
	StartedAt       time.Time `json:"started_at,omitempty"`
	CancelRequested bool      `json:"cancel_requested"`
	LastError       string    `json:"last_error,omitempty"`
}

type ChatRecord struct {
	ID                     string             `json:"id"`
	ProjectID              string             `json:"project_id"`
	Title                  string             `json:"title"`
	MainAgentID            string             `json:"main_agent_id"`
	CurrentAgentID         string             `json:"current_agent_id"`
	PendingHandoverAgentID string             `json:"pending_handover_agent_id,omitempty"`
	ParticipantAgentIDs    []string           `json:"participant_agent_ids"`
	Status                 string             `json:"status"`
	ActiveTurnID           string             `json:"active_turn_id,omitempty"`
	LastRuntimeSession     LastRuntimeSession `json:"last_runtime_session"`
	Stream                 ChatStreamState    `json:"stream"`
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
	Message        *MessagePayload        `json:"message,omitempty"`
	Thinking       *ThinkingPayload       `json:"thinking,omitempty"`
	ToolCall       *ToolCallPayload       `json:"tool_call,omitempty"`
	ToolCallResult *ToolCallResultPayload `json:"tool_call_result,omitempty"`
	RuntimeSession *RuntimeSessionPayload `json:"runtime_session,omitempty"`
	Handover       *HandoverPayload       `json:"handover,omitempty"`
	Error          *ErrorPayload          `json:"error,omitempty"`
}

type MessagePayload struct {
	Role        MessageRole         `json:"role"`
	Content     string              `json:"content"`
	Attachments []MessageAttachment `json:"attachments,omitempty"`
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
	Name  string         `json:"name"`
	Input map[string]any `json:"input,omitempty"`
}

type ToolCallResultPayload struct {
	Name   string `json:"name"`
	Output string `json:"output"`
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
