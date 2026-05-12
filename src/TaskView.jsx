import React from 'react';
import { Avatar, MetaPill, RichText, UI_FONT, MONO_FONT } from './components.jsx';
import { mapBackendEvent, mergeToolResults, relativeTime, formatTime, HUMAN_USER } from './utils.js';
import * as api from './api.js';

// ─── Event renderers ──────────────────────────────────────────────────────────

function MessageEvent({ event, agentsMap }) {
  const agent = agentsMap[event.author] || HUMAN_USER;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '14px 0' }}>
      <Avatar agent={agent} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
          <span style={{ color: '#A89F92', marginLeft: 8 }}>· {event.time}</span>
        </div>
        <div style={{ fontSize: 14, color: '#1C1A17', lineHeight: 1.55 }}>
          <RichText text={event.body} />
        </div>
      </div>
    </div>
  );
}

function ThinkingEvent({ event, agentsMap }) {
  const agent = agentsMap[event.author];
  const [open, setOpen] = React.useState(false);
  if (!agent) return null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={agent} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 999,
            background: '#F7EFDD', color: '#C4644A', fontSize: 11.5, fontWeight: 500,
          }}>
            <svg width="11" height="11" viewBox="0 0 11 11">
              <circle cx="3" cy="5.5" r="1" fill="currentColor"/>
              <circle cx="5.5" cy="5.5" r="1" fill="currentColor"/>
              <circle cx="8" cy="5.5" r="1" fill="currentColor"/>
            </svg>
            {event.seconds > 0 ? `thought ${event.seconds}s` : 'thinking'}
          </span>
        </div>
        <div
          onClick={() => setOpen(!open)}
          style={{ fontSize: 13, color: '#807972', cursor: 'pointer', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          {open ? 'Hide reasoning' : 'Show reasoning'}
        </div>
        {open && (
          <div style={{
            marginTop: 8, padding: '10px 14px', borderRadius: 8,
            background: '#FAF5E8', border: '1px solid #ECE6D5',
            fontSize: 13, color: '#5C544B', lineHeight: 1.55, fontStyle: 'italic',
          }}>{event.reasoning}</div>
        )}
      </div>
    </div>
  );
}

const ToolBadge = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 999,
  background: '#F0EAD8', color: '#5C544B',
  fontSize: 11.5, fontWeight: 500, fontFamily: MONO_FONT,
};

