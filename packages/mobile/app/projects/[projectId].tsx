import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { ChatIndexEntry, Project } from "@/api/types";
import { DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { BackButton, Button, EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";
import { goBackOrHome } from "@/ui/navigation";
import { colors } from "@/ui/theme";

const CHAT_PAGE_SIZE = 30;

function chatId(chat: ChatIndexEntry): string {
  return chat.chat_id || chat.id || "";
}

function chatTime(chat: ChatIndexEntry): number {
  const value = new Date(chat.updated_at || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function sortRecentFirst(chats: ChatIndexEntry[]): ChatIndexEntry[] {
  return chats.slice().sort((a, b) => chatTime(b) - chatTime(a));
}

function appendUnique(prev: ChatIndexEntry[], next: ChatIndexEntry[]): ChatIndexEntry[] {
  const seen = new Set(prev.map(chatId));
  const merged = prev.slice();
  for (const chat of next) {
    const id = chatId(chat);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(chat);
  }
  return sortRecentFirst(merged);
}

function isRunningChat(chat: ChatIndexEntry): boolean {
  return chat.status === "running" || chat.status === "streaming";
}

function chatSubtitle(chat: ChatIndexEntry): string {
  const updatedAt = new Date(chat.updated_at).toLocaleString();
  return isRunningChat(chat) ? `Running · ${updatedAt}` : `Updated ${updatedAt}`;
}

export default function ProjectChatsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { api, status, error: connectionError, connectionIssue, reconnect, disconnect } = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [chats, setChats] = React.useState<ChatIndexEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");

  const project = projects.find(item => item.id === projectId);

  const load = React.useCallback(async () => {
    if (!api || !projectId) return;
    setLoading(true);
    setError("");
    try {
      const [nextProjects, nextChats] = await Promise.all([
        api.listProjects(),
        api.listProjectChats(projectId, { limit: CHAT_PAGE_SIZE, offset: 0 })
      ]);
      setProjects(nextProjects);
      setChats(sortRecentFirst(nextChats));
      setHasMore(nextChats.length === CHAT_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

  const loadMore = React.useCallback(async () => {
    if (!api || !projectId || loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextChats = await api.listProjectChats(projectId, {
        limit: CHAT_PAGE_SIZE,
        offset: chats.length
      });
      setChats(prev => appendUnique(prev, nextChats));
      setHasMore(nextChats.length === CHAT_PAGE_SIZE);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more chats");
    } finally {
      setLoadingMore(false);
    }
  }, [api, chats.length, hasMore, loading, loadingMore, projectId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const createChat = React.useCallback(async () => {
    if (!api || !projectId) return;
    const mainAgentId = project?.main_agent_id;
    if (!mainAgentId) {
      setError("This project does not have a main agent.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const chat = await api.createChat(projectId, "Mobile chat", mainAgentId);
      router.push(`/chats/${chat.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create chat");
    } finally {
      setCreating(false);
    }
  }, [api, project, projectId]);

  if (status === "error" && !api) {
    return (
      <Screen>
        <Header
          title={project?.name || "Project"}
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
        title={project?.name || "Project"}
        left={<BackButton onPress={goBackOrHome} />}
        right={<Button label={creating ? "Creating..." : "New Chat"} disabled={creating} onPress={createChat} />}
      />
      {loading ? <LoadingState /> : error && chats.length === 0 ? (
        <View style={{ flex: 1 }}>
          <EmptyState title="Could not load chats" body={error} />
          <View style={{ padding: 18 }}>
            <Button label="Retry" onPress={load} />
          </View>
        </View>
      ) : chats.length === 0 ? (
        <EmptyState title="No chats yet" body="Start a chat from this phone or from the desktop app." />
      ) : (
        <FlatList
          data={chats}
          keyExtractor={item => chatId(item)}
          renderItem={({ item }) => (
            <Row
              title={item.title || "Untitled chat"}
              subtitle={chatSubtitle(item)}
              onPress={() => router.push(`/chats/${chatId(item)}`)}
            />
          )}
          refreshing={loading}
          onRefresh={load}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          ListHeaderComponent={error ? <Text style={styles.inlineError}>{error}</Text> : null}
          ListFooterComponent={loadingMore ? <Text style={styles.footer}>Loading more...</Text> : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: 18
  },
  inlineError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 18,
    paddingVertical: 10
  }
});
