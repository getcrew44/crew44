import { arrayBufferFromBytes, bytesFromWebSocketData } from "./bytes";

export function buildRelayClientUrl(relayUrl: string, serverId: string): string {
  const url = new URL(relayUrl);
  if (!url.pathname || url.pathname === "/") url.pathname = "/relay";
  url.searchParams.set("role", "client");
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
      reject(new Error("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Relay socket closed before opening"));
    };
    socket.addEventListener("open", onOpen);
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
      reject(new Error("Relay socket failed"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Relay socket closed"));
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
