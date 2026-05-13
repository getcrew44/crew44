import { describe, expect, it } from "vitest";
import { mapBackendEvent } from "../api/events";

describe("mapBackendEvent", () => {
  it("maps user messages", () => {
    expect(mapBackendEvent({
      seq: 1,
      type: "message",
      ts: "2026-05-13T11:00:00.000Z",
      actor_agent_id: "agent_1",
      message: { role: "user", content: "hello" }
    })).toMatchObject({ kind: "message", role: "user", content: "hello" });
  });

  it("maps handover events", () => {
    expect(mapBackendEvent({
      seq: 2,
      type: "handover",
      ts: "2026-05-13T11:00:00.000Z",
      actor_agent_id: "agent_1",
      handover: { subtype: "occurred", agent_id: "agent_2", agent_name: "Bex", note: "continue" }
    })).toMatchObject({ kind: "handover", label: "occurred · Bex", note: "continue" });
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
});
