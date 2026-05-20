import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Agent } from "@/api/types";
import { ErrorItem, HandoverDividerItem, RenderableTimelineItem, ThinkingItem, ToolItem } from "@/api/events";
import { AttachmentTray } from "./AttachmentTray";
import { RichText } from "./RichText";
import { colors } from "./theme";

type AgentDisplay = {
  id: string;
  name: string;
  initial: string;
  kind: "agent" | "human";
};

const CHEVRON_CLOSED = "›";
const CHEVRON_OPEN = "⌄";

function resolveAuthor(id: string, agents: Agent[]): AgentDisplay {
  if (id === "__human__") return { id, name: "You", initial: "Y", kind: "human" };
  const agent = agents.find(item => item.id === id);
  if (!agent) return { id, name: id || "Agent", initial: (id || "?")[0].toUpperCase(), kind: "agent" };
  return { id: agent.id, name: agent.name, initial: (agent.name || "?")[0].toUpperCase(), kind: "agent" };
}

function Avatar({ agent, size = 28 }: { agent: AgentDisplay; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.45 }]}>{agent.initial}</Text>
    </View>
  );
}

function ThoughtChip({ thought }: { thought: ThinkingItem }) {
  const [open, setOpen] = React.useState(false);
  return (
    <View style={styles.thoughtWrap}>
      <Pressable style={styles.thoughtChip} onPress={() => setOpen(value => !value)}>
        <Text style={styles.thoughtLabel}>{open ? "Thinking" : "Thought"}</Text>
        <Text style={styles.thoughtCaret}>{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</Text>
      </Pressable>
      {open ? <Text style={styles.eventText}>{thought.reasoning}</Text> : null}
    </View>
  );
}

function ScrollableToolText({ text, style }: { text: string; style?: object }) {
  return (
    <ScrollView
      style={styles.toolScroll}
      contentContainerStyle={styles.toolScrollContent}
      nestedScrollEnabled
      persistentScrollbar
    >
      <Text style={[styles.eventText, style]}>{text}</Text>
    </ScrollView>
  );
}

function HandoverVerb({ subtype }: { subtype?: string }) {
  if (subtype === "return") return <Text> returned to </Text>;
  if (subtype === "escalate") return <Text> escalated to </Text>;
  return <Text> handed off to </Text>;
}

function HandoverDivider({ item, agents }: { item: HandoverDividerItem; agents: Agent[] }) {
  const from = resolveAuthor(item.from, agents);
  const to = resolveAuthor(item.to, agents);
  return (
    <View style={styles.handoverRow}>
      <View style={styles.handoverLine} />
      <View style={styles.handoverChip}>
        <Avatar agent={from} size={18} />
        <Text style={styles.handoverText}>
          <Text style={styles.mutedText}>{from.name}</Text>
          <HandoverVerb subtype={item.subtype} />
          <Text style={styles.strongText}>{to.name}</Text>
          {item.note ? <Text style={styles.mutedText}> · {item.note}</Text> : null}
        </Text>
        <Avatar agent={to} size={18} />
      </View>
      <View style={styles.handoverLine} />
    </View>
  );
}

function ToolLine({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = React.useState(false);
  const detail = tool.output || tool.detail || "";
  const canOpen = Boolean(detail || tool.path.length > 70);
  return (
    <View style={[styles.toolLine, open && styles.toolLineOpen]}>
      <Pressable
        style={styles.toolSummary}
        onPress={() => {
          if (canOpen) setOpen(value => !value);
        }}
      >
        <Text style={[styles.toolCaret, !canOpen && styles.toolCaretMuted]}>{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</Text>
        <Text style={styles.toolName} numberOfLines={1}>{tool.tool}</Text>
        {tool.path ? <Text style={styles.toolDetail} numberOfLines={1}>{tool.path}</Text> : <View style={styles.flex} />}
        <ToolStatus result={tool.result} />
      </Pressable>
      {open ? (
        <View style={styles.toolDetails}>
          {tool.path.length > 70 ? <Text style={styles.toolDetailExpanded}>{tool.path}</Text> : null}
          {detail ? <ScrollableToolText text={detail} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function ToolStatus({ result }: { result: ToolItem["result"] }) {
  if (result === "pending") return <Text style={styles.toolStatus}>running</Text>;
  if (result === "error") {
    return (
      <View style={styles.statusWrap}>
        <View style={[styles.statusDot, styles.statusError]} />
        <Text style={[styles.toolStatus, styles.toolStatusError]}>failed</Text>
      </View>
    );
  }
  return <View style={[styles.statusDot, styles.statusOk]} />;
}

function toolGroupSummary(events: ToolItem[]): string {
  const groups: Array<{ name: string; count: number }> = [];
  const seen = new Map<string, number>();
  for (const event of events) {
    const index = seen.get(event.tool);
    if (index == null) {
      seen.set(event.tool, groups.length);
      groups.push({ name: event.tool, count: 1 });
    } else {
      groups[index].count += 1;
    }
  }
  return groups.map(group => `${group.name}${group.count > 1 ? ` x${group.count}` : ""}`).join(" · ");
}

function ToolGutter({
  author,
  time,
  agents,
  showHeader,
  children
}: {
  author: string;
  time: string;
  agents: Agent[];
  showHeader?: boolean;
  children: React.ReactNode;
}) {
  const agent = resolveAuthor(author, agents);
  return (
    <View style={styles.agentMessageWrap}>
      {showHeader === false ? <View style={styles.avatarSpacer} /> : <Avatar agent={agent} />}
      <View style={styles.agentContent}>
        {showHeader === false ? null : (
          <Text style={styles.agentHeader}>
            <Text style={styles.agentName}>{agent.name}</Text>
            <Text style={styles.meta}> · {time}</Text>
          </Text>
        )}
        {children}
      </View>
    </View>
  );
}

function ToolGroupLine({ item }: { item: Extract<RenderableTimelineItem, { kind: "tool_group" }> }) {
  const [open, setOpen] = React.useState(false);
  const status = item.events.some(event => event.result === "pending")
    ? "pending"
    : item.events.some(event => event.result === "error")
      ? "error"
      : "ok";
  return (
    <View style={[styles.toolGroup, open && styles.toolLineOpen]}>
      <Pressable style={styles.toolSummary} onPress={() => setOpen(value => !value)}>
        <Text style={styles.toolCaret}>{open ? CHEVRON_OPEN : CHEVRON_CLOSED}</Text>
        <Text style={styles.toolGroupTitle}>Used {item.events.length} tools</Text>
        {open ? <View style={styles.flex} /> : <Text style={styles.toolDetail} numberOfLines={1}>{toolGroupSummary(item.events)}</Text>}
        <ToolStatus result={status} />
      </Pressable>
      {open ? (
        <View style={styles.toolGroupDetails}>
          {item.events.map(tool => <ToolLine key={`${tool._seq}:${tool.tool}`} tool={tool} />)}
        </View>
      ) : null}
    </View>
  );
}

function ErrorDetails({ item }: { item: ErrorItem }) {
  const metadata = [item.subtype, item.code].filter(Boolean).join(" · ");
  return (
    <View style={[styles.eventBox, styles.errorBox]}>
      <Text style={styles.meta}>Error · {item.time}</Text>
      {metadata ? <Text style={styles.errorMeta}>{metadata}</Text> : null}
      <Text style={styles.eventText}>{item.message}</Text>
      {item.agent_name || item.target_agent_name ? (
        <Text style={styles.errorMeta}>
          {item.agent_name ? `raised by ${item.agent_name}` : ""}
          {item.agent_name && item.target_agent_name ? " · " : ""}
          {item.target_agent_name ? `target ${item.target_agent_name}` : ""}
        </Text>
      ) : null}
    </View>
  );
}

export function TimelineRow({ item, agents }: { item: RenderableTimelineItem; agents: Agent[] }) {
  if (item.kind === "handover_divider") return <HandoverDivider item={item} agents={agents} />;
  if (item.kind === "message") {
    const agent = resolveAuthor(item.author, agents);
    const mine = agent.kind === "human";
    return (
      <View style={mine ? styles.userMessageWrap : styles.agentMessageWrap}>
        {!mine ? (item.showHeader === false ? <View style={styles.avatarSpacer} /> : <Avatar agent={agent} />) : null}
        <View style={[styles.bubble, mine ? styles.userBubble : styles.agentBubble]}>
          {mine || item.showHeader !== false ? (
            <Text style={styles.meta}>{agent.name} · {item.time}{item.userSteer ? " · Steer" : ""}</Text>
          ) : null}
          {item._thought ? <ThoughtChip thought={item._thought} /> : null}
          <RichText text={item.body} />
          <AttachmentTray attachments={item.attachments} />
        </View>
      </View>
    );
  }
  if (item.kind === "thinking") {
    const agent = resolveAuthor(item.author, agents);
    return (
      <View style={styles.agentMessageWrap}>
        {item.showHeader === false ? <View style={styles.avatarSpacer} /> : <Avatar agent={agent} />}
        <View style={styles.agentContent}>
          <Text style={styles.meta}>{agent.name} · thinking · {item.time}</Text>
          <ThoughtChip thought={item} />
        </View>
      </View>
    );
  }
  if (item.kind === "tool") {
    return (
      <ToolGutter author={item.author} time={item.time} agents={agents} showHeader={item.showHeader}>
        <ToolLine tool={item} />
      </ToolGutter>
    );
  }
  if (item.kind === "tool_group") {
    return (
      <ToolGutter author={item.author} time={item.time} agents={agents} showHeader={item.showHeader}>
        <ToolGroupLine item={item} />
      </ToolGutter>
    );
  }
  if (item.kind === "tool_result") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>{item.name || "Tool"} result · {item.time}</Text>
        <ScrollableToolText text={item.output} />
      </View>
    );
  }
  if (item.kind === "error") return <ErrorDetails item={item} />;
  return null;
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2
  },
  avatarText: {
    color: "#FCFBF7",
    fontWeight: "700"
  },
  userMessageWrap: {
    alignItems: "flex-end"
  },
  agentMessageWrap: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start"
  },
  avatarSpacer: {
    width: 28,
    flexShrink: 0
  },
  agentContent: {
    flex: 1,
    minWidth: 0
  },
  agentHeader: {
    marginBottom: 4
  },
  agentName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  bubble: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    maxWidth: "92%"
  },
  userBubble: {
    backgroundColor: "#EDF4EC",
    borderColor: "#D1E5CF"
  },
  agentBubble: {
    flex: 1,
    backgroundColor: colors.panel,
    borderColor: colors.border
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    marginBottom: 5,
    fontWeight: "600"
  },
  eventBox: {
    backgroundColor: colors.soft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 11
  },
  eventText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19
  },
  thoughtWrap: {
    marginBottom: 8,
    gap: 7
  },
  thoughtChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.soft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  thoughtLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600"
  },
  thoughtCaret: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  handoverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6
  },
  handoverLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border
  },
  handoverChip: {
    maxWidth: "82%",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 7
  },
  handoverText: {
    color: colors.muted,
    fontSize: 12,
    flexShrink: 1
  },
  mutedText: {
    color: colors.muted
  },
  strongText: {
    color: colors.text,
    fontWeight: "700"
  },
  flex: {
    flex: 1
  },
  toolGroup: {
    borderRadius: 6,
    overflow: "hidden"
  },
  toolLine: {
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "transparent"
  },
  toolLineOpen: {
    borderColor: "#EFE8D8",
    backgroundColor: "#FFFDF7",
    marginLeft: 10
  },
  toolSummary: {
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  toolCaret: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    width: 12
  },
  toolCaretMuted: {
    opacity: 0.35
  },
  toolGroupDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border
  },
  toolDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#EFE8D8",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 6
  },
  toolScroll: {
    maxHeight: 220
  },
  toolScrollContent: {
    paddingRight: 8
  },
  toolName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined })
  },
  toolGroupTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600"
  },
  toolDetail: {
    color: colors.muted,
    flex: 1,
    minWidth: 0,
    fontSize: 12
  },
  toolDetailExpanded: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: undefined })
  },
  toolStatus: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  toolStatusError: {
    color: colors.danger
  },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0
  },
  statusOk: {
    backgroundColor: "#6E9E5B"
  },
  statusError: {
    backgroundColor: colors.danger
  },
  errorBox: {
    borderColor: "#E7B8AA"
  },
  errorMeta: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4
  }
});
