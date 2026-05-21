import React from "react";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, Header, Screen } from "@/ui/Screen";
import { colors } from "@/ui/theme";

const cameraIdleMs = 60000;

export default function PairScreen() {
  const client = useMobileClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualText, setManualText] = React.useState("");
  const [scannerActive, setScannerActive] = React.useState(true);
  const [pairing, setPairing] = React.useState(false);
  const [cameraPaused, setCameraPaused] = React.useState(false);
  const [error, setError] = React.useState("");
  const scanInFlightRef = React.useRef(false);
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const unpairNotice = client.error.startsWith("Also unpair") ? client.error : "";
  const pairError = error || (unpairNotice ? "" : client.error);

  React.useEffect(() => {
    if (client.status === "online") router.replace("/");
  }, [client.status]);

  const stopIdleTimer = React.useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const cameraRunning = Boolean(permission?.granted && scannerActive && !pairing && !cameraPaused);

  React.useEffect(() => {
    stopIdleTimer();
    if (!cameraRunning) return undefined;
    idleTimerRef.current = setTimeout(() => {
      setCameraPaused(true);
      setScannerActive(false);
    }, cameraIdleMs);
    return stopIdleTimer;
  }, [cameraRunning, stopIdleTimer]);

  const pair = React.useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    stopIdleTimer();
    setScannerActive(false);
    setPairing(true);
    setCameraPaused(false);
    setError("");
    try {
      await client.pairWithQrText(raw.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      scanInFlightRef.current = false;
      setPairing(false);
      setScannerActive(true);
    }
  }, [client, stopIdleTimer]);

  const resumeCamera = React.useCallback(() => {
    if (!cameraPaused) return;
    scanInFlightRef.current = false;
    setError("");
    setPairing(false);
    setCameraPaused(false);
    setScannerActive(true);
  }, [cameraPaused]);

  return (
    <Screen>
      <Header title="Pair device" />
      <View style={styles.body}>
        <Text style={styles.copy}>Scan the QR code from Crew44's Pair Mobile dialog.</Text>
        <Pressable style={styles.cameraBox} onPress={resumeCamera}>
          {permission?.granted ? (
            cameraRunning ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={event => pair(event.data)}
              />
            ) : pairing ? (
              <View style={styles.cameraEmpty}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.copy}>Pairing...</Text>
              </View>
            ) : cameraPaused ? (
              <View style={styles.cameraEmpty}>
                <Text style={styles.copy}>Camera paused.</Text>
                <Text style={styles.cameraHint}>Tap the scan area to resume.</Text>
              </View>
            ) : (
              <View style={styles.cameraEmpty}>
                <Text style={styles.copy}>Scanner paused.</Text>
              </View>
            )
          ) : (
            <View style={styles.cameraEmpty}>
              <Text style={styles.copy}>Camera permission is needed for QR pairing.</Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          )}
        </Pressable>
        <TextInput
          value={manualText}
          onChangeText={setManualText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Or paste QR payload JSON"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        {pairError ? <Text style={styles.error}>{pairError}</Text> : null}
        {unpairNotice ? <Text style={styles.notice}>{unpairNotice}</Text> : null}
        <Button
          label={client.status === "connecting" ? "Pairing..." : "Pair from pasted text"}
          disabled={client.status === "connecting"}
          onPress={() => pair(manualText)}
        />
        {client.profile ? (
          <Pressable onPress={client.disconnect} style={styles.linkButton}>
            <Text style={styles.linkText}>Forget saved pairing</Text>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    padding: 18,
    gap: 14
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  cameraBox: {
    height: 300,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border
  },
  cameraEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 12
  },
  cameraHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  input: {
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    color: colors.text,
    padding: 12,
    textAlignVertical: "top",
    fontSize: 13
  },
  error: {
    color: colors.danger,
    fontSize: 13
  },
  notice: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  linkButton: {
    alignItems: "center",
    padding: 8
  },
  linkText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "600"
  }
});
