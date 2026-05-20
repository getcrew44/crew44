import React from "react";
import { router } from "expo-router";
import { FlatList, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Project } from "@/api/types";
import { DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { BackButton, Button, EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";
import { goBackOrHome } from "@/ui/navigation";

export default function ProjectsScreen() {
  const { api, status, error: connectionError, connectionIssue, reconnect, disconnect } = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError("");
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    if (status === "unpaired") router.replace("/pair");
    if (api) load();
  }, [api, load, status]);

  if (status === "error" && !api) {
    return (
      <Screen>
        <Header
          title="Projects"
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
        title="Projects"
        left={<BackButton onPress={goBackOrHome} />}
      />
      {loading ? <LoadingState /> : error ? (
        <View style={{ flex: 1 }}>
          <EmptyState title="Could not load projects" body={error} />
          <View style={{ padding: 18 }}>
            <Button label="Reconnect" onPress={reconnect} />
          </View>
        </View>
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet" body="Create or add a project in the desktop app, then refresh." />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <Row
              title={item.name}
              subtitle={item.workdir}
              onPress={() => router.push(`/projects/${item.id}`)}
            />
          )}
          refreshing={loading}
          onRefresh={load}
        />
      )}
    </Screen>
  );
}
