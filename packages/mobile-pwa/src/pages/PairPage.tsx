import React from "react";
import { BrowserQRCodeReader, IScannerControls } from "@zxing/browser";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, Header, Screen } from "@/ui/Screen";
import { CameraIcon } from "@/ui/icons";

export function PairPage() {
  const client = useMobileClient();
  const [manualText, setManualText] = React.useState("");
  const [error, setError] = React.useState("");
  const [pairing, setPairing] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const controlsRef = React.useRef<IScannerControls | null>(null);

  const stopScanner = React.useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  React.useEffect(() => stopScanner, [stopScanner]);

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

  const pairError = error || client.error;

  return (
    <Screen>
      <Header title="Pair device" />
      <section className="pair-body">
        <p className="muted">Scan the QR code from Crew44's Pair Mobile dialog.</p>
        <div className="camera-box">
          <video ref={videoRef} muted playsInline />
          {!scanning ? (
            <button type="button" className="camera-overlay" onClick={startScanner}>
              <span className="camera-icon"><CameraIcon /></span>
              <span>Start camera</span>
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
