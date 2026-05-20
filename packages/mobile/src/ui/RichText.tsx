import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "file"; value: string }
  | { kind: "ref"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; label: string; url: string };

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "code"; lines: string[]; lang: string }
  | { kind: "ul" | "ol"; items: string[] };

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /\{\{(file|ref):([^}]+)\}\}|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) tokens.push({ kind: "text", value: text.slice(last, match.index) });
    if (match[1] === "file") tokens.push({ kind: "file", value: match[2] });
    else if (match[1] === "ref") tokens.push({ kind: "ref", value: match[2] });
    else if (match[3] != null) tokens.push({ kind: "link", label: match[3], url: match[4] });
    else if (match[5] != null) tokens.push({ kind: "bold", value: match[5] });
    else if (match[6] != null) tokens.push({ kind: "italic", value: match[6] });
    else if (match[7] != null) tokens.push({ kind: "code", value: match[7] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ kind: "text", value: text.slice(last) });
  return tokens;
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: "ul" | "ol" }> | null = null;
  let fence: { lang: string; lines: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (const raw of lines) {
    const fenceMatch = raw.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      if (fenceMatch) {
        blocks.push({ kind: "code", lang: fence.lang, lines: fence.lines });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }
    if (fenceMatch) {
      flushPara();
      flushList();
      fence = { lang: fenceMatch[1] || "", lines: [] };
      continue;
    }

    const line = raw.replace(/\s+$/, "");
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bullet = /^\s*[-*]\s+/.test(line);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    const hr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
    } else if (hr) {
      flushPara();
      flushList();
      blocks.push({ kind: "hr" });
    } else if (bullet) {
      flushPara();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (numbered) {
      flushPara();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  if (fence) blocks.push({ kind: "code", lang: fence.lang, lines: fence.lines });
  flushPara();
  flushList();
  return blocks;
}

function InlineText({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={style}>
      {parseInline(text).map((token, index) => {
        if (token.kind === "bold") return <Text key={index} style={styles.bold}>{token.value}</Text>;
        if (token.kind === "italic") return <Text key={index} style={styles.italic}>{token.value}</Text>;
        if (token.kind === "code" || token.kind === "file") return <Text key={index} style={styles.inlineCode}>{token.value}</Text>;
        if (token.kind === "ref") return <Text key={index} style={styles.ref}>@{token.value}</Text>;
        if (token.kind === "link") {
          return (
            <Text key={index} style={styles.link} onPress={() => Linking.openURL(token.url).catch(() => {})}>
              {token.label}
            </Text>
          );
        }
        return <Text key={index}>{token.value}</Text>;
      })}
    </Text>
  );
}

function Paragraph({ lines, compact }: { lines: string[]; compact?: boolean }) {
  return (
    <Text style={[styles.text, !compact && styles.block]}>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 ? "\n" : ""}
          <InlineText text={line} />
        </React.Fragment>
      ))}
    </Text>
  );
}

export function RichText({ text }: { text: string }) {
  if (!text) return null;
  const blocks = parseBlocks(text);
  if (blocks.length === 1 && blocks[0].kind === "p") {
    return <Paragraph lines={blocks[0].lines} compact />;
  }
  return (
    <View>
      {blocks.map((block, index) => {
        if (block.kind === "h") {
          return <InlineText key={index} text={block.text} style={[styles.heading, block.level > 2 && styles.smallHeading]} />;
        }
        if (block.kind === "hr") return <View key={index} style={styles.rule} />;
        if (block.kind === "code") {
          return (
            <Text key={index} style={styles.codeBlock}>
              {block.lines.join("\n")}
            </Text>
          );
        }
        if (block.kind === "p") return <Paragraph key={index} lines={block.lines} />;
        if (block.kind === "ul" || block.kind === "ol") {
          return (
            <View key={index} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={itemIndex} style={styles.listRow}>
                  <Text style={styles.listMarker}>{block.kind === "ol" ? `${itemIndex + 1}.` : "•"}</Text>
                  <InlineText text={item} style={styles.listText} />
                </View>
              ))}
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  text: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21
  },
  block: {
    marginBottom: 8
  },
  bold: {
    fontWeight: "700",
    color: colors.text
  },
  italic: {
    fontStyle: "italic"
  },
  inlineCode: {
    fontFamily: "Courier",
    fontSize: 13,
    color: colors.text,
    backgroundColor: "#ECE6D5"
  },
  ref: {
    color: "#C4644A",
    fontWeight: "700"
  },
  link: {
    color: "#2F79D8",
    textDecorationLine: "underline"
  },
  heading: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700",
    marginBottom: 8
  },
  smallHeading: {
    fontSize: 16,
    lineHeight: 22
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 10
  },
  codeBlock: {
    color: colors.text,
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: "#F4EFE0",
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8
  },
  list: {
    gap: 3,
    marginBottom: 8
  },
  listRow: {
    flexDirection: "row",
    gap: 7
  },
  listMarker: {
    color: colors.muted,
    width: 20,
    fontSize: 15,
    lineHeight: 21,
    textAlign: "right"
  },
  listText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21
  }
});
