import React from "react";
import { router } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Project } from "@/api/types";
import { useMobileClient } from "@/client/MobileClientProvider";
import { ConnectingDesktopState, DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";
import { colors, spacing } from "@/ui/theme";

export default function Index() {
  const client = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = React.useState(true);
  const [projectError, setProjectError] = React.useState("");
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (client.status === "unpaired") router.replace("/pair");
  }, [client.status]);

  const loadProjects = React.useCallback(async () => {
    if (!client.api) return;
    setLoadingProjects(true);
    setProjectError("");
    try {
      setProjects(await client.api.listProjects());
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoadingProjects(false);
    }
  }, [client.api]);

  React.useEffect(() => {
    if (client.api) loadProjects();
  }, [client.api, loadProjects]);

  const confirmUnpair = React.useCallback(() => {
    setMenuOpen(false);
    Alert.alert(
      "Unpair this phone?",
      "This removes the mobile pairing from this phone and, while connected, from desktop too.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Unpair", style: "destructive", onPress: () => { client.disconnect().catch(() => {}); } }
      ]
    );
  }, [client.disconnect]);

  if (client.status === "error") {
    return (
      <Screen>
        <Header title="Crew44 Mobile" />
        <DesktopOfflineState
          title={client.connectionIssue === "relay" ? "Relay connection issue" : "Desktop offline"}
          message={client.error}
          onRetry={client.reconnect}
          onUnpair={client.disconnect}
        />
      </Screen>
    );
  }

  if (client.status === "online") {
    const desktopLabel = client.profile?.desktopName || "Desktop online";
    return (
      <Screen>
        {menuOpen ? <Pressable style={styles.menuDismissLayer} onPress={() => setMenuOpen(false)} /> : null}
        <Header
          title="Crew44"
          right={
            <View style={styles.menuHost}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More options"
                onPress={() => setMenuOpen(open => !open)}
                style={styles.moreButton}
              >
                <Text style={styles.moreText}>...</Text>
              </Pressable>
              {menuOpen ? (
                <View style={styles.menu}>
                  <Pressable style={styles.menuItem} onPress={() => {
                    setMenuOpen(false);
                    router.push("/agents");
                  }}>
                    <Text style={styles.menuText}>Agents</Text>
                  </Pressable>
                  <Pressable style={styles.menuItem} onPress={confirmUnpair}>
                    <Text style={[styles.menuText, styles.dangerText]}>Unpair</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
        />
        <View style={styles.statusRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.statusText}>{desktopLabel}</Text>
        </View>
        <Text style={styles.sectionTitle}>Projects</Text>
        {loadingProjects ? <LoadingState /> : projectError ? (
          <View style={styles.projectError}>
            <EmptyState title="Could not load projects" body={projectError} />
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
            refreshing={loadingProjects}
            onRefresh={loadProjects}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Crew44 Mobile" />
      <ConnectingDesktopState
        label={client.status === "connecting" ? "Connecting to desktop..." : "Loading pairing..."}
        showOtherOptions={Boolean(client.profile)}
        onUnpair={client.disconnect}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  menuDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10
  },
  menuHost: {
    zIndex: 20
  },
  moreButton: {
    minWidth: 38,
    minHeight: 38,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center"
  },
  moreText: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0
  },
  menu: {
    position: "absolute",
    right: 0,
    top: 42,
    zIndex: 10,
    minWidth: 150,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    overflow: "hidden"
  },
  menuItem: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  menuText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600"
  },
  dangerText: {
    color: colors.danger
  },
  statusRow: {
    paddingHorizontal: spacing.page,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  onlineDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#3FA45B"
  },
  statusText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600"
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: spacing.page,
    paddingTop: 8,
    paddingBottom: 6
  },
  projectError: {
    flex: 1
  }
});
