const RPC_PROTOCOL = 'crew44.rpc.v1';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function deriveRpcUrl(origin) {
  if (!origin) return '';
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/rpc';
  url.search = '';
  url.hash = '';
  return url.toString();
}

class RpcError extends Error {
  constructor(error) {
    super(error?.message || 'RPC error');
    this.name = 'RpcError';
    this.code = error?.code;
  }
}

class RpcClient {
  constructor() {
    this.socket = null;
    this.connecting = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.configPromise = null;
  }

  async getConfig() {
    if (!this.configPromise) {
      this.configPromise = (async () => {
        if (typeof window !== 'undefined' && window.electronAPI?.getBackendConfig) {
          const config = await window.electronAPI.getBackendConfig();
          const origin = trimTrailingSlash(config?.url || config?.healthUrl?.replace(/\/health$/, ''));
          return {
            rpcUrl: config?.rpcUrl || deriveRpcUrl(origin),
            token: config?.token || '',
          };
        }

        const rpcUrl = import.meta.env.VITE_CREW44_RPC_URL || deriveRpcUrl(trimTrailingSlash(import.meta.env.VITE_CREW44_BACKEND_URL || ''));
        return {
          rpcUrl,
          token: import.meta.env.VITE_CREW44_AUTH_TOKEN || '',
        };
      })();
    }
    return this.configPromise;
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const config = await this.getConfig();
      if (!config.rpcUrl) throw new Error('RPC URL is not configured');

      const protocols = config.token
        ? [RPC_PROTOCOL, `crew44.bearer.${config.token}`]
        : [RPC_PROTOCOL];
      const socket = new WebSocket(config.rpcUrl, protocols);
      this.socket = socket;

      socket.addEventListener('message', event => this.handleMessage(event));
      socket.addEventListener('close', () => this.handleClose());
      socket.addEventListener('error', () => {
        if (socket.readyState !== WebSocket.OPEN) {
          this.handleClose(new Error('RPC socket failed'));
        }
      });

      await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('close', () => reject(new Error('RPC socket closed')), { once: true });
        socket.addEventListener('error', () => reject(new Error('RPC socket failed')), { once: true });
      });
      return socket;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async call(method, params = {}) {
    const socket = await this.connect();
    const id = `req_${this.nextId++}`;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    socket.send(JSON.stringify(message));
    return promise;
  }

  on(method, listener) {
    if (!this.listeners.has(method)) {
      this.listeners.set(method, new Set());
    }
    this.listeners.get(method).add(listener);
    return () => this.off(method, listener);
  }

  off(method, listener) {
    this.listeners.get(method)?.delete(listener);
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new RpcError(message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {});
      }
    }
  }

  handleClose(err = new Error('RPC socket closed')) {
    if (this.socket) {
      this.socket = null;
    }
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
  }
}

export const rpc = new RpcClient();

