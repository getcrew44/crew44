import { BackendEvent, MessageAttachment } from "./types";

export type TimelineItem =
  | MessageItem
  | ThinkingItem
  | ToolItem
  | ToolResultItem
  | ToolGroupItem
  | HandoverItem
  | RuntimeSessionItem
  | ErrorItem;

export interface BaseTimelineItem {
  seq: number;
  _seq: number;
  author: string;
  time: string;
  tsISO: string;
}

export interface MessageItem extends BaseTimelineItem {
  kind: "message";
  role: "user" | "assistant";
  body: string;
  attachments?: MessageAttachment[];
  userSteer?: boolean;
  steerAgentId?: string;
  interrupted?: boolean;
  _thought?: ThinkingItem;
}

export interface ThinkingItem extends BaseTimelineItem {
  kind: "thinking";
  reasoning: string;
  seconds: number;
}

export interface ToolItem extends BaseTimelineItem {
  kind: "tool";
  tool: string;
  path: string;
  input: Record<string, unknown> | null;
  result: "pending" | "ok" | "error";
  detail?: string;
  output?: string;
}

export interface ToolResultItem extends BaseTimelineItem {
  kind: "tool_result";
  name: string;
  output: string;
}

export interface ToolGroupItem extends BaseTimelineItem {
  kind: "tool_group";
  events: ToolItem[];
}

export interface HandoverItem extends BaseTimelineItem {
  kind: "handover";
  subtype: string;
  agent_id: string;
  target_agent_id: string;
  target_agent_name: string;
  note: string;
}

export interface RuntimeSessionItem extends BaseTimelineItem {
  kind: "runtime_session";
}

export interface ErrorItem extends BaseTimelineItem {
  kind: "error";
  subtype: string;
  code: string;
  message: string;
  agent_id: string;
  agent_name: string;
  target_agent_id: string;
  target_agent_name: string;
}

export interface HandoverDividerItem {
  kind: "handover_divider";
  seq: number;
  _seq: number;
  from: string;
  to: string;
  subtype?: string;
  note?: string;
  synthetic?: boolean;
}

export type RenderableTimelineItem = TimelineItem | HandoverDividerItem;

function eventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function summarizeToolInput(input: Record<string, unknown> | null | undefined): string {
  if (input == null) return "";
  const preferred = ["command", "cmd", "path", "file_path", "file", "args", "query", "prompt", "pattern", "url"];
  for (const key of preferred) {
    const value = input[key];
    if (typeof value === "string" && value) return value;
  }
  const values = Object.values(input).filter((value): value is string => typeof value === "string" && Boolean(value));
  if (values.length) return values.join(" ");
  return JSON.stringify(input);
}

export function mapBackendEvent(event: BackendEvent): TimelineItem | null {
  const time = eventTime(event.ts);
  const tsISO = event.ts || "";
  const seq = event.seq;
  if (event.type === "message") {
    const role = event.message?.role || "assistant";
    const attachments = event.message?.attachments || [];
    return {
      kind: "message",
      seq,
      _seq: seq,
      author: role === "user" ? "__human__" : event.actor_agent_id,
      role,
      body: event.message?.content || "",
      attachments: attachments.length ? attachments : undefined,
      userSteer: Boolean(event.message?.user_steer),
      steerAgentId: event.message?.steer_agent_id,
      interrupted: Boolean(event.message?.interrupted),
      time,
      tsISO
    };
  }
  if (event.type === "thinking") {
    return {
      kind: "thinking",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      reasoning: event.thinking?.content || "",
      seconds: 0,
      time,
      tsISO
    };
  }
  if (event.type === "tool_call") {
    const input = event.tool_call?.input || null;
    return {
      kind: "tool",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      tool: event.tool_call?.name || "tool",
      path: summarizeToolInput(input),
      input,
      result: "pending",
      time,
      tsISO
    };
  }
  if (event.type === "tool_call_result") {
    return {
      kind: "tool_result",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      name: event.tool_call_result?.name || "",
      output: event.tool_call_result?.output || "",
      time,
      tsISO
    };
  }
  if (event.type === "runtime_session") {
    return {
      kind: "runtime_session",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      time,
      tsISO
    };
  }
  if (event.type === "handover") {
    return {
      kind: "handover",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      subtype: event.handover?.subtype || "delegate",
      agent_id: event.actor_agent_id,
      target_agent_id: event.handover?.agent_id || "",
      target_agent_name: event.handover?.agent_name || "",
      note: event.handover?.note || "",
      time,
      tsISO
    };
  }
  if (event.type === "error") {
    return {
      kind: "error",
      seq,
      _seq: seq,
      author: event.actor_agent_id,
      subtype: event.error?.subtype || "error",
      code: event.error?.code || "",
      message: event.error?.message || "",
      agent_id: event.error?.agent_id || event.actor_agent_id || "",
      agent_name: event.error?.agent_name || "",
      target_agent_id: event.error?.target_agent_id || "",
      target_agent_name: event.error?.target_agent_name || "",
      time,
      tsISO
    };
  }
  return null;
}

