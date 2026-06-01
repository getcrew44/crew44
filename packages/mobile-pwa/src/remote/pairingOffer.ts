export const PAIRING_TYPE = "crew44-remote-pairing";
export const PAIRING_SECRET_PARAM = "secret";

export interface PairingOffer {
  v: number;
  type: string;
  relay_url: string;
  server_id: string;
  desktop_name?: string;
  daemon_pubkey: string;
  pairing_id: string;
  pairing_secret: string;
  expires_at: string;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Pairing offer is missing ${name}`);
  }
  return value;
}

export function pairingSecretFromText(text: string): string {
  const trimmed = text.trim();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    const hashText = trimmed.slice(hashIndex + 1);
    const secret = new URLSearchParams(hashText).get(PAIRING_SECRET_PARAM);
    if (secret) return secret;
    const marker = `${PAIRING_SECRET_PARAM}=`;
    const markerIndex = hashText.indexOf(marker);
    if (markerIndex >= 0) return decodePairingSecret(hashText.slice(markerIndex + marker.length));
  }
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) return trimmed.slice(jsonStart, jsonEnd + 1);
  return trimmed;
}

function decodePairingSecret(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parsePairingOffer(text: string, now: Date = new Date()): PairingOffer {
  let raw: unknown;
  try {
    raw = JSON.parse(pairingSecretFromText(text));
  } catch {
    throw new Error("Pairing QR is not valid JSON");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Pairing QR is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) throw new Error("Unsupported pairing offer version");

  const offer: PairingOffer = {
    v: 1,
    type: PAIRING_TYPE,
    relay_url: requireString(obj.r, "r"),
    server_id: requireString(obj.s, "s"),
    desktop_name: typeof obj.n === "string" && obj.n.trim() ? obj.n.trim() : undefined,
    daemon_pubkey: requireString(obj.k, "k"),
    pairing_id: requireString(obj.p, "p"),
    pairing_secret: requireString(obj.x, "x"),
    expires_at: requireString(obj.e, "e")
  };

  const expiresAt = new Date(offer.expires_at);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("Pairing offer has invalid expiration");
  if (expiresAt.getTime() <= now.getTime()) throw new Error("Pairing offer has expired");
  if (!/^wss?:\/\//.test(offer.relay_url)) throw new Error("Pairing offer relay URL must use ws or wss");

  return offer;
}
