import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import { FlatList, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { ChatIndexEntry, Project } from "@/api/types";
import { Button, EmptyState, Header, LoadingState, Row, Screen } from "@/ui/Screen";

function chatId(chat: ChatIndexEntry): string {
  return chat.chat_id || chat.id || "";
}

export default function ProjectChatsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { api } = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [chats, setChats] = React.useState<ChatIndexEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
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
        api.listProjectChats(projectId)
      ]);
      setProjects(nextProjects);
      setChats(nextChats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, [api, projectId]);

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

  return (
    <Screen>
      <Header
        title={project?.name || "Project"}
        right={<Button label={creating ? "Creating..." : "New Chat"} disabled={creating} onPress={createChat} />}
      />
      {loading ? <LoadingState /> : error ? (
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
              subtitle={`${item.status || "active"} · ${new Date(item.updated_at).toLocaleString()}`}
              onPress={() => router.push(`/chats/${chatId(item)}`)}
            />
          )}
          refreshing={loading}
          onRefresh={load}
        />
      )}
    </Screen>
  );
}
