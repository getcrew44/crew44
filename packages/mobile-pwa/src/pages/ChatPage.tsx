import React from "react";
import { buildRenderableTimeline, mapBackendEvent, TimelineItem } from "@/api/events";
import { Agent, BackendEvent, Chat } from "@/api/types";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, EmptyState, Header, IconButton, LoadingState, OfflineState, Screen } from "@/ui/Screen";
import { BackIcon, SendIcon, StopIcon } from "@/ui/icons";
import { Timeline } from "@/ui/Timeline";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function targetAgentFromText(value: string, agents: Agent[]): string {
  const sorted = agents.filter(agent => agent.name).sort((a, b) => b.name.length - a.name.length);
  for (const agent of sorted) {
    const mentionRe = new RegExp(`(^|\\s)@${escapeRegExp(agent.name)}(?=$|\\s|[.,!?;:])`);
    if (mentionRe.test(value)) return agent.id;
  }
  return "";
}

export function ChatPage({
  chatId,
  navigate
}: {
  chatId: string;
  navigate: (path: string) => void;
}) {
  const client = useMobileClient();
  const [chat, setChat] = React.useState<Chat | null>(null);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [items, setItems] = React.useState<TimelineItem[]>([]);
  const [draft, setDraft] = React.useState("");
  const [targetAgentId, setTargetAgentId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState("");
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const didInitialScrollRef = React.useRef(false);
  const lastSeq = React.useRef(0);
  const cleanupRef = React.useRef<() => void>(() => {});

  const renderItems = React.useMemo(() => buildRenderableTimeline(items), [items]);

  const scrollToBottom = React.useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      timelineRef.current?.scrollTo({
        top: timelineRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "auto"
      });
    });
  }, []);

  const appendEvent = React.useCallback((event: BackendEvent) => {
    lastSeq.current = Math.max(lastSeq.current, event.seq);
    const mapped = mapBackendEvent(event);
    if (!mapped) return;
    setItems(prev => {
      if (prev.some(item => item.seq === mapped.seq)) return prev;
      if (mapped.kind === "message" && mapped.role === "user") {
        const optimisticIndex = prev.findIndex(item =>
          item.kind === "message" &&
          item.optimistic &&
          item.role === "user" &&
          item.body === mapped.body
        );
        if (optimisticIndex !== -1) {
          const next = prev.slice();
          next[optimisticIndex] = mapped;
          return next;
        }
      }
      return [...prev, mapped];
    });
  }, []);

  const subscribe = React.useCallback((after: number) => {
    if (!client.api || !chatId) return;
    cleanupRef.current();
    setStreaming(true);
    cleanupRef.current = client.api.subscribeChatEvents(
      chatId,
      after,
      { compactTools: true },
      appendEvent,
      () => {
        setStreaming(false);
        client.api?.getChat(chatId).then(setChat).catch(() => {});
      },
      err => {
        setStreaming(false);
        setError(err.message);
      }
    );
  }, [appendEvent, chatId, client.api]);

  const load = React.useCallback(async () => {
    if (!client.api || !chatId) return;
    setLoading(true);
    setError("");
    cleanupRef.current();
    try {
      const [nextChat, events, nextAgents] = await Promise.all([
        client.api.getChat(chatId),
        client.api.listEvents(chatId, 0, { compactTools: true }),
        client.api.listAgents()
      ]);
      setChat(nextChat);
      setAgents(nextAgents);
      setItems(events.map(mapBackendEvent).filter((item): item is TimelineItem => Boolean(item)));
      didInitialScrollRef.current = false;
      shouldStickToBottomRef.current = true;
      lastSeq.current = events.reduce((seq, event) => Math.max(seq, event.seq), 0);
      subscribe(lastSeq.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chat");
    } finally {
      setLoading(false);
    }
  }, [chatId, client.api, subscribe]);

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
    if (!items.length) return;
    if (!didInitialScrollRef.current || shouldStickToBottomRef.current) {
      scrollToBottom(!didInitialScrollRef.current ? false : true);
      didInitialScrollRef.current = true;
    }
  }, [items.length, scrollToBottom]);

  const handleTimelineScroll = React.useCallback(() => {
    const el = timelineRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
    shouldStickToBottomRef.current = distanceFromBottom < 64;
  }, []);

  const send = React.useCallback(async () => {
    if (!client.api || !chat || !draft.trim()) return;
    const text = draft.trim();
    const steeringActiveRun = streaming;
    setDraft("");
    shouldStickToBottomRef.current = true;
    if (!steeringActiveRun) {
      const optimisticSeq = -Date.now();
      setItems(prev => [...prev, {
        kind: "message",
        seq: optimisticSeq,
        _seq: optimisticSeq,
        author: "__human__",
        role: "user",
        body: text,
        time: "now",
        tsISO: new Date().toISOString(),
        optimistic: true
      }]);
    }
    try {
      if (steeringActiveRun) {
        await client.api.interruptMessage(chatId, text);
      } else {
        const mentionedTarget = targetAgentFromText(text, agents);
        await client.api.postMessage(chatId, text, mentionedTarget || targetAgentId || chat.current_agent_id || chat.main_agent_id);
        subscribe(lastSeq.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      if (!steeringActiveRun) setStreaming(false);
    }
  }, [agents, chat, chatId, client.api, draft, streaming, subscribe, targetAgentId]);

  const cancel = React.useCallback(async () => {
    if (!client.api) return;
    await client.api.cancelChat(chatId);
    cleanupRef.current();
    setStreaming(false);
  }, [chatId, client.api]);

  if (client.status === "error" && !client.api) {
    return (
      <Screen>
        <Header title={chat?.title || "Chat"} left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>} />
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
      <Header title={chat?.title || "Chat"} left={<IconButton label="Back" onClick={() => navigate("/")}><BackIcon /></IconButton>} />
      {loading ? <LoadingState /> : error && items.length === 0 ? (
        <EmptyState title="Could not load chat" body={error}>
          <Button onClick={load}>Retry</Button>
        </EmptyState>
      ) : (
        <>
          <div className="timeline-shell" ref={timelineRef} onScroll={handleTimelineScroll}>
            {renderItems.length === 0 ? (
              <EmptyState title="No messages yet" body="Send the first message to this crew." />
            ) : (
              <Timeline items={renderItems} agents={agents} />
            )}
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {streaming ? <p className="streaming-label">Agent is working...</p> : null}
          <form className="composer" onSubmit={event => { event.preventDefault(); send().catch(() => {}); }}>
            <select value={targetAgentId} onChange={event => setTargetAgentId(event.target.value)} aria-label="Target agent">
              {agents.map(agent => (
                <option value={agent.id} key={agent.id}>{agent.name}</option>
              ))}
            </select>
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              placeholder={streaming ? "Steer the running agent..." : "Message the crew..."}
              rows={2}
            />
            {streaming ? (
              <IconButton label="Stop" onClick={() => cancel().catch(() => {})}>
                <StopIcon />
              </IconButton>
            ) : null}
            <IconButton type="submit" label={streaming ? "Interrupt" : "Send"} disabled={!draft.trim()}>
              <SendIcon />
            </IconButton>
          </form>
        </>
      )}
    </Screen>
  );
}
