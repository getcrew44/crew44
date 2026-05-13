import { describe, expect, it } from "vitest";
import { base64RawDecode, base64RawEncode, equalBytes } from "../remote/bytes";

describe("RawStd base64 helpers", () => {
  it("encodes without padding like Go base64.RawStdEncoding", () => {
    expect(base64RawEncode(new Uint8Array([1, 2, 3, 4, 5]))).toBe("AQIDBAU");
  });

  it("round-trips decoded bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(equalBytes(base64RawDecode(base64RawEncode(bytes)), bytes)).toBe(true);
  });
});
