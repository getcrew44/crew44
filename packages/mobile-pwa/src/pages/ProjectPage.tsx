import React from "react";
import { ChatIndexEntry, Project } from "@/api/types";
import { connectionIssueTitle } from "@/client/connectionIssue";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, EmptyState, Header, IconButton, LoadingState, OfflineState, Row, Screen } from "@/ui/Screen";
import { BackIcon } from "@/ui/icons";

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

export function ProjectPage({
  projectId,
  navigate
}: {
  projectId: string;
  navigate: (path: string) => void;
}) {
  const client = useMobileClient();
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [chats, setChats] = React.useState<ChatIndexEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const project = projects.find(item => item.id === projectId);

  const load = React.useCallback(async () => {
    if (!client.api || !projectId) return;
    setLoading(true);
    setError("");
    try {
      const [nextProjects, nextChats] = await Promise.all([
        client.api.listProjects(),
        client.api.listProjectChats(projectId, { limit: CHAT_PAGE_SIZE, offset: 0 })
      ]);
      setProjects(nextProjects);
      setChats(sortRecentFirst(nextChats));
      setHasMore(nextChats.length === CHAT_PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chats");
    } finally {
      setLoading(false);
    }
  }, [client.api, projectId]);

  const loadMore = React.useCallback(async () => {
    if (!client.api || loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextChats = await client.api.listProjectChats(projectId, {
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
  }, [chats.length, client.api, hasMore, loading, loadingMore, projectId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleScroll = React.useCallback(() => {
    const el = listRef.current;
    if (!el || loading || loadingMore || !hasMore) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    if (distanceFromBottom < 160) loadMore().catch(() => {});
  }, [hasMore, loadMore, loading, loadingMore]);

  const createChat = React.useCallback(async () => {
    if (!client.api || !projectId) return;
    const mainAgentId = project?.main_agent_id;
    if (!mainAgentId) {
      setError("This project does not have a main agent.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const chat = await client.api.createChat(projectId, "Mobile chat", mainAgentId);
      navigate(`/chats/${chat.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create chat");
    } finally {
      setCreating(false);
    }
  }, [client.api, navigate, project, projectId]);

  if (client.status === "error" && !client.api) {
    return (
      <Screen>
        <Header title={project?.name || "Project"} left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>} />
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
      <Header
        title={project?.name || "Project"}
        left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>}
        right={<Button disabled={creating} onClick={createChat}>{creating ? "Creating..." : "New Chat"}</Button>}
      />
      {loading ? <LoadingState /> : error && chats.length === 0 ? (
        <EmptyState title="Could not load chats" body={error}>
          <Button onClick={load}>Retry</Button>
        </EmptyState>
      ) : chats.length === 0 ? (
        <EmptyState title="No chats yet" body="Start a chat from this phone or from the desktop app." />
      ) : (
        <div className="list" ref={listRef} onScroll={handleScroll}>
          {error ? <p className="inline-error">{error}</p> : null}
          {chats.map(chat => (
            <Row
              key={chatId(chat)}
              title={chat.title || "Untitled chat"}
              subtitle={chatSubtitle(chat)}
              onClick={() => navigate(`/chats/${chatId(chat)}`)}
            />
          ))}
          {loadingMore ? <div className="list-footer">Loading more...</div> : null}
        </div>
      )}
    </Screen>
  );
}
