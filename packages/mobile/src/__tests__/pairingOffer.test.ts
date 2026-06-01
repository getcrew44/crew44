import { describe, expect, it } from "vitest";
import { PAIRING_TYPE, parsePairingOffer } from "../remote/pairingOffer";

const future = "2026-05-13T12:00:00.000Z";
const now = new Date("2026-05-13T11:00:00.000Z");

function offer(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    r: "wss://relay.example.com/relay",
    s: "srv_test",
    n: "Studio Mac",
    k: "abc123",
    p: "pair_test",
    x: "secret",
    e: future,
    ...overrides
  });
}

describe("parsePairingOffer", () => {
  it("accepts a valid Crew44 pairing offer", () => {
    expect(parsePairingOffer(offer(), now)).toMatchObject({
      type: PAIRING_TYPE,
      server_id: "srv_test",
      desktop_name: "Studio Mac"
    });
  });

  it("accepts a Crew44 pair link", () => {
    const encoded = encodeURIComponent(offer());
    expect(parsePairingOffer(`https://mobileapp.crew44.io/#secret=${encoded}`, now)).toMatchObject({
      relay_url: "wss://relay.example.com/relay",
      pairing_id: "pair_test"
    });
  });

  it("accepts unencoded pair links and scanner text with a URL prefix", () => {
    expect(parsePairingOffer(`https://mobileapp.crew44.io/#secret=${offer()}`, now)).toMatchObject({
      pairing_id: "pair_test"
    });
    expect(parsePairingOffer(`https://mobileapp.crew44.io/${offer()}`, now)).toMatchObject({
      pairing_id: "pair_test"
    });
  });

  it("rejects malformed JSON", () => {
    expect(() => parsePairingOffer("{", now)).toThrow("not valid JSON");
  });

  it("rejects expired offers", () => {
    expect(() => parsePairingOffer(offer({ e: "2026-05-13T10:59:00.000Z" }), now)).toThrow("expired");
  });

  it("rejects non-websocket relay URLs", () => {
    expect(() => parsePairingOffer(offer({ r: "https://relay.example.com" }), now)).toThrow("ws or wss");
  });
});
