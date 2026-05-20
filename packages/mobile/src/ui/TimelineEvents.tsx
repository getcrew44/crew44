import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
        <Text style={styles.thoughtCaret}>{open ? "v" : ">"}</Text>
      </Pressable>
      {open ? <Text style={styles.eventText}>{thought.reasoning}</Text> : null}
    </View>
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
  return (
    <View style={styles.toolLine}>
      <Text style={styles.toolName}>{tool.tool}</Text>
      {tool.path ? <Text style={styles.toolDetail} numberOfLines={2}>{tool.path}</Text> : null}
      <Text style={styles.toolStatus}>{tool.result === "pending" ? "running" : tool.result}</Text>
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
        {!mine ? <Avatar agent={agent} /> : null}
        <View style={[styles.bubble, mine ? styles.userBubble : styles.agentBubble]}>
          <Text style={styles.meta}>{agent.name} · {item.time}{item.userSteer ? " · Steer" : ""}</Text>
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
        <Avatar agent={agent} />
        <View style={styles.eventBox}>
          <Text style={styles.meta}>{agent.name} · thinking · {item.time}</Text>
          <ThoughtChip thought={item} />
        </View>
      </View>
    );
  }
  if (item.kind === "tool") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>Tool · {item.time}</Text>
        <ToolLine tool={item} />
        {item.output ? <Text style={styles.eventText} numberOfLines={6}>{item.output}</Text> : null}
      </View>
    );
  }
  if (item.kind === "tool_group") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>Tools · {item.time}</Text>
        {item.events.map(tool => <ToolLine key={`${tool._seq}:${tool.tool}`} tool={tool} />)}
      </View>
    );
  }
  if (item.kind === "tool_result") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>{item.name || "Tool"} result · {item.time}</Text>
        <Text style={styles.eventText} numberOfLines={8}>{item.output}</Text>
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
  toolLine: {
    gap: 3,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  toolName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700"
  },
  toolDetail: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  toolStatus: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
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
