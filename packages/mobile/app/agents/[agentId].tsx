import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Agent } from "@/api/types";
import { DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { BackButton, EmptyState, Header, LoadingState, Screen } from "@/ui/Screen";
import { goBackOrHome } from "@/ui/navigation";
import { colors } from "@/ui/theme";

export default function AgentDetailScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const { api, status, error: connectionError, connectionIssue, reconnect, disconnect } = useMobileClient();
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!api || !agentId) return;
    setLoading(true);
    api.listAgents()
      .then(agents => {
        const found = agents.find(item => item.id === agentId) || null;
        setAgent(found);
        if (!found) setError("Agent not found");
      })
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load agent"))
      .finally(() => setLoading(false));
  }, [agentId, api]);

  if (status === "error" && !api) {
    return (
      <Screen>
        <Header
          title={agent?.name || "Agent"}
          left={<BackButton onPress={goBackOrHome} />}
        />
        <DesktopOfflineState
          title={connectionIssue === "relay" ? "Relay connection issue" : "Desktop offline"}
          message={connectionError}
          onRetry={reconnect}
          onUnpair={disconnect}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header
        title={agent?.name || "Agent"}
        left={<BackButton onPress={goBackOrHome} />}
      />
      {loading ? <LoadingState /> : error || !agent ? (
        <EmptyState title="Could not load agent" body={error} />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Info label="Runtime" value={agent.runtime_id || "Not set"} />
          <Info label="Model" value={agent.model || "Not set"} />
          <Info label="Skills" value={agent.skill_ids.length ? agent.skill_ids.join(", ") : "None"} />
          <View style={styles.section}>
            <Text style={styles.label}>Instruction</Text>
            <Text style={styles.instruction}>{agent.instruction || "No instruction set."}</Text>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: 18,
    gap: 12
  },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.panel,
    padding: 14
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: 7
  },
  value: {
    color: colors.text,
    fontSize: 15
  },
  instruction: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21
  }
});
