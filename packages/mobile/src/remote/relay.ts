import { arrayBufferFromBytes, bytesFromWebSocketData } from "./bytes";

export class RelayConnectionError extends Error {
  constructor(message = "Relay connection failed") {
    super(message);
    this.name = "RelayConnectionError";
  }
}

export class DesktopOfflineError extends Error {
  constructor(message = "Desktop is offline") {
    super(message);
    this.name = "DesktopOfflineError";
  }
}

export function buildRelayClientUrl(relayUrl: string, serverId: string): string {
  return buildRelayUrl(relayUrl, serverId, "client");
}

export function buildRelayStatusUrl(relayUrl: string, serverId: string): string {
  return buildRelayUrl(relayUrl, serverId, "status");
}

function buildRelayUrl(relayUrl: string, serverId: string, role: string): string {
  const url = new URL(relayUrl);
  if (!url.pathname || url.pathname === "/") url.pathname = "/relay";
  url.searchParams.set("role", role);
  url.searchParams.set("server_id", serverId);
  return url.toString();
}

export function openRelaySocket(relayUrl: string, serverId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(buildRelayClientUrl(relayUrl, serverId));
    socket.binaryType = "arraybuffer";
    const cleanup = () => {
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve(socket);
    };
    const onError = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket closed before opening"));
    };
    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export async function checkRelayDesktopStatus(relayUrl: string, serverId: string): Promise<"desktop_online" | "desktop_offline"> {
  const socket = await new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(buildRelayStatusUrl(relayUrl, serverId));
    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve(ws);
    };
    const onError = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket closed before opening"));
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });
  try {
    const status = await waitForRelayStatus(socket);
    return status;
  } finally {
    socket.close();
  }
}

export function waitForRelayReady(socket: WebSocket): Promise<void> {
  return waitForRelayStatus(socket).then(status => {
    if (status === "desktop_offline") throw new DesktopOfflineError("Desktop is offline");
  });
}

function waitForRelayStatus(socket: WebSocket): Promise<"desktop_online" | "desktop_offline"> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onMessage = async (event: MessageEvent) => {
      cleanup();
      try {
        const text = typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(await bytesFromWebSocketData(event.data));
        const data = JSON.parse(text) as { type?: string };
        if (data.type === "desktop_online" || data.type === "desktop_offline") {
          resolve(data.type);
          return;
        }
        reject(new RelayConnectionError("Relay returned an unknown desktop status"));
      } catch (err) {
        reject(err instanceof Error ? err : new RelayConnectionError("Relay status could not be read"));
      }
    };
    const onError = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket closed before desktop status"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export function waitForBinaryMessage(socket: WebSocket): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };
    const onMessage = async (event: MessageEvent) => {
      cleanup();
      try {
        resolve(await bytesFromWebSocketData(event.data));
      } catch (err) {
        reject(err);
      }
    };
    const onError = () => {
      cleanup();
      reject(new RelayConnectionError("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new DesktopOfflineError("Desktop connection closed"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export function sendJSON(socket: WebSocket, value: unknown) {
  socket.send(JSON.stringify(value));
}

export function sendBinary(socket: WebSocket, value: Uint8Array) {
  socket.send(arrayBufferFromBytes(value));
}
