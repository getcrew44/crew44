import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { MessageAttachment } from "@/api/types";
import { colors } from "./theme";

function extensionForName(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toUpperCase() : "";
}

function displayName(attachment: MessageAttachment): string {
  if (attachment.display_name) return attachment.display_name;
  const parts = attachment.path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || attachment.path || "Attachment";
}

function FileGlyph({ failed = false }: { failed?: boolean }) {
  return (
    <View style={[styles.fileGlyph, failed && styles.failedThumb]}>
      <View style={styles.fileFold} />
      <View style={[styles.fileLine, failed && styles.failedLine]} />
      <View style={[styles.fileLineShort, failed && styles.failedLine]} />
    </View>
  );
}

function FolderGlyph() {
  return (
    <View style={styles.folderGlyph}>
      <View style={styles.folderTab} />
      <View style={styles.folderBody} />
    </View>
  );
}

function AttachmentThumb({ attachment }: { attachment: MessageAttachment }) {
  if (attachment.kind === "folder") return <FolderGlyph />;
  if (attachment.kind === "image" && attachment.thumbnail_jpeg_base64) {
    return (
      <Image
        source={{ uri: `data:image/jpeg;base64,${attachment.thumbnail_jpeg_base64}` }}
        style={styles.thumbImage}
      />
    );
  }
  return <FileGlyph failed={attachment.kind === "image" && attachment.thumbnail_failed} />;
}

export function AttachmentTray({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;
  return (
    <View style={styles.wrap}>
      {attachments.map(attachment => {
        const name = displayName(attachment);
        return (
          <View key={attachment.path || name} style={styles.chip}>
            <AttachmentThumb attachment={attachment} />
            <View style={styles.meta}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.kind} numberOfLines={1}>{extensionForName(name) || attachment.kind}</Text>
            </View>
          </View>
        );
      })}
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
    width: "100%",
    maxWidth: 260,
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
  fileGlyph: {
    width: 34,
    height: 34,
    borderRadius: 7,
    borderWidth: 1.4,
    borderColor: colors.muted,
    backgroundColor: "#F1EBDC",
    position: "relative",
    flexShrink: 0
  },
  fileFold: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderLeftWidth: 1.4,
    borderBottomWidth: 1.4,
    borderColor: colors.muted,
    backgroundColor: colors.panel
  },
  fileLine: {
    position: "absolute",
    left: 7,
    right: 7,
    top: 18,
    height: 1.4,
    backgroundColor: colors.muted
  },
  fileLineShort: {
    position: "absolute",
    left: 7,
    right: 13,
    top: 23,
    height: 1.4,
    backgroundColor: colors.muted
  },
  folderGlyph: {
    width: 34,
    height: 34,
    position: "relative",
    flexShrink: 0
  },
  folderTab: {
    position: "absolute",
    top: 8,
    left: 4,
    width: 12,
    height: 7,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    backgroundColor: "#E7DCC0",
    borderWidth: 1.4,
    borderColor: colors.muted,
    borderBottomWidth: 0
  },
  folderBody: {
    position: "absolute",
    top: 13,
    left: 3,
    right: 3,
    bottom: 6,
    borderRadius: 5,
    backgroundColor: "#F1EBDC",
    borderWidth: 1.4,
    borderColor: colors.muted
  },
  failedThumb: {
    backgroundColor: "#F9E8E2",
    borderColor: colors.danger
  },
  failedLine: {
    backgroundColor: colors.danger
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
