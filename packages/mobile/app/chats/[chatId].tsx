import React from "react";
import { useLocalSearchParams } from "expo-router";
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { buildRenderableTimeline, mapBackendEvent, RenderableTimelineItem, TimelineItem } from "@/api/events";
import { Agent, BackendEvent, Chat } from "@/api/types";
import { AgentTargetPicker } from "@/ui/AgentTargetPicker";
import { DesktopOfflineState } from "@/ui/DesktopOfflineState";
import { BackButton, EmptyState, Header, LoadingState, Screen } from "@/ui/Screen";
import { TimelineRow } from "@/ui/TimelineEvents";
import { goBackOrHome } from "@/ui/navigation";
import { colors } from "@/ui/theme";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionBounds(value: string, cursor: number) {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor, query: match[2] || "" };
}

function targetAgentFromText(value: string, agents: Agent[]): string {
  const sorted = agents.filter(agent => agent.name).sort((a, b) => b.name.length - a.name.length);
  for (const agent of sorted) {
    const mentionRe = new RegExp(`(^|\\s)@${escapeRegExp(agent.name)}(?=$|\\s|[.,!?;:])`);
    if (mentionRe.test(value)) return agent.id;
  }
  return "";
}

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api, status, error: connectionError, connectionIssue, reconnect, disconnect } = useMobileClient();
  const [chat, setChat] = React.useState<Chat | null>(null);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [items, setItems] = React.useState<TimelineItem[]>([]);
  const [draft, setDraft] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [targetAgentId, setTargetAgentId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState("");
  const listRef = React.useRef<FlatList<RenderableTimelineItem>>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const didInitialScrollRef = React.useRef(false);
  const lastSeq = React.useRef(0);
  const cleanupRef = React.useRef<() => void>(() => {});

  const activeMention = React.useMemo(() => mentionBounds(draft, cursor), [draft, cursor]);
  const mentionOptions = React.useMemo(() => {
    if (!activeMention) return [];
    const query = activeMention.query.toLowerCase();
    return agents
      .filter(agent => agent.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [activeMention, agents]);
  const renderItems = React.useMemo(() => buildRenderableTimeline(items), [items]);

  const scrollToBottom = React.useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const appendEvent = React.useCallback((event: BackendEvent) => {
    lastSeq.current = Math.max(lastSeq.current, event.seq);
    const mapped = mapBackendEvent(event);
    if (!mapped) return;
    setItems(prev => {
      if (prev.some(item => item.seq === mapped.seq)) return prev;
      return [...prev, mapped];
    });
  }, []);

  const subscribe = React.useCallback((after: number) => {
    if (!api || !chatId) return;
    cleanupRef.current();
    setStreaming(true);
    cleanupRef.current = api.subscribeChatEvents(
      chatId,
      after,
      appendEvent,
      () => {
        setStreaming(false);
        api.getChat(chatId).then(setChat).catch(() => {});
      },
      err => {
        setStreaming(false);
        setError(err.message);
      }
    );
  }, [api, appendEvent, chatId]);

  const load = React.useCallback(async () => {
    if (!api || !chatId) return;
    setLoading(true);
    setError("");
    cleanupRef.current();
    try {
      const [nextChat, events, nextAgents] = await Promise.all([
        api.getChat(chatId),
        api.listEvents(chatId, 0),
        api.listAgents()
      ]);
      setChat(nextChat);
      setAgents(nextAgents);
      const mapped = events.map(mapBackendEvent).filter((item): item is TimelineItem => Boolean(item));
      didInitialScrollRef.current = false;
      shouldStickToBottomRef.current = true;
      setItems(mapped);
      lastSeq.current = events.reduce((seq, event) => Math.max(seq, event.seq), 0);
      subscribe(lastSeq.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    } finally {
      setLoading(false);
    }
  }, [api, chatId, subscribe]);

  React.useEffect(() => {
    load();
    return () => cleanupRef.current();
  }, [load]);

  React.useEffect(() => {
    if (!chat || agents.length === 0) return;
    const preferred = chat.current_agent_id || chat.main_agent_id || agents[0].id;
    setTargetAgentId(current => {
      if (current && agents.some(agent => agent.id === current)) return current;
      return preferred;
    });
  }, [agents, chat]);

  React.useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      if (shouldStickToBottomRef.current) scrollToBottom(true);
    });
    const frameSub = Keyboard.addListener("keyboardDidChangeFrame", () => {
      if (shouldStickToBottomRef.current) scrollToBottom(false);
    });
    return () => {
      showSub.remove();
      frameSub.remove();
    };
  }, [scrollToBottom]);

  React.useEffect(() => {
    if (!items.length) return;
    if (!didInitialScrollRef.current || shouldStickToBottomRef.current) {
      scrollToBottom(!didInitialScrollRef.current ? false : true);
      didInitialScrollRef.current = true;
    }
  }, [items.length, scrollToBottom]);

  const handleScroll = React.useCallback((event: {
    nativeEvent: {
      contentOffset: { y: number };
      layoutMeasurement: { height: number };
      contentSize: { height: number };
    };
  }) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldStickToBottomRef.current = distanceFromBottom < 48;
  }, []);

  const selectMention = React.useCallback((agent: Agent) => {
    if (!activeMention) return;
    const next = `${draft.slice(0, activeMention.start)}@${agent.name} ${draft.slice(activeMention.end)}`;
    const nextCursor = activeMention.start + agent.name.length + 2;
    setDraft(next);
    setCursor(nextCursor);
    setTargetAgentId(agent.id);
  }, [activeMention, draft]);

  const send = React.useCallback(async () => {
    if (!api || !chatId || !chat || !draft.trim()) return;
    const text = draft.trim();
    const steeringActiveRun = streaming;
    setDraft("");
    setCursor(0);
    setTargetAgentId("");
    shouldStickToBottomRef.current = true;
    if (!steeringActiveRun) {
      const optimisticSeq = -Date.now();
      const optimistic: TimelineItem = {
        kind: "message",
        seq: optimisticSeq,
        _seq: optimisticSeq,
        author: "__human__",
        role: "user",
        body: text,
        time: "now",
        tsISO: new Date().toISOString()
      };
      setItems(prev => [...prev, optimistic]);
    }
    try {
      if (steeringActiveRun) {
        await api.interruptMessage(chatId, text);
      } else {
        const mentionedTarget = targetAgentFromText(text, agents);
        await api.postMessage(chatId, text, mentionedTarget || targetAgentId || chat.current_agent_id || chat.main_agent_id);
        subscribe(lastSeq.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      if (!steeringActiveRun) setStreaming(false);
    }
  }, [agents, api, chat, chatId, draft, streaming, subscribe, targetAgentId]);

  const cancel = React.useCallback(async () => {
    if (!api || !chatId) return;
    await api.cancelChat(chatId);
    cleanupRef.current();
    setStreaming(false);
  }, [api, chatId]);

  if (status === "error" && !api) {
    return (
      <Screen>
        <Header
          title={chat?.title || "Chat"}
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
        title={chat?.title || "Chat"}
        left={<BackButton onPress={goBackOrHome} />}
      />
      {loading ? <LoadingState /> : error && items.length === 0 ? (
        <EmptyState title="Could not load chat" body={error} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={12}
        >
          <FlatList
            ref={listRef}
            data={renderItems}
            keyExtractor={(item, index) => `${item.kind}:${item._seq}:${index}`}
            renderItem={({ item }) => <TimelineRow item={item} agents={agents} />}
            contentContainerStyle={styles.timeline}
            ListEmptyComponent={<EmptyState title="No messages yet" body="Send the first message to this crew." />}
            onContentSizeChange={() => {
              if (!didInitialScrollRef.current || shouldStickToBottomRef.current) {
                scrollToBottom(!didInitialScrollRef.current ? false : true);
                didInitialScrollRef.current = true;
              }
            }}
            onLayout={() => scrollToBottom(false)}
            onScroll={handleScroll}
            scrollEventThrottle={80}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {streaming ? <Text style={styles.streaming}>Agent is working...</Text> : null}
          <View>
            {mentionOptions.length > 0 ? (
              <View style={styles.mentionMenu}>
                {mentionOptions.map(agent => (
                  <Pressable key={agent.id} style={styles.mentionItem} onPress={() => selectMention(agent)}>
                    <View style={styles.mentionAvatar}>
                      <Text style={styles.mentionAvatarText}>{(agent.name || "?")[0].toUpperCase()}</Text>
                    </View>
                    <Text style={styles.mentionName}>{agent.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {!streaming && agents.length > 0 ? (
              <View style={styles.targetRow}>
                <AgentTargetPicker
                  agents={agents}
                  value={targetAgentId || chat?.current_agent_id || chat?.main_agent_id || agents[0].id}
                  onChange={setTargetAgentId}
                />
              </View>
            ) : null}
            <View style={styles.composer}>
              <TextInput
                value={draft}
                onChangeText={text => {
                  setDraft(text);
                  setCursor(text.length);
                }}
                onSelectionChange={event => setCursor(event.nativeEvent.selection.start)}
                multiline
                placeholder={streaming ? "Steer this run" : "Message the crew"}
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              <Pressable
                onPress={send}
                disabled={!draft.trim()}
                style={[styles.sendButton, !draft.trim() && styles.disabled]}
              >
                <Text style={styles.sendText}>{streaming ? "Steer" : "Send"}</Text>
              </Pressable>
              {streaming ? (
                <Pressable onPress={cancel} style={styles.stopButton}>
                  <Text style={styles.stopText}>Stop</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  timeline: {
    padding: 18,
    gap: 10
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    paddingHorizontal: 18,
    paddingBottom: 8
  },
  streaming: {
    color: colors.muted,
    fontSize: 12,
    paddingHorizontal: 18,
    paddingBottom: 8
  },
  composer: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end"
  },
  targetRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.bg
  },
  mentionMenu: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    overflow: "hidden"
  },
  mentionItem: {
    minHeight: 46,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border
  },
  mentionAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center"
  },
  mentionAvatarText: {
    color: "#FCFBF7",
    fontSize: 12,
    fontWeight: "700"
  },
  mentionName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600"
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.panel,
    fontSize: 15
  },
  sendButton: {
    minWidth: 66,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12
  },
  disabled: {
    opacity: 0.45
  },
  sendText: {
    color: "#FCFBF7",
    fontSize: 14,
    fontWeight: "700"
  },
  stopButton: {
    minWidth: 58,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10
  },
  stopText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700"
  }
});
