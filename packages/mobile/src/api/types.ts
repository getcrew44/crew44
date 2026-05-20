export interface Project {
  id: string;
  name: string;
  workdir: string;
  main_agent_id?: string;
  updated_at?: string;
}

export interface Agent {
  id: string;
  name: string;
  instruction: string;
  runtime_id: string;
  model: string;
  skill_ids: string[];
}

export interface ChatIndexEntry {
  chat_id?: string;
  id?: string;
  title: string;
  status: string;
  current_agent_id: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  project_id: string;
  title: string;
  main_agent_id: string;
  current_agent_id: string;
  participant_agent_ids: string[];
  status: string;
  stream?: {
    status?: string;
    pending_steers?: Array<{
      id: string;
      content: string;
      attachments?: MessageAttachment[];
      queued_at: string;
    }>;
  };
}

export interface BackendEvent {
  seq: number;
  type: "message" | "thinking" | "tool_call" | "tool_call_result" | "runtime_session" | "handover" | "error";
  ts: string;
  actor_agent_id: string;
  message?: {
    role: "user" | "assistant";
    content: string;
    attachments?: MessageAttachment[];
    user_steer?: boolean;
    steer_agent_id?: string;
    interrupted?: boolean;
  };
  thinking?: {
    content: string;
  };
  tool_call?: {
    call_id?: string;
    name: string;
    input?: Record<string, unknown>;
    compact?: boolean;
  };
  tool_call_result?: {
    call_id?: string;
    tool_call_seq?: number;
    name: string;
    output?: string;
    compact?: boolean;
  };
  handover?: {
    subtype: string;
    agent_id: string;
    agent_name: string;
    note?: string;
  };
  error?: {
    subtype?: string;
    code: string;
    message: string;
    agent_id?: string;
    agent_name?: string;
    target_agent_id?: string;
    target_agent_name?: string;
  };
}

export interface ToolDetails {
  tool_call: BackendEvent;
  tool_result?: BackendEvent | null;
}

export interface MessageAttachment {
  display_name: string;
  path: string;
  kind: "file" | "image" | "folder";
  thumbnail_jpeg_base64?: string;
  thumbnail_failed?: boolean;
}
