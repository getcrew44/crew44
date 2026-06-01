import { describe, expect, it } from "vitest";
import { parsePairingOffer } from "@/remote/pairingOffer";

const future = "2026-05-13T12:00:00.000Z";
const now = new Date("2026-05-13T11:00:00.000Z");

function secret() {
  return JSON.stringify({
    v: 1,
    r: "wss://relay.example.com/relay",
    s: "srv_test",
    n: "Studio Mac",
    k: "abc123",
    p: "pair_test",
    x: "secret",
    e: future
  });
}

describe("parsePairingOffer", () => {
  it("accepts the compact pair URL format", () => {
    const offer = parsePairingOffer(`https://mobileapp.crew44.io/#secret=${encodeURIComponent(secret())}`, now);

    expect(offer).toMatchObject({
      relay_url: "wss://relay.example.com/relay",
      server_id: "srv_test",
      pairing_id: "pair_test"
    });
  });

  it("accepts unencoded pair URLs and scanner text with a URL prefix", () => {
    expect(parsePairingOffer(`https://mobileapp.crew44.io/#secret=${secret()}`, now)).toMatchObject({
      pairing_id: "pair_test"
    });
    expect(parsePairingOffer(`https://mobileapp.crew44.io/${secret()}`, now)).toMatchObject({
      pairing_id: "pair_test"
    });
  });
});
