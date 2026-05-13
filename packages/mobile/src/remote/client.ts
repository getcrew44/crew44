import * as Crypto from "expo-crypto";
import { base64RawDecode, base64RawEncode, utf8 } from "./bytes";
import { EncryptedFrameTransport } from "./frameTransport";
import { DHKeyPair, generateDHKeyPair, NoiseInitiator, NoiseKeySource, publicKeyFromPrivate } from "./noise";
import { PairingOffer } from "./pairingOffer";
import { attachRpcSocket, JsonRpcPeer } from "./rpc";
import { openRelaySocket, sendBinary, sendJSON, waitForBinaryMessage } from "./relay";

export interface PairedProfile {
  serverId: string;
  relayUrl: string;
  daemonPubKey: string;
  deviceId: string;
  deviceName: string;
  devicePubKey: string;
  pairedAt: string;
}

export interface PairingResult {
  profile: PairedProfile;
  privateKey: string;
}

const cryptoKeySource: NoiseKeySource = {
  randomBytes(length: number) {
    const bytes = new Uint8Array(length);
    Crypto.getRandomValues(bytes);
    return bytes;
  }
};

function keyPairFromPrivateBase64(privateKey: string): DHKeyPair {
  const rawPrivateKey = base64RawDecode(privateKey);
  return {
    privateKey: rawPrivateKey,
    publicKey: publicKeyFromPrivate(rawPrivateKey)
  };
}

function makeDeviceKeyPair(): DHKeyPair {
  return generateDHKeyPair(cryptoKeySource);
}

function rpcRequest(id: string, method: string, params: unknown): Uint8Array {
  return utf8(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
}

async function readEncryptedResponse(transport: EncryptedFrameTransport, socket: WebSocket): Promise<any> {
  const message = await new Promise<MessageEvent>((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onMessage = (event: MessageEvent) => {
      cleanup();
      resolve(event);
    };
    const onError = () => {
      cleanup();
      reject(new Error("Pairing socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Pairing socket closed"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
  const plaintext = await transport.decrypt(message.data);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function registerPairing(offer: PairingOffer, deviceName: string): Promise<PairingResult> {
  const socket = await openRelaySocket(offer.relay_url, offer.server_id);
  try {
    sendJSON(socket, { type: "noise_init", mode: "pairing" });
    const remoteStatic = base64RawDecode(offer.daemon_pubkey);
    const noise = new NoiseInitiator("NK", remoteStatic, cryptoKeySource);
    sendBinary(socket, noise.writeMessageA());
    noise.readMessageB(await waitForBinaryMessage(socket));
    const transport = new EncryptedFrameTransport(socket, noise.split());

    const deviceKey = makeDeviceKeyPair();
    const devicePubKey = base64RawEncode(deviceKey.publicKey);
    transport.send(rpcRequest("pair_register", "remote.pair.register", {
      pairing_id: offer.pairing_id,
      pairing_secret: offer.pairing_secret,
      device_name: deviceName,
      device_pubkey: devicePubKey
    }));

    const response = await readEncryptedResponse(transport, socket);
    if (response.error) throw new Error(response.error.message || "Pairing failed");
    const device = response.result?.device;
    if (!device?.device_id) throw new Error("Pairing response did not include a device");

    return {
      privateKey: base64RawEncode(deviceKey.privateKey),
      profile: {
        serverId: offer.server_id,
        relayUrl: offer.relay_url,
        daemonPubKey: offer.daemon_pubkey,
        deviceId: device.device_id,
        deviceName: device.name || deviceName,
        devicePubKey,
        pairedAt: new Date().toISOString()
      }
    };
  } finally {
    socket.close();
  }
}

export async function connectPairedDevice(
  profile: PairedProfile,
  privateKey: string,
  onClose: (err: Error) => void
): Promise<JsonRpcPeer> {
  const socket = await openRelaySocket(profile.relayUrl, profile.serverId);
  sendJSON(socket, { type: "noise_init", mode: "device" });

  const localStatic = keyPairFromPrivateBase64(privateKey);
  const noise = new NoiseInitiator(
    "XK",
    base64RawDecode(profile.daemonPubKey),
    cryptoKeySource,
    localStatic
  );
  sendBinary(socket, noise.writeMessageA());
  noise.readMessageB(await waitForBinaryMessage(socket));
  sendBinary(socket, noise.writeMessageC());

  const transport = new EncryptedFrameTransport(socket, noise.split());
  const peer = new JsonRpcPeer(transport);
  attachRpcSocket(peer, socket, onClose);
  return peer;
}
