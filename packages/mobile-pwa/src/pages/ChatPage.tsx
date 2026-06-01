import React from "react";
import { buildRenderableTimeline, mapBackendEvent, TimelineItem } from "@/api/events";
import { Agent, BackendEvent, Chat } from "@/api/types";
import { connectionIssueTitle } from "@/client/connectionIssue";
import { useMobileClient } from "@/client/MobileClientProvider";
import { Button, EmptyState, Header, IconButton, LoadingState, OfflineState, Screen } from "@/ui/Screen";
import { BackIcon, SendIcon, StopIcon } from "@/ui/icons";
import { AgentTargetPicker } from "@/ui/AgentTargetPicker";
import { LoadedToolDetails, Timeline } from "@/ui/Timeline";

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

function mentionBounds(value: string, cursor: number) {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor, query: match[2] || "" };
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
  const [cursor, setCursor] = React.useState(0);
  const [targetAgentId, setTargetAgentId] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [streaming, setStreaming] = React.useState(false);
  const [error, setError] = React.useState("");
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const didInitialScrollRef = React.useRef(false);
  const lastSeq = React.useRef(0);
  const cleanupRef = React.useRef<() => void>(() => {});
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);

  const activeMention = React.useMemo(() => mentionBounds(draft, cursor), [cursor, draft]);
  const mentionOptions = React.useMemo(() => {
    if (!activeMention) return [];
    const query = activeMention.query.toLowerCase();
    return agents
      .filter(agent => agent.name.toLowerCase().includes(query))
      .slice(0, 6);
  }, [activeMention, agents]);
  const renderItems = React.useMemo(() => buildRenderableTimeline(items), [items]);
  const hasTimelineError = React.useMemo(() => renderItems.some(item => item.kind === "error"), [renderItems]);

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
    if (!renderItems.length) return;
    if (!didInitialScrollRef.current || shouldStickToBottomRef.current) {
      scrollToBottom(!didInitialScrollRef.current ? false : true);
      didInitialScrollRef.current = true;
    }
  }, [renderItems, scrollToBottom]);

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
    setCursor(0);
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

  const updateCursor = React.useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    setCursor(el.selectionStart || 0);
  }, []);

  const selectMention = React.useCallback((agent: Agent) => {
    if (!activeMention) return;
    const next = `${draft.slice(0, activeMention.start)}@${agent.name} ${draft.slice(activeMention.end)}`;
    const nextCursor = activeMention.start + agent.name.length + 2;
    setDraft(next);
    setCursor(nextCursor);
    setTargetAgentId(agent.id);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  }, [activeMention, draft]);

  const cancel = React.useCallback(async () => {
    if (!client.api) return;
    await client.api.cancelChat(chatId);
    cleanupRef.current();
    setStreaming(false);
  }, [chatId, client.api]);

  const loadToolDetails = React.useCallback(async (toolCallSeq: number): Promise<LoadedToolDetails> => {
    if (!client.api) throw new Error("Not connected");
    const details = await client.api.getToolDetails(chatId, toolCallSeq);
    const call = mapBackendEvent(details.tool_call);
    const result = details.tool_result ? mapBackendEvent(details.tool_result) : null;
    if (!call || call.kind !== "tool") throw new Error("Tool call not found");
    if (result?.kind === "tool_result") {
      return {
        path: call.path,
        input: call.input,
        result: "ok",
        output: result.output,
        detail: result.output.slice(0, 120)
      };
    }
    return {
      path: call.path,
      input: call.input,
      result: call.result,
      output: call.output,
      detail: call.detail
    };
  }, [chatId, client.api]);

  const backToProject = React.useCallback(() => {
    if (!chat?.project_id) return;
    navigate(`/projects/${chat.project_id}`);
  }, [chat?.project_id, navigate]);

  if (client.status === "error" && !client.api) {
    return (
      <Screen>
        <Header
          title={chat?.title || "Chat"}
          left={<IconButton label="Back" onClick={backToProject} disabled={!chat?.project_id}><BackIcon /></IconButton>}
        />
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
        title={chat?.title || "Chat"}
        left={<IconButton label="Back" onClick={backToProject} disabled={!chat?.project_id}><BackIcon /></IconButton>}
      />
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
              <Timeline items={renderItems} agents={agents} onLoadToolDetails={loadToolDetails} />
            )}
          </div>
          {error && !hasTimelineError ? <p className="inline-error">{error}</p> : null}
          {streaming ? <p className="streaming-label">Agent is working...</p> : null}
          {mentionOptions.length > 0 ? (
            <div className="mention-menu">
              {mentionOptions.map(agent => (
                <button type="button" className="mention-item" key={agent.id} onClick={() => selectMention(agent)}>
                  <span className="mention-avatar">{(agent.name || "?")[0].toUpperCase()}</span>
                  <span>{agent.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          <form className="composer" onSubmit={event => { event.preventDefault(); send().catch(() => {}); }}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                setCursor(event.target.selectionStart || event.target.value.length);
              }}
              onSelect={updateCursor}
              onClick={updateCursor}
              onKeyUp={updateCursor}
              placeholder={streaming ? "Steer this run" : "Message the crew"}
              rows={1}
            />
            <div className="composer-meta">
              {!streaming && agents.length > 0 ? (
                <AgentTargetPicker
                  agents={agents}
                  value={targetAgentId || chat?.current_agent_id || chat?.main_agent_id || agents[0].id}
                  onChange={setTargetAgentId}
                />
              ) : <span />}
              <div className="composer-actions">
                {streaming ? (
                  <button type="button" className="stop-button" aria-label="Stop" onClick={() => cancel().catch(() => {})}>
                    <StopIcon />
                  </button>
                ) : null}
                <button type="submit" className="send-button" aria-label={streaming ? "Steer" : "Send"} disabled={!draft.trim()}>
                  <SendIcon />
                </button>
              </div>
            </div>
          </form>
        </>
      )}
    </Screen>
  );
}
