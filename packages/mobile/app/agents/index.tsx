import React from "react";
import { router } from "expo-router";
import { FlatList, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Agent } from "@/api/types";
import { DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { BackButton, Button, EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";
import { goBackOrHome } from "@/ui/navigation";

export default function AgentsScreen() {
  const { api, status, error: connectionError, connectionIssue, reconnect, disconnect } = useMobileClient();
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError("");
    try {
      setAgents(await api.listAgents());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (status === "error" && !api) {
    return (
      <Screen>
        <Header
          title="Agents"
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
        title="Agents"
        left={<BackButton onPress={goBackOrHome} />}
      />
      {loading ? <LoadingState /> : error ? (
        <View style={{ flex: 1 }}>
          <EmptyState title="Could not load agents" body={error} />
          <View style={{ padding: 18 }}>
            <Button label="Forget Pairing" variant="danger" onPress={disconnect} />
          </View>
        </View>
      ) : agents.length === 0 ? (
        <EmptyState title="No agents yet" body="Create agents in the desktop app." />
      ) : (
        <FlatList
          data={agents}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Row
              title={item.name}
              subtitle={`${item.runtime_id || "runtime"} · ${item.model || "model not set"}`}
              onPress={() => router.push(`/agents/${item.id}`)}
            />
          )}
          refreshing={loading}
          onRefresh={load}
        />
      )}
    </Screen>
  );
}
