import React from "react";
import Constants from "expo-constants";
import { CrewApi } from "@/api/client";
import { connectPairedDevice, PairedProfile, registerPairing } from "@/remote/client";
import { parsePairingOffer } from "@/remote/pairingOffer";
import { JsonRpcPeer } from "@/remote/rpc";
import { clearPairing, loadPairing, savePairing } from "@/storage/pairingStore";

type Status = "loading" | "unpaired" | "connecting" | "online" | "error";

interface MobileClientContextValue {
  status: Status;
  profile: PairedProfile | null;
  api: CrewApi | null;
  error: string;
  pairWithQrText: (text: string) => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const MobileClientContext = React.createContext<MobileClientContextValue | null>(null);

function deviceName(): string {
  return Constants.deviceName || "Phone";
}

export function MobileClientProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<Status>("loading");
  const [profile, setProfile] = React.useState<PairedProfile | null>(null);
  const [api, setApi] = React.useState<CrewApi | null>(null);
  const [error, setError] = React.useState("");
  const rpcRef = React.useRef<JsonRpcPeer | null>(null);

  const closeRpc = React.useCallback(() => {
    rpcRef.current?.close();
    rpcRef.current = null;
    setApi(null);
  }, []);

  const connectStoredPairing = React.useCallback(async () => {
    closeRpc();
    setStatus("connecting");
    setError("");
    const saved = await loadPairing();
    if (!saved) {
      setProfile(null);
      setStatus("unpaired");
      return;
    }
    setProfile(saved.profile);
    try {
      const rpc = await connectPairedDevice(saved.profile, saved.privateKey, err => {
        rpcRef.current = null;
        setApi(null);
        setError(err.message);
        setStatus("error");
      });
      rpcRef.current = rpc;
      setApi(new CrewApi(rpc));
      setStatus("online");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setStatus("error");
    }
  }, [closeRpc]);

  React.useEffect(() => {
    connectStoredPairing();
    return closeRpc;
  }, [connectStoredPairing, closeRpc]);

  const pairWithQrText = React.useCallback(async (text: string) => {
    setStatus("connecting");
    setError("");
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
      throw err;
    }
  }, [closeRpc, connectStoredPairing]);

  const disconnect = React.useCallback(async () => {
    closeRpc();
    await clearPairing();
    setProfile(null);
    setStatus("unpaired");
  }, [closeRpc]);

  const value = React.useMemo<MobileClientContextValue>(() => ({
    status,
    profile,
    api,
    error,
    pairWithQrText,
    reconnect: connectStoredPairing,
    disconnect
  }), [status, profile, api, error, pairWithQrText, connectStoredPairing, disconnect]);

  return <MobileClientContext.Provider value={value}>{children}</MobileClientContext.Provider>;
}

export function useMobileClient(): MobileClientContextValue {
  const value = React.useContext(MobileClientContext);
  if (!value) throw new Error("useMobileClient must be used inside MobileClientProvider");
  return value;
}
