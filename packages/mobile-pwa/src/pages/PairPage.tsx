import React from "react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, Header, Screen } from "@/ui/Screen";
import { CameraIcon } from "@/ui/icons";

const cameraIdleMs = 60000;

export function PairPage() {
  const client = useMobileClient();
  const [manualText, setManualText] = React.useState("");
  const [error, setError] = React.useState("");
  const [pairing, setPairing] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [cameraPaused, setCameraPaused] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopIdleTimer = React.useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const stopScanner = React.useCallback(() => {
    stopIdleTimer();
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, [stopIdleTimer]);

  React.useEffect(() => stopScanner, [stopScanner]);

  React.useEffect(() => {
    stopIdleTimer();
    if (!scanning || pairing) return undefined;
    idleTimerRef.current = setTimeout(() => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      setScanning(false);
      setCameraPaused(true);
    }, cameraIdleMs);
    return stopIdleTimer;
  }, [pairing, scanning, stopIdleTimer]);

  const pair = React.useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || pairing) return;
    setPairing(true);
    setError("");
    stopScanner();
    try {
      await client.pairWithQrText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setPairing(false);
    }
  }, [client, pairing, stopScanner]);

  const startScanner = React.useCallback(async () => {
    if (!videoRef.current || scanning) return;
    setError("");
    setCameraPaused(false);
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current, result => {
        const text = result?.getText();
        if (text) pair(text).catch(() => {});
      });
    } catch (err) {
      setScanning(false);
      setError(err instanceof Error ? err.message : "Camera could not start");
    }
  }, [pair, scanning]);

  const unpairNotice = client.error.startsWith("Also unpair") ? client.error : "";
  const pairError = error || (unpairNotice ? "" : client.error);

  return (
    <Screen>
      <Header title="Pair device" />
      <section className="pair-body">
        <p className="muted">Scan the QR code from Crew44's Pair Mobile dialog.</p>
        <div className="camera-box">
          <video ref={videoRef} muted playsInline />
          {!scanning ? (
            <button type="button" className="camera-overlay" onClick={startScanner}>
              {pairing ? (
                <>
                  <span className="camera-icon"><CameraIcon /></span>
                  <span>Pairing...</span>
                </>
              ) : cameraPaused ? (
                <>
                  <span>Camera paused.</span>
                  <small>Tap the scan area to resume.</small>
                </>
              ) : (
                <>
                  <span className="camera-icon"><CameraIcon /></span>
                  <span>Start camera</span>
                </>
              )}
            </button>
          ) : null}
        </div>
        <textarea
          value={manualText}
          onChange={event => setManualText(event.target.value)}
          placeholder="Or paste QR payload JSON"
          autoCapitalize="none"
          autoCorrect="off"
        />
        {pairError ? <p className="error-text">{pairError}</p> : null}
        {unpairNotice ? <p className="muted">{unpairNotice}</p> : null}
        <Button disabled={pairing || client.status === "connecting"} onClick={() => pair(manualText)}>
          {pairing || client.status === "connecting" ? "Pairing..." : "Pair from pasted text"}
        </Button>
        {client.profile ? (
          <Button variant="danger" onClick={() => client.disconnect().catch(() => {})}>
            Forget saved pairing
          </Button>
        ) : null}
      </section>
    </Screen>
  );
}