function mergeToolResults(events: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const event of events) {
    if (event.kind !== "tool_result") {
      out.push(event);
      continue;
    }
    let merged = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i];
      if (prev.kind === "tool" && prev.tool === event.name && prev.result === "pending") {
        out[i] = {
          ...prev,
          result: "ok",
          detail: event.output.slice(0, 120),
          output: event.output
        };
        merged = true;
        break;
      }
    }
    if (!merged) out.push(event);
  }
  return out;
}

function prepareEvents(events: TimelineItem[]): TimelineItem[] {
  const visible = mergeToolResults(events).filter(event => event.kind !== "runtime_session");
  const out: TimelineItem[] = [];
  for (let i = 0; i < visible.length; i++) {
    const event = visible[i];
    if (event.kind === "thinking") {
      const next = visible[i + 1];
      if (next?.kind === "message" && next.author === event.author) {
        out.push({ ...next, _thought: event });
        i += 1;
        continue;
      }
    }
    out.push(event);
  }
  return out;
}

function groupConsecutiveTools(events: TimelineItem[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const event of events) {
    if (event.kind === "tool") {
      const last = out[out.length - 1];
      if (last?.kind === "tool_group" && last.author === event.author) {
        last.events.push(event);
        continue;
      }
      out.push({
        kind: "tool_group",
        seq: event.seq,
        _seq: event._seq,
        author: event.author,
        time: event.time,
        tsISO: event.tsISO,
        events: [event]
      });
      continue;
    }
    out.push(event);
  }
  return out.map(event => (event.kind === "tool_group" && event.events.length === 1 ? event.events[0] : event));
}

export function buildRenderableTimeline(events: TimelineItem[]): RenderableTimelineItem[] {
  const prepared = groupConsecutiveTools(prepareEvents(events));
  const out: RenderableTimelineItem[] = [];
  let prevAgentActor = "";
  const isAgentActor = (id: string) => id && id !== "__human__";

  prepared.forEach((event, index) => {
    if (event.kind === "handover") {
      const from = event.agent_id || event.author;
      const to = event.target_agent_id;
      if (from && to && from !== to) {
        out.push({
          kind: "handover_divider",
          seq: event.seq,
          _seq: event._seq,
          from,
          to,
          subtype: event.subtype,
          note: event.note
        });
        prevAgentActor = to;
      } else if (from && to && from === to) {
        prevAgentActor = to;
      }
      return;
    }

    if (isAgentActor(event.author) && prevAgentActor && event.author !== prevAgentActor) {
      out.push({
        kind: "handover_divider",
        seq: event.seq,
        _seq: event._seq - 0.1,
        from: prevAgentActor,
        to: event.author,
        synthetic: true
      });
    }

    out.push(event);
    if (isAgentActor(event.author)) prevAgentActor = event.author;
    if (!isAgentActor(event.author)) prevAgentActor = prevAgentActor || "";
    if (index === prepared.length - 1) return;
  });
  return out;
}
