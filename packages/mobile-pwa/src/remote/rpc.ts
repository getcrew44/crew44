import { utf8 } from "./bytes";
import { EncryptedFrameTransport } from "./frameTransport";

export interface RpcErrorPayload {
  code?: number;
  message?: string;
}

export class RpcError extends Error {
  code?: number;

  constructor(payload: RpcErrorPayload) {
    super(payload.message || "RPC error");
    this.name = "RpcError";
    this.code = payload.code;
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export type RpcListener = (params: unknown) => void;

export class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<RpcListener>>();
  private closed = false;

  constructor(private readonly transport: EncryptedFrameTransport) {}

  call<T>(method: string, params: unknown = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("RPC connection is closed"));
    const id = `mobile_${this.nextId++}`;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject
      });
    });
    this.transport.send(utf8(JSON.stringify(payload)));
    return promise;
  }

  on(method: string, listener: RpcListener): () => void {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)?.add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  async handleFrame(data: unknown) {
    const bytes = await this.transport.decrypt(data);
    const text = new TextDecoder().decode(bytes);
    const message = JSON.parse(text) as {
      id?: string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: RpcErrorPayload;
    };

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) pending.reject(new RpcError(message.error));
      else pending.resolve(message.result);
      return;
    }

    if (message.method) {
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params);
      }
    }
  }

  close(err = new Error("RPC connection closed")) {
    if (this.closed) return;
    this.closed = true;
    this.transport.close();
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
    this.listeners.clear();
  }
}

export function attachRpcSocket(peer: JsonRpcPeer, socket: WebSocket, onClose: (err: Error) => void) {
  socket.addEventListener("message", event => {
    peer.handleFrame(event.data).catch(onClose);
  });
  socket.addEventListener("close", () => onClose(new Error("RPC socket closed")));
  socket.addEventListener("error", () => onClose(new Error("RPC socket failed")));
}
