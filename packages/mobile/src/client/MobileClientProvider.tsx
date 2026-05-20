import React from "react";
import Constants from "expo-constants";
import { AppState } from "react-native";
import { CrewApi } from "@/api/client";
import { connectPairedDevice, PairedProfile, registerPairing } from "@/remote/client";
import { parsePairingOffer } from "@/remote/pairingOffer";
import { checkRelayDesktopStatus, DesktopOfflineError } from "@/remote/relay";
import { JsonRpcPeer } from "@/remote/rpc";
import { clearPairing, loadPairing, savePairing } from "@/storage/pairingStore";

type Status = "loading" | "unpaired" | "connecting" | "online" | "error";
type ConnectionIssue = "" | "relay" | "desktop";

interface MobileClientContextValue {
  status: Status;
  profile: PairedProfile | null;
  api: CrewApi | null;
  error: string;
  connectionIssue: ConnectionIssue;
  pairWithQrText: (text: string) => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const MobileClientContext = React.createContext<MobileClientContextValue | null>(null);

const reconnectDelaysMs = [1000, 2000, 5000, 10000, 15000];
const keepAliveIntervalMs = 10000;
const keepAliveTimeoutMs = 5000;

function deviceName(): string {
  return Constants.deviceName || "Phone";
}

export function MobileClientProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [profile, setProfile] = React.useState<PairedProfile | null>(null);
  const [api, setApi] = React.useState<CrewApi | null>(null);
  const [error, setError] = React.useState("");
  const [connectionIssue, setConnectionIssue] = React.useState<ConnectionIssue>("");
  const rpcRef = React.useRef<JsonRpcPeer | null>(null);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = React.useRef(0);
  const keepAliveTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const connectStoredPairingRef = React.useRef<(options?: { resetBackoff?: boolean; silent?: boolean }) => Promise<void>>(async () => {});
  const mountedRef = React.useRef(true);
  const statusRef = React.useRef<Status>("loading");

  React.useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearReconnectTimer = React.useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const stopKeepAlive = React.useCallback(() => {
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
  }, []);

  const closeRpc = React.useCallback(() => {
    stopKeepAlive();
    rpcRef.current?.close();
    rpcRef.current = null;
    setApi(null);
  }, [stopKeepAlive]);

  const showDesktopOffline = React.useCallback((message = "Desktop is offline") => {
    if (!mountedRef.current) return;
    clearReconnectTimer();
    setApi(null);
    setError(message);
    setConnectionIssue("desktop");
    setStatus("error");
  }, [clearReconnectTimer]);

