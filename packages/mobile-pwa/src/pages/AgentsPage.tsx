import React from "react";
import { Agent } from "@/api/types";
import { useMobileClient } from "@/client/MobileClientProvider";
import { EmptyState, Header, IconButton, LoadingState, OfflineState, Row, Screen } from "@/ui/Screen";
import { BackIcon } from "@/ui/icons";

export function AgentsPage({ navigate }: { navigate: (path: string) => void }) {
  const client = useMobileClient();
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!client.api) return;
    setLoading(true);
    setError("");
    try {
      setAgents(await client.api.listAgents());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, [client.api]);

  React.useEffect(() => {
    load();
  }, [load]);

  if (client.status === "error" && !client.api) {
    return (
      <Screen>
        <Header title="Agents" left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>} />
        <OfflineState
          title={client.connectionIssue === "relay" ? "Relay connection issue" : "Can't connect to the Crew44 desktop"}
          message={client.error}
          onRetry={client.reconnect}
          onUnpair={client.disconnect}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Agents" left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>} />
      {loading ? <LoadingState /> : error ? (
        <EmptyState title="Could not load agents" body={error} />
      ) : agents.length === 0 ? (
        <EmptyState title="No agents yet" body="Create agents in the desktop app." />
      ) : (
        <div className="list">
          {agents.map(agent => (
            <Row
              key={agent.id}
              title={agent.name}
              subtitle={`${agent.runtime_id || "runtime"} · ${agent.model || "model not set"}`}
              onClick={() => navigate(`/agents/${agent.id}`)}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}
