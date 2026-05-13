import React from "react";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, Header, Screen } from "@/ui/Screen";
import { colors } from "@/ui/theme";

export default function PairScreen() {
  const client = useMobileClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualText, setManualText] = React.useState("");
  const [scannerActive, setScannerActive] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (client.status === "online") router.replace("/projects");
  }, [client.status]);

  const pair = React.useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    setScannerActive(false);
    setError("");
    try {
      await client.pairWithQrText(raw.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
      setScannerActive(true);
    }
  }, [client]);

  return (
    <Screen>
      <Header title="Pair device" />
      <View style={styles.body}>
        <Text style={styles.copy}>Scan the QR code from CrewAI Desktop's Pair Mobile dialog.</Text>
        <View style={styles.cameraBox}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={scannerActive ? event => pair(event.data) : undefined}
            />
          ) : (
            <View style={styles.cameraEmpty}>
              <Text style={styles.copy}>Camera permission is needed for QR pairing.</Text>
              <Button label="Allow camera" onPress={requestPermission} />
            </View>
          )}
        </View>
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
        {error || client.error ? <Text style={styles.error}>{error || client.error}</Text> : null}
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
