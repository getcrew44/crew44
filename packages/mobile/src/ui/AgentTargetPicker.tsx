import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Agent } from "@/api/types";
import { colors } from "./theme";

function initialFor(agent?: Agent): string {
  return (agent?.name || "?")[0].toUpperCase();
}

function AgentAvatar({ agent, size = 20 }: { agent?: Agent; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.45 }]}>{initialFor(agent)}</Text>
    </View>
  );
}

const CHEVRON_DOWN = "⌄";
const CHECK = "✓";

export function AgentTargetPicker({
  agents,
  value,
  onChange,
  disabled = false
}: {
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = agents.find(agent => agent.id === value) || agents[0];
  if (!selected) return null;

  return (
    <View style={styles.wrap}>
      {open ? (
        <View style={styles.menu}>
          <Text style={styles.menuLabel}>Direct to</Text>
          {agents.map(agent => {
            const active = agent.id === selected.id;
            return (
              <Pressable
                key={agent.id}
                style={[styles.menuItem, active && styles.menuItemActive]}
                onPress={() => {
                  onChange(agent.id);
                  setOpen(false);
                }}
              >
                <AgentAvatar agent={agent} size={22} />
                <Text style={styles.menuName} numberOfLines={1}>{agent.name}</Text>
                {active ? <Text style={styles.check}>{CHECK}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Pressable
        style={[styles.chip, disabled && styles.disabled]}
        disabled={disabled}
        onPress={() => setOpen(value => !value)}
      >
        <AgentAvatar agent={selected} size={20} />
        <Text style={styles.name} numberOfLines={1}>{selected.name}</Text>
        <Text style={styles.caret}>{CHEVRON_DOWN}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    alignSelf: "flex-start",
    zIndex: 20
  },
  chip: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 190
  },
  disabled: {
    opacity: 0.65
  },
  avatar: {
    backgroundColor: "#A9A256",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0
  },
  avatarText: {
    color: "#FCFBF7",
    fontWeight: "800"
  },
  name: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    flexShrink: 1
  },
  caret: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  menu: {
    position: "absolute",
    left: 0,
    bottom: 36,
    width: 230,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 5,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  menuLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    paddingHorizontal: 8,
    paddingTop: 5,
    paddingBottom: 3
  },
  menuItem: {
    minHeight: 38,
    borderRadius: 6,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  menuItemActive: {
    backgroundColor: "#F7EFDD"
  },
  menuName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    flex: 1
  },
  check: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800"
  }
});
