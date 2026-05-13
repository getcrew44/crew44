export const PAIRING_TYPE = "crewai-remote-pairing";

export interface PairingOffer {
  v: number;
  type: string;
  relay_url: string;
  server_id: string;
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

export function parsePairingOffer(text: string, now: Date = new Date()): PairingOffer {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Pairing QR is not valid JSON");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Pairing QR is not an object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) throw new Error("Unsupported pairing offer version");
  if (obj.type !== PAIRING_TYPE) throw new Error("QR code is not a CrewAI pairing offer");

  const offer: PairingOffer = {
    v: 1,
    type: PAIRING_TYPE,
    relay_url: requireString(obj.relay_url, "relay_url"),
    server_id: requireString(obj.server_id, "server_id"),
    daemon_pubkey: requireString(obj.daemon_pubkey, "daemon_pubkey"),
    pairing_id: requireString(obj.pairing_id, "pairing_id"),
    pairing_secret: requireString(obj.pairing_secret, "pairing_secret"),
    expires_at: requireString(obj.expires_at, "expires_at")
  };

  const expiresAt = new Date(offer.expires_at);
  if (Number.isNaN(expiresAt.getTime())) throw new Error("Pairing offer has invalid expiration");
  if (expiresAt.getTime() <= now.getTime()) throw new Error("Pairing offer has expired");
  if (!/^wss?:\/\//.test(offer.relay_url)) throw new Error("Pairing offer relay URL must use ws or wss");

  return offer;
}
