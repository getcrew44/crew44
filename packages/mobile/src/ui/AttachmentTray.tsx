import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { MessageAttachment } from "@/api/types";
import { colors } from "./theme";

function extensionForName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toUpperCase() : "";
}

function AttachmentThumb({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.kind === "image" && attachment.thumbnail_jpeg_base64) {
    return (
      <Image
        source={{ uri: `data:image/jpeg;base64,${attachment.thumbnail_jpeg_base64}` }}
        style={styles.thumbImage}
      />
    );
  }
  return (
    <View style={[styles.thumbGlyph, attachment.thumbnail_failed && styles.failedThumb]}>
      <Text style={[styles.thumbText, attachment.thumbnail_failed && styles.failedText]}>
        {attachment.kind === "folder" ? "F" : attachment.thumbnail_failed ? "!" : "D"}
      </Text>
    </View>
  );
}

export function AttachmentTray({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <View style={styles.wrap}>
      {attachments.map(attachment => (
        <View key={attachment.path} style={styles.chip}>
          <AttachmentThumb attachment={attachment} />
          <View style={styles.meta}>
            <Text style={styles.name} numberOfLines={1}>{attachment.display_name}</Text>
            <Text style={styles.kind} numberOfLines={1}>{extensionForName(attachment.display_name) || attachment.kind}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8
  },
  chip: {
    maxWidth: 210,
    minHeight: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.soft,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  thumbImage: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#F1EBDC"
  },
  thumbGlyph: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#F1EBDC",
    alignItems: "center",
    justifyContent: "center"
  },
  failedThumb: {
    backgroundColor: "#F9E8E2"
  },
  thumbText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  failedText: {
    color: colors.danger
  },
  meta: {
    minWidth: 0,
    flex: 1
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600"
  },
  kind: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2
  }
});
