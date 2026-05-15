import { BackendEvent, MessageAttachment } from "./types";

export type TimelineItem =
  | { kind: "message"; seq: number; author: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[]; time: string }
  | { kind: "thinking"; seq: number; author: string; content: string; time: string }
  | { kind: "tool"; seq: number; author: string; name: string; detail: string; time: string }
  | { kind: "tool_result"; seq: number; author: string; name: string; output: string; time: string }
  | { kind: "handover"; seq: number; author: string; label: string; note: string; time: string }
  | { kind: "error"; seq: number; author: string; message: string; time: string };

function eventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function mapBackendEvent(event: BackendEvent): TimelineItem | null {
  const time = eventTime(event.ts);
  if (event.type === "message") {
    return {
      kind: "message",
      seq: event.seq,
      author: event.actor_agent_id,
      role: event.message?.role || "assistant",
      content: event.message?.content || "",
      attachments: event.message?.attachments || [],
      time
    };
  }
  if (event.type === "thinking") {
    return {
      kind: "thinking",
      seq: event.seq,
      author: event.actor_agent_id,
      content: event.thinking?.content || "",
      time
    };
  }
  if (event.type === "tool_call") {
    const input = event.tool_call?.input;
    return {
      kind: "tool",
      seq: event.seq,
      author: event.actor_agent_id,
      name: event.tool_call?.name || "tool",
      detail: input ? JSON.stringify(input) : "",
      time
    };
  }
  if (event.type === "tool_call_result") {
    return {
      kind: "tool_result",
      seq: event.seq,
      author: event.actor_agent_id,
      name: event.tool_call_result?.name || "tool",
      output: event.tool_call_result?.output || "",
      time
    };
  }
  if (event.type === "handover") {
    return {
      kind: "handover",
      seq: event.seq,
      author: event.actor_agent_id,
      label: `${event.handover?.subtype || "handover"} · ${event.handover?.agent_name || event.handover?.agent_id || "agent"}`,
      note: event.handover?.note || "",
      time
    };
  }
  if (event.type === "error") {
    return {
      kind: "error",
      seq: event.seq,
      author: event.actor_agent_id,
      message: event.error?.message || "Unknown error",
      time
    };
  }
  return null;
}
