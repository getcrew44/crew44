import React from "react";
import Constants from "expo-constants";
import { router } from "expo-router";
import { Alert, AppState } from "react-native";
import { CrewApi } from "@/api/client";
import { connectPairedDevice, PairedProfile, registerPairing } from "@/remote/client";
import { parsePairingOffer } from "@/remote/pairingOffer";
import { DesktopOfflineError, RelayConnectionError } from "@/remote/relay";
import { JsonRpcPeer } from "@/remote/rpc";
import { clearPairing, loadPairing, savePairing } from "@/storage/pairingStore";

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

function resetNavigationToPair() {
  if (router.canDismiss()) {
    router.dismissAll();
  }
  router.replace("/pair");
}

function showRemoteRevokedNotice() {
  setTimeout(() => {
    Alert.alert(
      "Phone unpaired",
      "This phone was unpaired from the Crew44 desktop. Pair again to reconnect."
    );
  }, 250);
}

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
        if (rpcRef.current !== rpc) return;
        if (revokedRef.current) return;
        const closeError = err instanceof Error ? err : new Error("RPC keepalive failed");
        rpcRef.current = null;
        setApi(null);
        rpc.close(closeError);
        classifyConnectionLoss().catch(() => {
          showDesktopOffline("Can't connect to the Crew44 desktop");
        });
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
        if (!connection.rpc || rpcRef.current !== connection.rpc) return;
        if (revokedRef.current) return;
        stopKeepAlive();
        rpcRef.current = null;
        setApi(null);
        classifyConnectionLoss().catch(() => {
          showDesktopOffline("Can't connect to the Crew44 desktop");
        });
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
        if (revokedRef.current) return;
        rpcRef.current = null;
        setApi(null);
        rpc.close(err instanceof Error ? err : new Error("RPC keepalive failed"));
        classifyConnectionLoss().catch(() => {
          showDesktopOffline("Can't connect to the Crew44 desktop");
        });
      });
    });
    return () => subscription.remove();
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
    } catch (err) {
      setStatus("unpaired");
      setError(err instanceof Error ? err.message : "Pairing failed");
      setConnectionIssue("");
      throw err;
    }
  }, [api, clearReconnectTimer, closeRpc, connectStoredPairing, profile]);

  const disconnect = React.useCallback(async () => {
    const currentApi = api;
    const currentProfile = profile;
    const desktopDeviceId = currentProfile?.deviceId || "";
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
    setError(wasDesktopConnected ? "" : "Also unpair this device on desktop before pairing again.");
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
