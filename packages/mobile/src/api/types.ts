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
  };
  thinking?: {
    content: string;
  };
  tool_call?: {
    name: string;
    input?: Record<string, unknown>;
  };
  tool_call_result?: {
    name: string;
    output: string;
  };
  handover?: {
    subtype: string;
    agent_id: string;
    agent_name: string;
    note?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface MessageAttachment {
  display_name: string;
  path: string;
  kind: "file" | "image" | "folder";
  thumbnail_jpeg_base64?: string;
  thumbnail_failed?: boolean;
}
