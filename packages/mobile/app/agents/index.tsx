import React from "react";
import { router } from "expo-router";
import { FlatList, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Agent } from "@/api/types";
import { Button, EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";

export default function AgentsScreen() {
  const { api, disconnect } = useMobileClient();
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

  return (
    <Screen>
      <Header
        title="Agents"
        right={<Button label="Projects" variant="secondary" onPress={() => router.push("/projects")} />}
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
