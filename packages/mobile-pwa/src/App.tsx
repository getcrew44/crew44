import React from "react";
import { useMobileClient } from "@/client/MobileClientProvider";
import { AgentPage } from "@/pages/AgentPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { ChatPage } from "@/pages/ChatPage";
import { HomePage } from "@/pages/HomePage";
import { PairPage } from "@/pages/PairPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { PwaInstallPromptController } from "@/pwa-install/PwaInstallPromptController";
import { ConnectingState, Header, Screen } from "@/ui/Screen";

function currentPath(): string {
  const hashPath = window.location.hash.replace(/^#/, "");
  if (new URLSearchParams(hashPath).has("secret")) return "/pair";
  if (hashPath.startsWith("/")) return hashPath;
  return window.location.pathname === "/" ? "/" : window.location.pathname;
}

function hasPairSecretHash(): boolean {
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).has("secret");
}

function useHashRoute() {
  const [path, setPath] = React.useState(currentPath);
  React.useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const navigate = React.useCallback((nextPath: string) => {
    if (window.location.pathname !== "/") window.history.replaceState(null, "", "/");
    window.location.hash = nextPath;
    setPath(nextPath);
  }, []);
  return { path, navigate };
}

export default function App() {
  const client = useMobileClient();
  const { path, navigate } = useHashRoute();

  React.useEffect(() => {
    if (hasPairSecretHash()) return;
    if (client.status === "unpaired" && path !== "/pair") navigate("/pair");
    if (client.status === "online" && path === "/pair") navigate("/");
  }, [client.status, navigate, path]);

  let content: React.ReactNode;

  if (client.status === "loading" || client.status === "connecting") {
    const label = client.status === "connecting"
      ? "Connecting to the Crew44 desktop..."
      : "Loading pairing...";
    content = (
      <Screen>
        <Header title="Crew44 Mobile" />
        <ConnectingState
          label={label}
          showOtherOptions={Boolean(client.profile)}
          onUnpair={client.disconnect}
        />
      </Screen>
    );
  } else if (client.status === "unpaired") {
    content = <PairPage />;
  } else if (path === "/pair") {
    content = <PairPage />;
  } else if (path === "/agents") {
    content = <AgentsPage navigate={navigate} />;
  } else {
    const projectMatch = path.match(/^\/projects\/([^/]+)$/);
    const chatMatch = path.match(/^\/chats\/([^/]+)$/);
    const agentMatch = path.match(/^\/agents\/([^/]+)$/);

    if (projectMatch) {
      content = <ProjectPage projectId={decodeURIComponent(projectMatch[1])} navigate={navigate} />;
    } else if (chatMatch) {
      content = <ChatPage chatId={decodeURIComponent(chatMatch[1])} navigate={navigate} />;
    } else if (agentMatch) {
      content = <AgentPage agentId={decodeURIComponent(agentMatch[1])} navigate={navigate} />;
    } else {
      content = <HomePage navigate={navigate} />;
    }
  }

  return (
    <>
      {content}
      <PwaInstallPromptController />
    </>
  );
}