  const scheduleRelayReconnect = React.useCallback((message: string) => {
    if (!mountedRef.current) return;
    setApi(null);
    setError(message);
    setConnectionIssue("relay");
    setStatus("error");
    if (reconnectTimerRef.current) return;
    const attempt = reconnectAttemptRef.current;
    const delay = reconnectDelaysMs[Math.min(attempt, reconnectDelaysMs.length - 1)];
    reconnectAttemptRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectStoredPairingRef.current({ resetBackoff: false, silent: true }).catch(() => {});
    }, delay);
  }, []);

  const classifyConnectionLoss = React.useCallback(async (message: string) => {
    const saved = await loadPairing();
    if (!saved) {
      setProfile(null);
      setConnectionIssue("");
      setStatus("unpaired");
      return;
    }
    setProfile(saved.profile);
    try {
      const relayStatus = await checkRelayDesktopStatus(saved.profile.relayUrl, saved.profile.serverId);
      if (relayStatus === "desktop_offline") {
        showDesktopOffline("Desktop is offline");
        return;
      }
      scheduleRelayReconnect(message || "Relay connection dropped. Reconnecting...");
    } catch (err) {
      scheduleRelayReconnect(err instanceof Error ? err.message : "Relay connection failed");
    }
  }, [scheduleRelayReconnect, showDesktopOffline]);

  const classifyConnectError = React.useCallback((err: unknown) => {
    if (err instanceof DesktopOfflineError) {
      showDesktopOffline(err.message);
      return;
    }
    scheduleRelayReconnect(err instanceof Error ? err.message : "Relay connection failed");
  }, [scheduleRelayReconnect, showDesktopOffline]);

  const pingRpc = React.useCallback(async (rpc: JsonRpcPeer) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("RPC keepalive timed out")), keepAliveTimeoutMs);
    });
    try {
      await Promise.race([rpc.call("system.health"), timeout]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, []);

  const startKeepAlive = React.useCallback((rpc: JsonRpcPeer) => {
    stopKeepAlive();
    const ping = async () => {
      try {
        await pingRpc(rpc);
      } catch (err) {
        if (rpcRef.current !== rpc) return;
        const closeError = err instanceof Error ? err : new Error("RPC keepalive failed");
        rpcRef.current = null;
        setApi(null);
        rpc.close(closeError);
        classifyConnectionLoss(closeError.message).catch(() => {
          scheduleRelayReconnect(closeError.message);
        });
      }
    };
    keepAliveTimerRef.current = setInterval(() => {
      ping().catch(() => {});
    }, keepAliveIntervalMs);
  }, [classifyConnectionLoss, pingRpc, scheduleRelayReconnect, stopKeepAlive]);

  const connectStoredPairing = React.useCallback(async (options: { resetBackoff?: boolean; silent?: boolean } = {}) => {
    clearReconnectTimer();
    if (options.resetBackoff !== false) reconnectAttemptRef.current = 0;
    closeRpc();
    if (!options.silent) {
      setStatus("connecting");
      setError("");
      setConnectionIssue("");
    }
    const saved = await loadPairing();
    if (!saved) {
      setProfile(null);
      setConnectionIssue("");
      setStatus("unpaired");
      return;
    }
    setProfile(saved.profile);
    try {
      const connection = { rpc: null as JsonRpcPeer | null };
      const rpc = await connectPairedDevice(saved.profile, saved.privateKey, err => {
        if (!connection.rpc || rpcRef.current !== connection.rpc) return;
        stopKeepAlive();
        rpcRef.current = null;
        setApi(null);
        classifyConnectionLoss(err.message).catch(() => {
          scheduleRelayReconnect(err.message);
        });
      });
      connection.rpc = rpc;
      rpcRef.current = rpc;
      setApi(new CrewApi(rpc));
      startKeepAlive(rpc);
      reconnectAttemptRef.current = 0;
      setConnectionIssue("");
      setError("");
      setStatus("online");
    } catch (err) {
      classifyConnectError(err);
    }
  }, [classifyConnectError, classifyConnectionLoss, clearReconnectTimer, closeRpc, scheduleRelayReconnect, startKeepAlive, stopKeepAlive]);

  React.useEffect(() => {
    connectStoredPairingRef.current = connectStoredPairing;
  }, [connectStoredPairing]);

  React.useEffect(() => {
    connectStoredPairing();
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      closeRpc();
    };
  }, [clearReconnectTimer, connectStoredPairing, closeRpc]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", nextState => {
      if (nextState !== "active" || statusRef.current !== "online") return;
      const rpc = rpcRef.current;
      if (!rpc) return;
      pingRpc(rpc).catch(err => {
        if (rpcRef.current !== rpc) return;
        rpcRef.current = null;
        setApi(null);
        rpc.close(err instanceof Error ? err : new Error("RPC keepalive failed"));
        classifyConnectionLoss(err instanceof Error ? err.message : "RPC keepalive failed").catch(() => {
          scheduleRelayReconnect("Relay connection dropped. Reconnecting...");
        });
      });
    });
    return () => subscription.remove();
  }, [classifyConnectionLoss, pingRpc, scheduleRelayReconnect]);

  const pairWithQrText = React.useCallback(async (text: string) => {
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    setStatus("connecting");
    setError("");
    setConnectionIssue("");
    closeRpc();
    try {
      const offer = parsePairingOffer(text);
      const result = await registerPairing(offer, deviceName());
      await savePairing(result.profile, result.privateKey);
      setProfile(result.profile);
      await connectStoredPairing();
    } catch (err) {
      setStatus("unpaired");
      setError(err instanceof Error ? err.message : "Pairing failed");
      setConnectionIssue("");
      throw err;
    }
  }, [clearReconnectTimer, closeRpc, connectStoredPairing]);

  const disconnect = React.useCallback(async () => {
    const currentApi = api;
    const currentProfile = profile;
    const desktopDeviceId = currentProfile?.deviceId || "";
    const wasDesktopConnected = Boolean(currentApi && desktopDeviceId);
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    if (currentApi && desktopDeviceId) {
      await currentApi.deleteRemoteDevice(desktopDeviceId).catch(() => {});
    }
    closeRpc();
    await clearPairing();
    setProfile(null);
    setConnectionIssue("");
    setError(wasDesktopConnected ? "" : "Also unpair this device on desktop before pairing again.");
    setStatus("unpaired");
  }, [api, clearReconnectTimer, closeRpc, profile]);

  const value = React.useMemo<MobileClientContextValue>(() => ({
    status,
    profile,
    api,
    error,
    connectionIssue,
    pairWithQrText,
    reconnect: connectStoredPairing,
    disconnect
  }), [status, profile, api, error, connectionIssue, pairWithQrText, connectStoredPairing, disconnect]);

  return <MobileClientContext.Provider value={value}>{children}</MobileClientContext.Provider>;
}

export function useMobileClient(): MobileClientContextValue {
  const value = React.useContext(MobileClientContext);
  if (!value) throw new Error("useMobileClient must be used inside MobileClientProvider");
  return value;
}
