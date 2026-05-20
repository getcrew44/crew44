import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Screen";
import { colors } from "./theme";

function OfflineComputer() {
  return (
    <View style={styles.offlineArt} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.monitor}>
        <View style={styles.monitorFace}>
          <View style={styles.eyeRow}>
            <View style={styles.eye} />
            <View style={styles.eye} />
          </View>
          <View style={styles.sleepLine} />
        </View>
      </View>
      <View style={styles.stand} />
      <View style={styles.base} />
      <View style={styles.cord}>
        <View style={styles.plugProng} />
        <View style={styles.plugProng} />
      </View>
    </View>
  );
}

export function OtherOptions({ onUnpair }: { onUnpair: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={styles.otherOptions}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={styles.otherButton}
      >
        <Text style={styles.otherText}>Other options</Text>
      </Pressable>
      {open ? <Button label="Unpair" variant="danger" onPress={onUnpair} /> : null}
    </View>
  );
}

export function DesktopOfflineState({
  title = "Desktop offline",
  message,
  onRetry,
  onUnpair
}: {
  title?: string;
  message?: string;
  onRetry: () => void;
  onUnpair: () => void;
}) {
  return (
    <View style={styles.offlineBody}>
      <OfflineComputer />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>
        {message || "The relay cannot reach your paired desktop right now."}
      </Text>
      <View style={styles.actions}>
        <Button label="Retry" onPress={onRetry} />
        <OtherOptions onUnpair={onUnpair} />
      </View>
    </View>
  );
}

export function ConnectingDesktopState({
  label = "Connecting to desktop...",
  onUnpair,
  showOtherOptions = false
}: {
  label?: string;
  onUnpair: () => void;
  showOtherOptions?: boolean;
}) {
  return (
    <View style={styles.connectingBody}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.body}>{label}</Text>
      {showOtherOptions ? <OtherOptions onUnpair={onUnpair} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  offlineBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12
  },
  connectingBody: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 12
  },
  offlineArt: {
    width: 190,
    height: 150,
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: 6
  },
  monitor: {
    width: 132,
    height: 88,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.text,
    backgroundColor: colors.panel,
    alignItems: "center",
    justifyContent: "center"
  },
  monitorFace: {
    width: 74,
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.soft,
    alignItems: "center",
    justifyContent: "center",
    gap: 8
  },
  eyeRow: {
    flexDirection: "row",
    gap: 20
  },
  eye: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.muted
  },
  sleepLine: {
    width: 28,
    height: 4,
    borderRadius: 4,
    backgroundColor: colors.muted
  },
  stand: {
    width: 18,
    height: 24,
    backgroundColor: colors.text
  },
  base: {
    width: 76,
    height: 10,
    borderRadius: 8,
    backgroundColor: colors.text
  },
  cord: {
    position: "absolute",
    right: 18,
    bottom: 18,
    width: 36,
    height: 22,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: colors.muted,
    borderBottomRightRadius: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "flex-end",
    gap: 3,
    paddingRight: 1
  },
  plugProng: {
    width: 3,
    height: 9,
    backgroundColor: colors.muted,
    borderRadius: 2,
    marginBottom: -7
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center"
  },
  body: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 280
  },
  actions: {
    width: "100%",
    maxWidth: 280,
    gap: 10,
    marginTop: 6
  },
  otherOptions: {
    gap: 10
  },
  otherButton: {
    minHeight: 38,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center"
  },
  otherText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600"
  }
});
