import { describe, expect, it } from "vitest";
import { buildRenderableTimeline, mapBackendEvent, TimelineItem } from "../api/events";

describe("mapBackendEvent", () => {
  it("maps user messages", () => {
    expect(mapBackendEvent({
      seq: 1,
      type: "message",
      ts: "2026-05-13T11:00:00.000Z",
      actor_agent_id: "agent_1",
      message: { role: "user", content: "hello" }
    })).toMatchObject({ kind: "message", role: "user", body: "hello", author: "__human__" });
  });

  it("maps handover events", () => {
    expect(mapBackendEvent({
      seq: 2,
      type: "handover",
      ts: "2026-05-13T11:00:00.000Z",
      actor_agent_id: "agent_1",
      handover: { subtype: "occurred", agent_id: "agent_2", agent_name: "Bex", note: "continue" }
    })).toMatchObject({
      kind: "handover",
      subtype: "occurred",
      agent_id: "agent_1",
      target_agent_id: "agent_2",
      target_agent_name: "Bex",
      note: "continue"
    });
  });

  it("maps errors without throwing", () => {
    expect(mapBackendEvent({
      seq: 3,
      type: "error",
      ts: "bad-date",
      actor_agent_id: "agent_1",
      error: { code: "bad", message: "Something failed" }
    })).toMatchObject({ kind: "error", message: "Something failed", time: "" });
  });

  it("builds renderable handover dividers and folds thoughts into messages", () => {
    const events = [
      {
        kind: "thinking",
        seq: 1,
        _seq: 1,
        author: "agent_1",
        time: "11:00",
        tsISO: "",
        reasoning: "checking",
        seconds: 0
      },
      {
        kind: "message",
        seq: 2,
        _seq: 2,
        author: "agent_1",
        role: "assistant",
        body: "done",
        time: "11:01",
        tsISO: ""
      },
      {
        kind: "handover",
        seq: 3,
        _seq: 3,
        author: "agent_1",
        time: "11:02",
        tsISO: "",
        subtype: "delegate",
        agent_id: "agent_1",
        target_agent_id: "agent_2",
        target_agent_name: "Bex",
        note: "continue"
      }
    ] satisfies TimelineItem[];

    const rendered = buildRenderableTimeline(events);
    expect(rendered[0]).toMatchObject({ kind: "message", _thought: { reasoning: "checking" } });
    expect(rendered[1]).toMatchObject({ kind: "handover_divider", from: "agent_1", to: "agent_2" });
  });

  it("marks consecutive agent tool calls as header continuations", () => {
    const events = [
      {
        kind: "message",
        seq: 1,
        _seq: 1,
        author: "agent_1",
        role: "assistant",
        body: "I will inspect it.",
        time: "11:00",
        tsISO: ""
      },
      {
        kind: "tool",
        seq: 2,
        _seq: 2,
        author: "agent_1",
        tool: "exec_command",
        path: "ls",
        input: { command: "ls" },
        result: "ok",
        time: "11:00",
        tsISO: ""
      },
      {
        kind: "tool",
        seq: 3,
        _seq: 3,
        author: "agent_1",
        tool: "exec_command",
        path: "pwd",
        input: { command: "pwd" },
        result: "ok",
        time: "11:00",
        tsISO: ""
      }
    ] satisfies TimelineItem[];

    const rendered = buildRenderableTimeline(events);
    expect(rendered[0]).toMatchObject({ kind: "message", showHeader: true });
    expect(rendered[1]).toMatchObject({ kind: "tool_group", showHeader: false });
  });
});
