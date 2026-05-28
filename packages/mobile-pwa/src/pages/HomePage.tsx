import React from "react";
import { Project } from "@/api/types";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, EmptyState, Header, LoadingState, OfflineState, Row, Screen } from "@/ui/Screen";
import { MoreIcon } from "@/ui/icons";

export function HomePage({ navigate }: { navigate: (path: string) => void }) {
  const client = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!client.api) return;
    setLoading(true);
    setError("");
    try {
      setProjects(await client.api.listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
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
        <Header title="Crew44 Mobile" />
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
      <Header
        title="Crew44"
        right={
          <div className="menu-host">
            <button type="button" className="icon-button" aria-label="More options" onClick={() => setMenuOpen(value => !value)}>
              <MoreIcon />
            </button>
            {menuOpen ? (
              <div className="menu">
                <button type="button" onClick={() => { setMenuOpen(false); navigate("/agents"); }}>Agents</button>
                <button type="button" className="danger" onClick={() => client.disconnect().catch(() => {})}>Unpair</button>
              </div>
            ) : null}
          </div>
        }
      />
      <div className="status-row">
        <span className="online-dot" />
        <span>{client.profile?.desktopName || "Desktop online"}</span>
      </div>
      <h2 className="section-title">Projects</h2>
      {loading ? <LoadingState /> : error ? (
        <EmptyState title="Could not load projects" body={error}>
          <Button onClick={load}>Retry</Button>
        </EmptyState>
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" body="Create or add a project in the desktop app, then refresh." />
      ) : (
        <div className="list">
          {projects.map(project => (
            <Row
              key={project.id}
              title={project.name}
              subtitle={project.workdir}
              onClick={() => navigate(`/projects/${project.id}`)}
            />
          ))}
        </div>
      )}
    </Screen>
  );
}
