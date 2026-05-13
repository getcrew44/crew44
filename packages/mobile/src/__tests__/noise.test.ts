import { describe, expect, it } from "vitest";
import { base64RawDecode, base64RawEncode } from "../remote/bytes";
import { generateDHKeyPair, NoiseInitiator, publicKeyFromPrivate } from "../remote/noise";

function sequence(start: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => start + index);
}

describe("Noise client primitives", () => {
  it("derives stable X25519 public keys from private keys", () => {
    expect(base64RawEncode(publicKeyFromPrivate(sequence(1)))).toBe("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw");
  });

  it("emits deterministic NK first message bytes", () => {
    const remoteStatic = publicKeyFromPrivate(sequence(33));
    const initiator = new NoiseInitiator("NK", remoteStatic, {
      randomBytes() {
        return sequence(1);
      }
    });
    expect(base64RawEncode(initiator.writeMessageA())).toBe("B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHySZ17HkuNCoJta7RZFzycD");
  });

  it("generates keypairs from an injected random source", () => {
    const key = generateDHKeyPair({
      randomBytes(length) {
        return Uint8Array.from({ length }, (_, index) => 255 - index);
      }
    });
    expect(key.privateKey).toHaveLength(32);
    expect(base64RawDecode(base64RawEncode(key.publicKey))).toHaveLength(32);
  });
});
