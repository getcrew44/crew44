import { arrayBufferFromBytes, bytesFromWebSocketData } from "./bytes";
import { CipherPair, decryptFrame, encryptFrame } from "./noise";

export class EncryptedFrameTransport {
  private sendNonce = 0;
  private recvNonce = 0;

  constructor(
    private readonly socket: WebSocket,
    private readonly ciphers: CipherPair
  ) {}

  send(plaintext: Uint8Array) {
    const ciphertext = encryptFrame(this.ciphers.sendKey, this.sendNonce, plaintext);
    this.sendNonce += 1;
    this.socket.send(arrayBufferFromBytes(ciphertext));
  }

  async decrypt(data: unknown): Promise<Uint8Array> {
    const ciphertext = await bytesFromWebSocketData(data);
    const plaintext = decryptFrame(this.ciphers.recvKey, this.recvNonce, ciphertext);
    this.recvNonce += 1;
    return plaintext;
  }

  close() {
    this.socket.close();
  }
}
