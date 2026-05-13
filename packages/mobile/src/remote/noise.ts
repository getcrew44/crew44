import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { blake2s } from "@noble/hashes/blake2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { concatBytes, utf8 } from "./bytes";

const HASH_LEN = 32;
const KEY_LEN = 32;
const EMPTY = new Uint8Array(0);
const PROTOCOL_NK = "Noise_NK_25519_ChaChaPoly_BLAKE2s";
const PROTOCOL_XK = "Noise_XK_25519_ChaChaPoly_BLAKE2s";

export interface DHKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface CipherPair {
  sendKey: Uint8Array;
  recvKey: Uint8Array;
}

export interface NoiseKeySource {
  randomBytes(length: number): Uint8Array;
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

export function generateDHKeyPair(source: NoiseKeySource): DHKeyPair {
  const privateKey = source.randomBytes(KEY_LEN);
  return {
    privateKey,
    publicKey: publicKeyFromPrivate(privateKey)
  };
}

function hash(data: Uint8Array): Uint8Array {
  return blake2s(data, { dkLen: HASH_LEN });
}

function hkdf(chainingKey: Uint8Array, inputKeyMaterial: Uint8Array, outputs: 2 | 3): Uint8Array[] {
  const tempKey = hmac(blake2s, chainingKey, inputKeyMaterial);
  const out1 = hmac(blake2s, tempKey, new Uint8Array([1]));
  const out2 = hmac(blake2s, tempKey, concatBytes(out1, new Uint8Array([2])));
  if (outputs === 2) return [out1, out2];
  const out3 = hmac(blake2s, tempKey, concatBytes(out2, new Uint8Array([3])));
  return [out1, out2, out3];
}

function nonceBytes(nonce: number): Uint8Array {
  const out = new Uint8Array(12);
  let value = BigInt(nonce);
  for (let i = 0; i < 8; i += 1) {
    out[4 + i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

class CipherState {
  private key: Uint8Array | null = null;
  private nonce = 0;

  initializeKey(key: Uint8Array | null) {
    this.key = key;
    this.nonce = 0;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (!this.key) return plaintext;
    const cipher = chacha20poly1305(this.key, nonceBytes(this.nonce), ad);
    this.nonce += 1;
    return cipher.encrypt(plaintext);
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (!this.key) return ciphertext;
    const cipher = chacha20poly1305(this.key, nonceBytes(this.nonce), ad);
    this.nonce += 1;
    return cipher.decrypt(ciphertext);
  }
}

class SymmetricState {
  private cipher = new CipherState();
  private chainingKey: Uint8Array;
  private handshakeHash: Uint8Array;

  constructor(protocolName: string) {
    const protocol = utf8(protocolName);
    if (protocol.length <= HASH_LEN) {
      this.handshakeHash = new Uint8Array(HASH_LEN);
      this.handshakeHash.set(protocol);
    } else {
      this.handshakeHash = hash(protocol);
    }
    this.chainingKey = this.handshakeHash;
  }

  mixHash(data: Uint8Array) {
    this.handshakeHash = hash(concatBytes(this.handshakeHash, data));
  }

  mixKey(inputKeyMaterial: Uint8Array) {
    const [nextChainingKey, tempKey] = hkdf(this.chainingKey, inputKeyMaterial, 2);
    this.chainingKey = nextChainingKey;
    this.cipher.initializeKey(tempKey);
  }

  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const ciphertext = this.cipher.encryptWithAd(this.handshakeHash, plaintext);
    this.mixHash(ciphertext);
    return ciphertext;
  }

  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    const plaintext = this.cipher.decryptWithAd(this.handshakeHash, ciphertext);
    this.mixHash(ciphertext);
    return plaintext;
  }

  split(): CipherPair {
    const [sendKey, recvKey] = hkdf(this.chainingKey, EMPTY, 2);
    return { sendKey, recvKey };
  }
}

export class NoiseInitiator {
  private state: SymmetricState;
  private localStatic?: DHKeyPair;
  private localEphemeral?: DHKeyPair;
  private remoteEphemeral?: Uint8Array;

  constructor(
    pattern: "NK" | "XK",
    private readonly remoteStatic: Uint8Array,
    private readonly keySource: NoiseKeySource,
    localStatic?: DHKeyPair
  ) {
    this.localStatic = localStatic;
    this.state = new SymmetricState(pattern === "NK" ? PROTOCOL_NK : PROTOCOL_XK);
    this.state.mixHash(EMPTY);
    this.state.mixHash(remoteStatic);
  }

  writeMessageA(): Uint8Array {
    this.localEphemeral = generateDHKeyPair(this.keySource);
    this.state.mixHash(this.localEphemeral.publicKey);
    this.state.mixKey(dh(this.localEphemeral.privateKey, this.remoteStatic));
    return concatBytes(this.localEphemeral.publicKey, this.state.encryptAndHash(EMPTY));
  }

  readMessageB(message: Uint8Array) {
    if (!this.localEphemeral) throw new Error("Noise message A has not been sent");
    if (message.length < KEY_LEN) throw new Error("Noise responder message is too short");
    this.remoteEphemeral = message.slice(0, KEY_LEN);
    this.state.mixHash(this.remoteEphemeral);
    this.state.mixKey(dh(this.localEphemeral.privateKey, this.remoteEphemeral));
    this.state.decryptAndHash(message.slice(KEY_LEN));
  }

  writeMessageC(): Uint8Array {
    if (!this.localStatic || !this.remoteEphemeral) {
      throw new Error("Noise XK state is not ready for final message");
    }
    const encryptedStatic = this.state.encryptAndHash(this.localStatic.publicKey);
    this.state.mixKey(dh(this.localStatic.privateKey, this.remoteEphemeral));
    return concatBytes(encryptedStatic, this.state.encryptAndHash(EMPTY));
  }

  split(): CipherPair {
    return this.state.split();
  }
}

export function encryptFrame(key: Uint8Array, nonce: number, plaintext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonceBytes(nonce), EMPTY).encrypt(plaintext);
}

export function decryptFrame(key: Uint8Array, nonce: number, ciphertext: Uint8Array): Uint8Array {
  return chacha20poly1305(key, nonceBytes(nonce), EMPTY).decrypt(ciphertext);
}
