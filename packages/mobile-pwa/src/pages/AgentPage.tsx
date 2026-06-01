import React from "react";
import { Agent } from "@/api/types";
import { connectionIssueTitle } from "@/client/connectionIssue";
import { useMobileClient } from "@/client/MobileClientProvider";
import { EmptyState, Header, IconButton, LoadingState, OfflineState, Screen } from "@/ui/Screen";
import { BackIcon } from "@/ui/icons";

export function AgentPage({
  agentId,
  navigate
}: {
  agentId: string;
  navigate: (path: string) => void;
}) {
  const client = useMobileClient();
  const [agent, setAgent] = React.useState<Agent | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!client.api) return;
      setLoading(true);
      setError("");
      try {
        const agents = await client.api.listAgents();
        if (!cancelled) setAgent(agents.find(item => item.id === agentId) || null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load agent");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [agentId, client.api]);

  if (client.status === "error" && !client.api) {
    return (
      <Screen>
        <Header title="Agent" left={<IconButton label="Back" onClick={() => navigate("/agents")}><BackIcon /></IconButton>} />
        <OfflineState
          title={connectionIssueTitle(client.connectionIssue)}
          message={client.error}
          onRetry={client.reconnect}
          onUnpair={client.disconnect}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={agent?.name || "Agent"} left={<IconButton label="Back" onClick={() => navigate("/agents")}><BackIcon /></IconButton>} />
      {loading ? <LoadingState /> : error ? (
        <EmptyState title="Could not load agent" body={error} />
      ) : !agent ? (
        <EmptyState title="Agent not found" />
      ) : (
        <section className="agent-detail">
          <div className="detail-card">
            <span>Runtime</span>
            <strong>{agent.runtime_id || "Not set"}</strong>
          </div>
          <div className="detail-card">
            <span>Model</span>
            <strong>{agent.model || "Not set"}</strong>
          </div>
          <div className="detail-card">
            <span>Skills</span>
            <strong>{agent.skill_ids.length ? agent.skill_ids.join(", ") : "None"}</strong>
          </div>
          <div className="detail-card">
            <span>Instruction</span>
            <p>{agent.instruction || "No instruction set."}</p>
          </div>
        </section>
      )}
    </Screen>
  );
}
