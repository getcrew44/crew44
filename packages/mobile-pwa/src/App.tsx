import React from "react";
import { useMobileClient } from "@/client/MobileClientProvider";
import { AgentPage } from "@/pages/AgentPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { ChatPage } from "@/pages/ChatPage";
import { HomePage } from "@/pages/HomePage";
import { PairPage } from "@/pages/PairPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { Header, LoadingState, Screen } from "@/ui/Screen";

function currentPath(): string {
  return window.location.hash.replace(/^#/, "") || "/";
}

function useHashRoute() {
  const [path, setPath] = React.useState(currentPath);
  React.useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = React.useCallback((nextPath: string) => {
    window.location.hash = nextPath;
    setPath(nextPath);
  }, []);
  return { path, navigate };
}

export default function App() {
  const client = useMobileClient();
  const { path, navigate } = useHashRoute();

  React.useEffect(() => {
    if (client.status === "unpaired" && path !== "/pair") navigate("/pair");
    if (client.status === "online" && path === "/pair") navigate("/");
  }, [client.status, navigate, path]);

  if (client.status === "loading" || client.status === "connecting" || client.status === "reconnecting") {
    return (
      <Screen>
        <Header title="Crew44 Mobile" />
        <LoadingState label={client.status === "reconnecting" ? "Reconnecting to relay..." : "Connecting to the Crew44 desktop..."} />
      </Screen>
    );
  }

  if (client.status === "unpaired") return <PairPage />;
  if (path === "/pair") return <PairPage />;
  if (path === "/agents") return <AgentsPage navigate={navigate} />;

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) return <ProjectPage projectId={decodeURIComponent(projectMatch[1])} navigate={navigate} />;

  const chatMatch = path.match(/^\/chats\/([^/]+)$/);
  if (chatMatch) return <ChatPage chatId={decodeURIComponent(chatMatch[1])} navigate={navigate} />;

  const agentMatch = path.match(/^\/agents\/([^/]+)$/);
  if (agentMatch) return <AgentPage agentId={decodeURIComponent(agentMatch[1])} navigate={navigate} />;

  return <HomePage navigate={navigate} />;
}
