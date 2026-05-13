import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useMobileClient } from "@/client/MobileClientProvider";
import { mapBackendEvent, TimelineItem } from "@/api/events";
import { BackendEvent, Chat } from "@/api/types";
import { Button, EmptyState, Header, LoadingState, Screen } from "@/ui/Screen";
import { colors } from "@/ui/theme";

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const { api } = useMobileClient();
  const [chat, setChat] = React.useState<Chat | null>(null);
  const [items, setItems] = React.useState<TimelineItem[]>([]);
  const [draft, setDraft] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState("");
  const lastSeq = React.useRef(0);
  const cleanupRef = React.useRef<() => void>(() => {});

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
      const [nextChat, events] = await Promise.all([
        api.getChat(chatId),
        api.listEvents(chatId, 0)
      ]);
      setChat(nextChat);
      const mapped = events.map(mapBackendEvent).filter((item): item is TimelineItem => Boolean(item));
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

  const send = React.useCallback(async () => {
    if (!api || !chatId || !chat || !draft.trim() || streaming) return;
    const text = draft.trim();
    setDraft("");
    const optimistic: TimelineItem = {
      kind: "message",
      seq: -Date.now(),
      author: "__human__",
      role: "user",
      content: text,
      time: "now"
    };
    setItems(prev => [...prev, optimistic]);
    try {
      await api.postMessage(chatId, text, chat.current_agent_id || chat.main_agent_id);
      subscribe(lastSeq.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setStreaming(false);
    }
  }, [api, chat, chatId, draft, streaming, subscribe]);

  const cancel = React.useCallback(async () => {
    if (!api || !chatId) return;
    await api.cancelChat(chatId);
    cleanupRef.current();
    setStreaming(false);
  }, [api, chatId]);

  return (
    <Screen>
      <Header
        title={chat?.title || "Chat"}
        right={<Button label="Back" variant="secondary" onPress={() => router.back()} />}
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
            data={items}
            keyExtractor={(item, index) => `${item.seq}:${index}`}
            renderItem={({ item }) => <TimelineRow item={item} />}
            contentContainerStyle={styles.timeline}
            ListEmptyComponent={<EmptyState title="No messages yet" body="Send the first message to this crew." />}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {streaming ? <Text style={styles.streaming}>Agent is working...</Text> : null}
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={!streaming}
              multiline
              placeholder={streaming ? "Waiting for response..." : "Message the crew"}
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Pressable
              onPress={streaming ? cancel : send}
              disabled={!streaming && !draft.trim()}
              style={[styles.sendButton, !streaming && !draft.trim() && styles.disabled]}
            >
              <Text style={styles.sendText}>{streaming ? "Stop" : "Send"}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  if (item.kind === "message") {
    const mine = item.role === "user";
    return (
      <View style={[styles.bubble, mine ? styles.userBubble : styles.agentBubble]}>
        <Text style={styles.meta}>{mine ? "You" : item.author} · {item.time}</Text>
        <Text style={styles.messageText}>{item.content}</Text>
      </View>
    );
  }
  if (item.kind === "thinking") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>Thinking · {item.time}</Text>
        <Text style={styles.eventText}>{item.content}</Text>
      </View>
    );
  }
  if (item.kind === "tool" || item.kind === "tool_result") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>{item.kind === "tool" ? item.name : `${item.name} result`} · {item.time}</Text>
        <Text style={styles.eventText} numberOfLines={6}>{item.kind === "tool" ? item.detail : item.output}</Text>
      </View>
    );
  }
  if (item.kind === "handover") {
    return (
      <View style={styles.eventBox}>
        <Text style={styles.meta}>{item.label} · {item.time}</Text>
        {item.note ? <Text style={styles.eventText}>{item.note}</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.eventBox, styles.errorBox]}>
      <Text style={styles.meta}>Error · {item.time}</Text>
      <Text style={styles.eventText}>{item.message}</Text>
    </View>
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
  bubble: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    maxWidth: "92%"
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: "#EDF4EC",
    borderColor: "#D1E5CF"
  },
  agentBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.panel,
    borderColor: colors.border
  },
  meta: {
    color: colors.muted,
    fontSize: 11,
    marginBottom: 5,
    fontWeight: "600"
  },
  messageText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21
  },
  eventBox: {
    backgroundColor: colors.soft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 11
  },
  errorBox: {
    borderColor: "#E7B8AA"
  },
  eventText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19
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
  }
});