function ToolEvent({ event, agentsMap }) {
  const agent = agentsMap[event.author];
  if (!agent) return null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={agent} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
          <span style={ToolBadge}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginRight: 3 }}>
              <path d="M3 7l-1.5 1.5M6.5 3.5l1-1a1.4 1.4 0 0 1 2 2l-1 1M3 7l3.5-3.5 2 2L5 9 2 9.5 3 7z"
                stroke="currentColor" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {event.tool}
          </span>
        </div>
        {event.path && (
          <div style={{
            border: '1px solid #ECE6D5', borderRadius: 8, background: '#FCFAF1',
            padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ color: '#807972', display: 'flex' }}>
              <svg width="13" height="13" viewBox="0 0 13 13">
                <path d="M2.5 2h5l3 3v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M7.5 2v3h3"
                  stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/>
              </svg>
            </span>
            <code style={{ fontFamily: MONO_FONT, fontSize: 12.5, color: '#1C1A17', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {event.path}
            </code>
            {event.result && event.result !== 'pending' && (
              <span style={{ fontSize: 12, color: event.result === 'ok' ? '#6E9E5B' : '#C4644A', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {event.result === 'ok' && (
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {event.result}
              </span>
            )}
            {event.result === 'pending' && (
              <span style={{ fontSize: 11.5, color: '#A89F92' }}>running…</span>
            )}
          </div>
        )}
        {event.detail && (
          <div style={{ padding: '4px 14px 0', fontSize: 12, color: '#807972', fontFamily: MONO_FONT }}>
            {event.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolResultEvent({ event, agentsMap }) {
  const agent = agentsMap[event.author];
  if (!agent) return null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '6px 0 6px 42px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          border: '1px solid #ECE6D5', borderRadius: 8, background: '#FCFAF1',
          padding: '8px 12px', fontSize: 12.5, color: '#5C544B', fontFamily: MONO_FONT,
          maxHeight: 120, overflow: 'auto',
        }}>
          {event.output || '(no output)'}
        </div>
      </div>
    </div>
  );
}

function StreamingIndicator({ agentsMap, currentAgentId }) {
  const agent = currentAgentId ? agentsMap[currentAgentId] : null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      {agent && <Avatar agent={agent} size={28} />}
      {!agent && <div style={{ width: 28, height: 28 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#A89F92', fontSize: 13 }}>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#C4644A',
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
              opacity: 0.7,
            }} />
          ))}
        </span>
        {agent ? `${agent.name} is thinking…` : 'Agent is thinking…'}
      </div>
    </div>
  );
}

function EventRouter({ event, agentsMap }) {
  if (event.kind === 'message') return <MessageEvent event={event} agentsMap={agentsMap} />;
  if (event.kind === 'thinking') return <ThinkingEvent event={event} agentsMap={agentsMap} />;
  if (event.kind === 'tool') return <ToolEvent event={event} agentsMap={agentsMap} />;
  if (event.kind === 'tool_result') return <ToolResultEvent event={event} agentsMap={agentsMap} />;
  return null;
}

// ─── Task header ──────────────────────────────────────────────────────────────

const headerBtn = {
  padding: '5px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #DCD3BC', background: '#FCFAF1', color: '#1C1A17',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function TaskHeader({ chat, agentsMap, isStreaming, onCancel }) {
  if (!chat) return null;
  const leadAgent = agentsMap[chat.main_agent_id] || agentsMap[chat.current_agent_id];
  const age = relativeTime(chat.created_at);
  const status = chat.stream?.status === 'streaming' ? 'running' : chat.status || 'active';

  return (
    <div style={{ padding: '20px 36px 16px', borderBottom: '1px solid #ECE6D5', background: '#FAF5E8' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5, color: '#A89F92', marginBottom: 6 }}>
        <span style={{ fontFamily: MONO_FONT, color: '#5C544B' }}>{chat.id?.slice(0, 8)}</span>
        <span>·</span>
        <span>opened {age}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <h1 style={{
          flex: 1, margin: 0, fontSize: 22, fontWeight: 600,
          color: '#1C1A17', letterSpacing: -0.2, lineHeight: 1.2,
        }}>{chat.title || 'Untitled chat'}</h1>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {isStreaming ? (
            <button style={headerBtn} onClick={onCancel}>Cancel</button>
          ) : (
            <button style={headerBtn}>Pause crew</button>
          )}
          <button style={headerBtn}>Share…</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <MetaPill dot dotColor={status === 'running' ? '#C4644A' : '#9C8F77'}>
          <span style={{ color: '#1C1A17', fontWeight: 500 }}>{status}</span>
        </MetaPill>
        {leadAgent && (
          <MetaPill>
            <Avatar agent={leadAgent} size={14} /> lead · {leadAgent.name}
          </MetaPill>
        )}
        {chat.participant_agent_ids?.length > 1 && (
          <MetaPill>{chat.participant_agent_ids.length} agents</MetaPill>
        )}
      </div>
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function Composer({ onSend, disabled }) {
  const [val, setVal] = React.useState('');
  const ta = React.useRef(null);

  React.useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(160, ta.current.scrollHeight) + 'px';
  }, [val]);

  const send = () => {
    const text = val.trim();
    if (!text || disabled) return;
    setVal('');
    onSend(text);
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };

  return (
    <div style={{ borderTop: '1px solid #ECE6D5', background: '#FCFAF1', padding: '14px 36px 16px' }}>
      <div style={{
        border: '1px solid #DCD3BC', borderRadius: 12, background: '#FFFEF8',
        padding: '10px 12px 8px', boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
      }}>
        <textarea
          data-testid="composer-input"
          ref={ta}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={disabled ? 'Crew is working…' : 'Steer the crew — @agent to direct, ⌘↵ to send'}
          rows={1}
          style={{
            width: '100%', border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', fontFamily: UI_FONT, fontSize: 14,
            color: '#1C1A17', lineHeight: 1.5, padding: 4,
            opacity: disabled ? 0.5 : 1,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button style={chip}>@ @agent</button>
          <button style={chip}>Plan ▾</button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: '#A89F92' }}>⌘↵ send</span>
          <button
            data-testid="composer-send"
            onClick={send}
            disabled={disabled || !val.trim()}
            style={{
              ...chip,
              background: val.trim() && !disabled ? '#1C1A17' : '#F0EAD8',
              color: val.trim() && !disabled ? '#FCFBF7' : '#A89F92',
              border: '1px solid ' + (val.trim() && !disabled ? '#1C1A17' : '#E6DFCC'),
              fontWeight: 500,
            }}
          >↑ Send</button>
        </div>
      </div>
    </div>
  );
}

// ─── TaskView ─────────────────────────────────────────────────────────────────

export default function TaskView({ chatId, agentsMap }) {
  const [chat, setChat] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [error, setError] = React.useState(null);
  const timelineRef = React.useRef(null);
  const lastSeqRef = React.useRef(0);
  const sseCleanupRef = React.useRef(() => {});

  // Auto-scroll when events change
  React.useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [events.length]);

  const connectSSE = React.useCallback((id, after) => {
    sseCleanupRef.current();
    setIsStreaming(true);

    const cleanup = api.streamChatEvents(
      id,
      after,
      (event) => {
        setEvents(prev => {
          if (prev.some(e => e._seq === event.seq)) return prev;
          lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);
          const mapped = mapBackendEvent(event);
          if (!mapped) return prev;

          // Merge tool_call_result into preceding tool event
          if (mapped.kind === 'tool_result') {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].kind === 'tool' && updated[i].tool === mapped.name && updated[i].result === 'pending') {
                updated[i] = { ...updated[i], result: 'ok', detail: mapped.output?.slice(0, 120) };
                return updated;
              }
            }
            return prev; // discard unmatched result
          }

          return [...prev, mapped];
        });
      },
      () => {
        setIsStreaming(false);
        // Refresh chat metadata
        api.getChat(id).then(setChat).catch(() => {});
      },
      (err) => {
        console.error('SSE error:', err);
        setIsStreaming(false);
      }
    );
    sseCleanupRef.current = cleanup;
  }, []);

  // Load chat + connect SSE when chatId changes
  React.useEffect(() => {
    if (!chatId) return;

    setChat(null);
    setEvents([]);
    setError(null);
    lastSeqRef.current = 0;

    api.getChat(chatId)
      .then(c => {
        setChat(c);
        setIsStreaming(c.stream?.status === 'streaming');
      })
      .catch(err => setError(err.message));

    connectSSE(chatId, 0);

    return () => {
      sseCleanupRef.current();
      sseCleanupRef.current = () => {};
    };
  }, [chatId, connectSSE]);

  const handleSend = React.useCallback(async (text) => {
    if (!chatId) return;

    // Optimistic user message
    const now = new Date();
    const ts = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    setEvents(prev => [...prev, {
      kind: 'message',
      author: '__human__',
      time: ts,
      body: text,
      _seq: -Date.now(),
    }]);

    try {
      // target_agent_id is required by the backend — use current agent, fall back to lead
      const targetAgentId = chat?.current_agent_id || chat?.main_agent_id;
      await api.postMessage(chatId, text, targetAgentId);
      // Reconnect SSE after the last known seq to get agent response
      connectSSE(chatId, lastSeqRef.current);
    } catch (err) {
      console.error('Send failed:', err);
      setIsStreaming(false);
    }
  }, [chatId, chat, connectSSE]);

  const handleCancel = React.useCallback(async () => {
    if (!chatId) return;
    try {
      await api.cancelChat(chatId);
      sseCleanupRef.current();
      setIsStreaming(false);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  }, [chatId]);

  if (error) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FAF5E8', color: '#807972', fontSize: 13.5 }}>
        Failed to load chat: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#FAF5E8' }}>
      <TaskHeader
        chat={chat}
        agentsMap={agentsMap}
        isStreaming={isStreaming}
        onCancel={handleCancel}
      />
      <div ref={timelineRef} style={{ flex: 1, overflow: 'auto', padding: '8px 36px 16px' }}>
        <div style={{ maxWidth: 880 }}>
          {events.map((e, i) => <EventRouter key={e._seq ?? i} event={e} agentsMap={agentsMap} />)}
          {isStreaming && events.length > 0 && (
            <StreamingIndicator agentsMap={agentsMap} currentAgentId={chat?.current_agent_id} />
          )}
          {events.length === 0 && !isStreaming && (
            <div style={{ paddingTop: 40, color: '#A89F92', fontSize: 13.5, fontStyle: 'italic' }}>
              No events yet.
            </div>
          )}
        </div>
      </div>
      <Composer onSend={handleSend} disabled={isStreaming} />
      <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }`}</style>
    </div>
  );
}
