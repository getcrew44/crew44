import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { colors } from "./theme";

export function DisclosureChevron({
  open,
  muted = false,
  style
}: {
  open?: boolean;
  muted?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.wrap, muted && styles.muted, style]} pointerEvents="none">
      <View style={[styles.mark, open ? styles.open : styles.closed]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  mark: {
    width: 7,
    height: 7,
    borderRightWidth: 1.4,
    borderBottomWidth: 1.4,
    borderColor: colors.muted
  },
  closed: {
    transform: [{ rotate: "-45deg" }]
  },
  open: {
    transform: [{ rotate: "45deg" }]
  },
  muted: {
    opacity: 0.35
  }
});
