import { describe, expect, it } from "vitest";
import { PAIRING_TYPE, parsePairingOffer } from "../remote/pairingOffer";

const future = "2026-05-13T12:00:00.000Z";
const now = new Date("2026-05-13T11:00:00.000Z");

function offer(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    type: PAIRING_TYPE,
    relay_url: "wss://relay.example.com/relay",
    server_id: "srv_test",
    daemon_pubkey: "abc123",
    pairing_id: "pair_test",
    pairing_secret: "secret",
    expires_at: future,
    ...overrides
  });
}

describe("parsePairingOffer", () => {
  it("accepts a valid CrewAI pairing offer", () => {
    expect(parsePairingOffer(offer(), now)).toMatchObject({
      type: PAIRING_TYPE,
      server_id: "srv_test"
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parsePairingOffer("{", now)).toThrow("not valid JSON");
  });

  it("rejects wrong QR types", () => {
    expect(() => parsePairingOffer(offer({ type: "other" }), now)).toThrow("not a CrewAI");
  });

  it("rejects expired offers", () => {
    expect(() => parsePairingOffer(offer({ expires_at: "2026-05-13T10:59:00.000Z" }), now)).toThrow("expired");
  });

  it("rejects non-websocket relay URLs", () => {
    expect(() => parsePairingOffer(offer({ relay_url: "https://relay.example.com" }), now)).toThrow("ws or wss");
  });
});
