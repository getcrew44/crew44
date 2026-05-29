import React from "react";
import { CrewApi } from "@/api/client";
import { connectPairedDevice, PairedProfile, registerPairing } from "@/remote/client";
import { parsePairingOffer } from "@/remote/pairingOffer";
import { DesktopOfflineError, RelayConnectionError } from "@/remote/relay";
import { JsonRpcPeer } from "@/remote/rpc";
import { clearPairing, loadPairing, savePairing } from "@/storage/pairingStore";
import { PWA_PAIRED_EVENT } from "@/pwa-install/events";

type Status = "loading" | "unpaired" | "connecting" | "reconnecting" | "online" | "error";
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

const relayRetryDelayMs = 1000;
const keepAliveIntervalMs = 10000;
const keepAliveTimeoutMs = 5000;

function hasPairingSecretInHash(): boolean {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).has("secret");
}

function resetNavigationToPair() {
  if (window.location.hash !== "#/pair") window.location.hash = "/pair";
}

function showRemoteRevokedNotice() {
  window.setTimeout(() => {
    window.alert("This browser was unpaired from the Crew44 desktop. Pair again to reconnect.");
  }, 250);
}

function deviceName(): string {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "Browser";
  return `PWA on ${platform}`;
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
  const revokedRef = React.useRef(false);
  const suppressRevokedNoticeRef = React.useRef(false);

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

  const showDesktopOffline = React.useCallback((message = "Can't connect to the Crew44 desktop") => {
    if (!mountedRef.current) return;
    clearReconnectTimer();
    setApi(null);
    setError(message);
    setConnectionIssue("desktop");
    setStatus("error");
  }, [clearReconnectTimer]);

  const showRelayError = React.useCallback((message = "Relay connection failed") => {
    if (!mountedRef.current) return;
    clearReconnectTimer();
    setApi(null);
    setError(message);
    setConnectionIssue("relay");
    setStatus("error");
  }, [clearReconnectTimer]);

  const scheduleRelayReconnect = React.useCallback((message: string) => {
    if (!mountedRef.current) return;
    setApi(null);
    setError(message);
    setConnectionIssue("relay");
    if (reconnectAttemptRef.current >= 1) {
      showRelayError(message);
      return;
    }
    setStatus("reconnecting");
    if (reconnectTimerRef.current) return;
    reconnectAttemptRef.current += 1;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectStoredPairingRef.current({ resetBackoff: false, silent: true }).catch(() => {});
    }, relayRetryDelayMs);
  }, [showRelayError]);

  const classifyConnectionLoss = React.useCallback(async () => {
    const saved = await loadPairing();
    if (!saved) {
      setProfile(null);
      setConnectionIssue("");
      setStatus("unpaired");
      return;
    }
    setProfile(saved.profile);
    showDesktopOffline("Can't connect to the Crew44 desktop");
  }, [showDesktopOffline]);

  const classifyConnectError = React.useCallback((err: unknown) => {
    if (err instanceof DesktopOfflineError) {
      showDesktopOffline("Can't connect to the Crew44 desktop");
      return;
    }
    if (err instanceof RelayConnectionError) {
      scheduleRelayReconnect(err.message);
      return;
    }
    showDesktopOffline(err instanceof Error ? err.message : "Can't connect to the Crew44 desktop");
  }, [scheduleRelayReconnect, showDesktopOffline]);

  const handleRemoteRevoked = React.useCallback(async () => {
    revokedRef.current = true;
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    closeRpc();
    if (suppressRevokedNoticeRef.current) return;
    await clearPairing();
    setProfile(null);
    setConnectionIssue("");
    setError("");
    setStatus("unpaired");
    resetNavigationToPair();
    showRemoteRevokedNotice();
  }, [clearReconnectTimer, closeRpc]);

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
        if (rpcRef.current !== rpc || revokedRef.current) return;
        const closeError = err instanceof Error ? err : new Error("RPC keepalive failed");
        rpcRef.current = null;
        setApi(null);
        rpc.close(closeError);
        classifyConnectionLoss().catch(() => showDesktopOffline("Can't connect to the Crew44 desktop"));
      }
    };
    keepAliveTimerRef.current = setInterval(() => {
      ping().catch(() => {});
    }, keepAliveIntervalMs);
  }, [classifyConnectionLoss, pingRpc, showDesktopOffline, stopKeepAlive]);

  const connectStoredPairing = React.useCallback(async (options: { resetBackoff?: boolean; silent?: boolean } = {}) => {
    clearReconnectTimer();
    if (options.resetBackoff !== false) reconnectAttemptRef.current = 0;
    revokedRef.current = false;
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
        if (!connection.rpc || rpcRef.current !== connection.rpc || revokedRef.current) return;
        stopKeepAlive();
        rpcRef.current = null;
        setApi(null);
        classifyConnectionLoss().catch(() => showDesktopOffline("Can't connect to the Crew44 desktop"));
      }, handleRemoteRevoked);
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
  }, [classifyConnectError, classifyConnectionLoss, clearReconnectTimer, closeRpc, handleRemoteRevoked, showDesktopOffline, startKeepAlive, stopKeepAlive]);

  React.useEffect(() => {
    connectStoredPairingRef.current = connectStoredPairing;
  }, [connectStoredPairing]);

  React.useEffect(() => {
    if (hasPairingSecretInHash()) {
      let cancelled = false;
      clearReconnectTimer();
      revokedRef.current = true;
      closeRpc();
      clearPairing().then(() => {
        if (cancelled || !mountedRef.current) return;
        setProfile(null);
        setConnectionIssue("");
        setError("");
        setStatus("unpaired");
      }).catch(() => {
        if (!cancelled && mountedRef.current) setStatus("unpaired");
      });
      return () => {
        cancelled = true;
        mountedRef.current = false;
        clearReconnectTimer();
        closeRpc();
      };
    }
    connectStoredPairing();
    return () => {
      mountedRef.current = false;
      clearReconnectTimer();
      closeRpc();
    };
  }, [clearReconnectTimer, closeRpc, connectStoredPairing]);

  React.useEffect(() => {
    const onFocus = () => {
      if (statusRef.current !== "online") return;
      const rpc = rpcRef.current;
      if (!rpc) return;
      pingRpc(rpc).catch(err => {
        if (rpcRef.current !== rpc || revokedRef.current) return;
        rpcRef.current = null;
        setApi(null);
        rpc.close(err instanceof Error ? err : new Error("RPC keepalive failed"));
        classifyConnectionLoss().catch(() => showDesktopOffline("Can't connect to the Crew44 desktop"));
      });
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [classifyConnectionLoss, pingRpc, showDesktopOffline]);

  const pairWithQrText = React.useCallback(async (text: string) => {
    let offer;
    try {
      offer = parsePairingOffer(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      setConnectionIssue("");
      throw err;
    }

    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    const oldApi = api;
    const oldDeviceId = profile?.deviceId || "";
    setStatus("connecting");
    setError("");
    setConnectionIssue("");
    suppressRevokedNoticeRef.current = true;
    revokedRef.current = true;
    if (oldApi && oldDeviceId) {
      await oldApi.deleteRemoteDevice(oldDeviceId).catch(() => {});
    }
    closeRpc();
    await clearPairing();
    setProfile(null);
    suppressRevokedNoticeRef.current = false;
    revokedRef.current = false;
    try {
      const result = await registerPairing(offer, deviceName());
      await savePairing(result.profile, result.privateKey);
      setProfile(result.profile);
      await connectStoredPairing();
      window.dispatchEvent(new CustomEvent(PWA_PAIRED_EVENT));
    } catch (err) {
      setStatus("unpaired");
      setError(err instanceof Error ? err.message : "Pairing failed");
      setConnectionIssue("");
      throw err;
    }
  }, [api, clearReconnectTimer, closeRpc, connectStoredPairing, profile]);

  const disconnect = React.useCallback(async () => {
    const currentApi = api;
    const desktopDeviceId = profile?.deviceId || "";
    const wasDesktopConnected = Boolean(currentApi && desktopDeviceId);
    clearReconnectTimer();
    reconnectAttemptRef.current = 0;
    suppressRevokedNoticeRef.current = true;
    revokedRef.current = true;
    if (currentApi && desktopDeviceId) {
      await currentApi.deleteRemoteDevice(desktopDeviceId).catch(() => {});
    }
    closeRpc();
    await clearPairing();
    setProfile(null);
    setConnectionIssue("");
    setError(wasDesktopConnected ? "" : "Also unpair this browser on desktop before pairing again.");
    setStatus("unpaired");
    resetNavigationToPair();
    suppressRevokedNoticeRef.current = false;
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
