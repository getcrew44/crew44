import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "./theme";

export function Screen({ children }: { children: React.ReactNode }) {
  return <SafeAreaView style={styles.screen}>{children}</SafeAreaView>;
}

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const isPrimary = variant === "primary";
  const isDanger = variant === "danger";
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        isPrimary && styles.primaryButton,
        !isPrimary && styles.secondaryButton,
        isDanger && styles.dangerButton,
        disabled && styles.disabled
      ]}
    >
      <Text style={[styles.buttonText, isPrimary && styles.primaryButtonText, isDanger && styles.dangerButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      <Text style={styles.emptyBody}>{label}</Text>
    </View>
  );
}

export function Row({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.page,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: "700"
  },
  button: {
    minHeight: 38,
    borderRadius: 7,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1
  },
  primaryButton: {
    backgroundColor: colors.text,
    borderColor: colors.text
  },
  secondaryButton: {
    backgroundColor: colors.panel,
    borderColor: colors.border
  },
  dangerButton: {
    backgroundColor: colors.panel,
    borderColor: "#E7B8AA"
  },
  disabled: {
    opacity: 0.55
  },
  buttonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  primaryButtonText: {
    color: "#FCFBF7"
  },
  dangerButtonText: {
    color: colors.danger
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    gap: 10
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center"
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  row: {
    minHeight: 68,
    paddingHorizontal: spacing.page,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600"
  },
  rowSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3
  },
  chevron: {
    color: colors.muted,
    fontSize: 26,
    lineHeight: 28
  }
});
