import React from 'react';
import { Avatar, RichText, UI_FONT, MONO_FONT } from './components.jsx';
import { mapBackendEvent, mergeToolResults, relativeTime, formatTime, HUMAN_USER, resolveAuthor } from './utils.js';
import * as api from './api.js';
import { clearComposerDraft, readComposerDraft, writeComposerDraft } from './draftStore.js';

// ─── Event renderers ──────────────────────────────────────────────────────────

function DeletedTag() {
  return (
    <span
      data-testid="deleted-agent-tag"
      title="This agent has been deleted"
      style={{
        marginLeft: 6,
        padding: '1px 6px',
        borderRadius: 4,
        background: '#F0EAD8',
        color: '#807972',
        fontSize: 10.5,
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >deleted</span>
  );
}

// Collapsible "thought for Ns" chip — used standalone in ThinkingEvent and
// inlined inside MessageEvent when a thinking event immediately precedes a
// message from the same author.
function ThoughtChip({ thought }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button
        data-testid="thought-chip"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '4px 10px 4px 8px', borderRadius: 999,
          background: open ? '#F7EFDD' : '#FCFAF1',
          border: '1px solid ' + (open ? '#E9D7B6' : '#ECE6D5'),
          color: '#5C544B', fontSize: 12.5, cursor: 'pointer',
          fontFamily: UI_FONT,
        }}
      >
        <span style={{ color: '#C4644A', display: 'flex' }}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <circle cx="3" cy="5.5" r="0.9" fill="currentColor"/>
            <circle cx="5.5" cy="5.5" r="0.9" fill="currentColor"/>
            <circle cx="8" cy="5.5" r="0.9" fill="currentColor"/>
          </svg>
        </span>
        <span style={{ color: '#807972' }}>
          {thought.seconds > 0 ? `thought for ${thought.seconds}s` : 'thinking'}
        </span>
        <span
          aria-hidden="true"
          style={{
            color: '#A89F92', display: 'flex',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      </button>
      {open && (
        <div
          data-testid="thought-chip-body"
          style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 8,
            background: '#FCFAF1', border: '1px solid #ECE6D5',
            fontSize: 13, color: '#5C544B', lineHeight: 1.6, fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            animation: 'cw-expand-in .18s ease',
          }}
        >{thought.reasoning || ''}</div>
      )}
    </div>
  );
}

function MessageEvent({ event, agentsMap, thought }) {
  const agent = resolveAuthor(event.author, agentsMap) || HUMAN_USER;
  const isUser = agent.kind === 'human';

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 0' }}>
        <div style={{
          maxWidth: '72%',
          background: '#EFE9D8',
          color: '#1C1A17',
          fontSize: 14, lineHeight: 1.55,
          padding: '10px 16px',
          borderRadius: 18,
          fontFamily: UI_FONT,
        }}>
          <RichText text={event.body} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 14, padding: '14px 0' }}>
      <Avatar agent={agent} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
          {agent.archived && <DeletedTag />}
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
        </div>
        {thought && (
          <div style={{ marginBottom: 8 }}>
            <ThoughtChip thought={thought} />
          </div>
        )}
        <div style={{ fontSize: 14, color: '#1C1A17', lineHeight: 1.55 }}>
          <RichText text={event.body} />
        </div>
      </div>
    </div>
  );
}

function ThinkingEvent({ event, agentsMap }) {
  const agent = resolveAuthor(event.author, agentsMap);
  if (!agent || agent.kind !== 'agent') return null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={agent} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
          {agent.archived && <DeletedTag />}
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
        </div>
        <ThoughtChip thought={event} />
      </div>
    </div>
  );
}

function ToolStatusChip({ result }) {
  if (result === 'pending') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: '#A89F92', flexShrink: 0,
      }}>
        <span style={{ display: 'flex', animation: 'cw-spin 1.2s linear infinite' }}>
          <svg width="11" height="11" viewBox="0 0 11 11">
            <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 3"/>
          </svg>
        </span>
        running
      </span>
    );
  }
  if (result === 'error') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 11, color: '#B23A2E', fontWeight: 500, flexShrink: 0,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#B23A2E', display: 'inline-block' }} />
        failed
      </span>
    );
  }
  if (result === 'ok' || result) {
    return (
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: '#6E9E5B',
        display: 'inline-block', flexShrink: 0,
      }} />
    );
  }
  return null;
}

// The collapsible card body for a single tool call. Used both standalone
// (inside ToolEvent) and as a child inside ToolGroupEvent's expanded list.
function ToolEventCard({ event, defaultOpen = false }) {
  const [expanded, setExpanded] = React.useState(defaultOpen);
  const fullOutput = event.output || event.detail || '';
  const hasOutput = Boolean(fullOutput);
  const pathOverflows = Boolean(event.path && event.path.length > 80);
  const canExpand = hasOutput || pathOverflows;

  return (
    <div style={{
      borderRadius: 6, overflow: 'hidden',
      background: expanded ? '#FCFAF1' : 'transparent',
      border: '1px solid ' + (expanded ? '#ECE6D5' : 'transparent'),
      transition: 'background .15s, border-color .15s',
    }}>
      <button
        type="button"
        data-testid="tool-event-row"
        aria-expanded={expanded}
        onClick={() => { if (canExpand) setExpanded(v => !v); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '4px 8px',
          background: 'transparent', border: 'none',
          cursor: canExpand ? 'pointer' : 'default',
          fontFamily: UI_FONT, textAlign: 'left',
          color: '#807972',
        }}
      >
        <span aria-hidden="true" style={{
          color: '#A89F92', display: 'flex',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform .15s',
          opacity: canExpand ? 1 : 0.3,
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
        <span style={{
          fontFamily: MONO_FONT, fontSize: 12, color: '#807972', fontWeight: 400,
        }}>{event.tool}</span>
        {event.path && (
          <span style={{
            fontFamily: MONO_FONT, fontSize: 12, color: '#A89F92',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, minWidth: 0,
          }}>{event.path}</span>
        )}
        {!event.path && <span style={{ flex: 1 }} />}
        <span style={{ fontSize: 11, color: '#A89F92', flexShrink: 0 }}>{event.time}</span>
        <ToolStatusChip result={event.result} />
      </button>
      {expanded && (
        <div
          data-testid="tool-event-detail"
          style={{
            borderTop: '1px solid #ECE6D5', background: '#FFFEF8',
            padding: '10px 14px',
            fontFamily: MONO_FONT, fontSize: 12.5, color: '#1C1A17',
            whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 400,
            lineHeight: 1.55,
            animation: 'cw-expand-in .18s ease',
          }}
        >
          {pathOverflows && (
            <div style={{ marginBottom: hasOutput ? 8 : 0 }}>{event.path}</div>
          )}
          {hasOutput && (
            <span style={{ color: event.result === 'error' ? '#B23A2E' : '#1C1A17' }}>{fullOutput}</span>
          )}
        </div>
      )}
    </div>
  );
}

function ToolEventGutter({ author, time, showHeader, agentsMap, children, testid }) {
  const agent = resolveAuthor(author, agentsMap);
  if (!agent || agent.kind !== 'agent') return null;
  return (
    <div
      data-testid={testid}
      style={{ display: 'flex', gap: 14, padding: showHeader ? '10px 0' : '2px 0' }}
    >
      {showHeader
        ? <Avatar agent={agent} size={28} />
        : <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {showHeader && (
          <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
            {agent.archived && <DeletedTag />}
            <span style={{ color: '#A89F92' }}>· {time}</span>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// Compact, click-to-expand tool call.
function ToolEvent({ event, agentsMap, showHeader = true }) {
  return (
    <ToolEventGutter
      author={event.author} time={event.time}
      showHeader={showHeader} agentsMap={agentsMap}
      testid="tool-event"
    >
      <ToolEventCard event={event} />
    </ToolEventGutter>
  );
}

// Consecutive tool calls from the same agent collapse into a single header
// row ("Used N tools  name · name · name"). Expanding reveals each tool's
// own compact body.
function ToolGroupEvent({ events, agentsMap, showHeader = true }) {
  const [open, setOpen] = React.useState(false);
  const anyError = events.some(e => e.result === 'error');
  const anyPending = events.some(e => e.result === 'pending');
  const status = anyPending ? 'pending' : anyError ? 'error' : 'ok';

  return (
    <ToolEventGutter
      author={events[0].author} time={events[0].time}
      showHeader={showHeader} agentsMap={agentsMap}
      testid="tool-group"
    >
      <div style={{
        borderRadius: 6, overflow: 'hidden',
        background: open ? '#FCFAF1' : 'transparent',
        border: '1px solid ' + (open ? '#ECE6D5' : 'transparent'),
        transition: 'background .15s, border-color .15s',
      }}>
        <button
          type="button"
          data-testid="tool-group-row"
          aria-expanded={open}
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '4px 8px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontFamily: UI_FONT, textAlign: 'left', color: '#807972',
          }}
        >
          <span aria-hidden="true" style={{
            color: '#A89F92', display: 'flex',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
          <span style={{ fontSize: 12, color: '#5C544B' }}>Used {events.length} tools</span>
          {!open && (
            <span style={{
              fontFamily: MONO_FONT, fontSize: 12, color: '#A89F92',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              flex: 1, minWidth: 0,
            }}>{events.map(e => e.tool).join(' · ')}</span>
          )}
          {open && <span style={{ flex: 1 }} />}
          <ToolStatusChip result={status} />
        </button>
        {open && (
          <div style={{
            borderTop: '1px solid #ECE6D5', background: '#FFFEF8',
            padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2,
            animation: 'cw-expand-in .18s ease',
          }}>
            {events.map((e, i) => <ToolEventCard key={e._seq ?? i} event={e} />)}
          </div>
        )}
      </div>
    </ToolEventGutter>
  );
}

function ToolResultEvent({ event, agentsMap }) {
  const agent = resolveAuthor(event.author, agentsMap);
  if (!agent || agent.kind !== 'agent') return null;
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

// Playful gerunds rotated through the streaming indicator instead of the
// flat "thinking…" string. Borrowed from Claude Code's waiting-word style.
const WAITING_GERUNDS = [
  'Pondering', 'Mulling', 'Marinating', 'Brewing', 'Percolating',
  'Steeping', 'Simmering', 'Proofing', 'Kneading', 'Fermenting',
  'Noodling', 'Bootstrapping', 'Crystallizing', 'Distilling',
  'Synthesizing', 'Untangling', 'Composing', 'Sketching', 'Drafting',
  'Tinkering', 'Wrangling', 'Weaving', 'Threading', 'Stitching',
  'Tracing', 'Mapping', 'Plotting', 'Riffing', 'Whittling',
  'Polishing', 'Refining', 'Conjuring', 'Fluttering', 'Whirring',
  'Murmuring', 'Untwisting', 'Rummaging', 'Cogitating',
];

const WAITING_WORD_INTERVAL_MS = 8000;

function pickRandomGerund(previous) {
  if (WAITING_GERUNDS.length <= 1) return WAITING_GERUNDS[0];
  let next = previous;
  while (next === previous) {
    next = WAITING_GERUNDS[Math.floor(Math.random() * WAITING_GERUNDS.length)];
  }
  return next;
}

function StreamingIndicator({ agentsMap, currentAgentId }) {
  const agent = currentAgentId ? resolveAuthor(currentAgentId, agentsMap) : null;
  const [word, setWord] = React.useState(() => pickRandomGerund(null));
  React.useEffect(() => {
    const id = setInterval(() => {
      setWord(prev => pickRandomGerund(prev));
    }, WAITING_WORD_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
  const subject = agent ? `${agent.name} is` : 'Agent is';
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      {agent && <Avatar agent={agent} size={28} />}
      {!agent && <div style={{ width: 28, height: 28 }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#A89F92', fontSize: 13 }}>
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#C4644A',
            animation: 'pulse 1.6s ease-in-out infinite',
            flexShrink: 0,
          }}
        />
        <span>
          {subject}{' '}
          <span
            key={word}
            style={{
              display: 'inline-block',
              animation: 'wordFadeIn 360ms ease-out',
              color: '#7A6F5F',
            }}
          >
            {word}…
          </span>
        </span>
      </div>
    </div>
  );
}

function EventRouter({ event, agentsMap, showHeader = true, thought }) {
  if (event.kind === 'message') return <MessageEvent event={event} agentsMap={agentsMap} thought={thought} />;
  if (event.kind === 'thinking') return <ThinkingEvent event={event} agentsMap={agentsMap} />;
  if (event.kind === 'tool') return <ToolEvent event={event} agentsMap={agentsMap} showHeader={showHeader} />;
  if (event.kind === 'tool_group') return <ToolGroupEvent events={event.events} agentsMap={agentsMap} showHeader={showHeader} />;
  if (event.kind === 'tool_result') return <ToolResultEvent event={event} agentsMap={agentsMap} />;
  if (event.kind === 'error') return <ErrorEvent event={event} agentsMap={agentsMap} />;
  // runtime_session is intentionally swallowed; no UI for it.
  return null;
}

// ─── Task header ──────────────────────────────────────────────────────────────

const conversationColumn = {
  width: '100%',
  maxWidth: 880,
  margin: '0 auto',
};

const headerColumn = {
  width: '100%',
  maxWidth: 960,
  margin: '0 auto',
};

function elapsedText(start, end) {
  if (!start) return '';
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) return '';
  const endMs = end ? new Date(end).getTime() : Date.now();
  let secs = Math.max(0, Math.floor((endMs - startMs) / 1000));
  if (secs < 60) return `${secs}s`;
  const days = Math.floor(secs / 86400); secs -= days * 86400;
  const hours = Math.floor(secs / 3600); secs -= hours * 3600;
  const mins = Math.floor(secs / 60);
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || (!days && !hours)) parts.push(`${mins}m`);
  return parts.join(' ');
}

function TaskHeader({ chat, events }) {
  // Find the most recent error event — when an agent runtime errors out, the
  // SSE stream stays open but no useful work is happening, so freeze the
  // elapsed counter at the error's timestamp.
  const lastErrorTs = React.useMemo(() => {
    if (!events?.length) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === 'error' && events[i].tsISO) return events[i].tsISO;
    }
    return null;
  }, [events]);

  const streamingFromChat = chat?.stream?.status === 'streaming';
  const isStreaming = streamingFromChat && !lastErrorTs;

  // Tick once per second while running so the elapsed string advances live.
  const [, forceTick] = React.useReducer(x => x + 1, 0);
  React.useEffect(() => {
    if (!isStreaming) return;
    const t = setInterval(forceTick, 1000);
    return () => clearInterval(t);
  }, [isStreaming]);
  if (!chat) return null;
  const age = relativeTime(chat.created_at);
  const participantCount = chat.participant_agent_ids?.length || 0;
  const elapsedEnd = isStreaming ? null : (lastErrorTs || chat.updated_at);
  const elapsed = elapsedText(chat.created_at, elapsedEnd);

  const metaItems = [];
  if (participantCount > 1) metaItems.push(`${participantCount} agents`);
  if (elapsed) metaItems.push(`elapsed ${elapsed}`);

  return (
    <div style={{ padding: '20px 36px 16px', borderBottom: '1px solid #ECE6D5', background: '#FAF5E8', WebkitAppRegion: 'drag' }}>
      <div style={headerColumn}>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 600,
          color: '#1C1A17', letterSpacing: -0.2, lineHeight: 1.2,
        }}>{chat.title || 'Untitled chat'}</h1>
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
          fontSize: 12.5, color: '#A89F92', marginTop: 8,
        }}>
          <span style={{ fontFamily: MONO_FONT, color: '#5C544B' }}>{chat.id?.slice(0, 8)}</span>
          <span style={{ color: '#D6CDB6' }}>·</span>
          <span>opened {age}</span>
          {metaItems.map((m, i) => (
            <React.Fragment key={i}>
              <span style={{ color: '#D6CDB6' }}>·</span>
              <span>{m}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Handover divider ─────────────────────────────────────────────────────────

function handoverVerb(subtype) {
  if (subtype === 'return') return 'returned to';
  if (subtype === 'escalate') return 'escalated to';
  return 'handed off to';
}

function HandoverDivider({ from, to, note, subtype, agentsMap }) {
  const fromAgent = resolveAuthor(from, agentsMap);
  const toAgent = resolveAuthor(to, agentsMap);
  const [open, setOpen] = React.useState(false);
  if (!fromAgent || !toAgent) return null;
  const hasNote = Boolean(note);
  const chipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '4px 12px 4px 6px', borderRadius: 999,
    background: '#FCFAF1', border: '1px solid #ECE6D5',
    fontFamily: UI_FONT,
    maxWidth: '80%',
  };
  const chipContent = (
    <>
      <Avatar agent={fromAgent} size={18} />
      <svg width="12" height="10" viewBox="0 0 12 10" style={{ color: '#A89F92' }}>
        <path d="M1 5h9M7 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <Avatar agent={toAgent} size={18} />
      <span style={{ fontSize: 12, color: '#5C544B', marginLeft: 2, textAlign: 'left' }}>
        <span style={{ color: '#807972' }}>{fromAgent.name}{fromAgent.archived && <DeletedTag />} {handoverVerb(subtype)} </span>
        <span style={{ color: '#1C1A17', fontWeight: 500 }}>{toAgent.name}</span>
        {toAgent.archived && <DeletedTag />}
        {open && hasNote && (
          <span style={{ color: '#A89F92' }}>
            {Array.from(' · ' + note).map((ch, idx) => (
              <span
                key={idx}
                style={{
                  display: 'inline-block',
                  whiteSpace: 'pre',
                  animation: 'cw-type-jump .14s ease-out both',
                  animationDelay: `${idx * 7}ms`,
                }}
              >{ch}</span>
            ))}
          </span>
        )}
      </span>
      {hasNote && (
        <span aria-hidden="true" style={{
          color: '#A89F92', display: 'flex', marginLeft: 2, flexShrink: 0,
          transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform .15s',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </span>
      )}
    </>
  );
  return (
    <div
      data-testid="handover-divider"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 0 10px', userSelect: 'none',
      }}
    >
      <div style={{ flex: 1, height: 0, borderTop: '1px dashed #DCD3BC' }} />
      {hasNote ? (
        <button
          type="button"
          data-testid="handover-toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
          style={{ ...chipStyle, cursor: 'pointer' }}
        >
          {chipContent}
        </button>
      ) : (
        <div style={chipStyle}>
          {chipContent}
        </div>
      )}
      <div style={{ flex: 1, height: 0, borderTop: '1px dashed #DCD3BC' }} />
    </div>
  );
}

// ─── Error event ──────────────────────────────────────────────────────────────

function ErrorEvent({ event, agentsMap }) {
  const author = event.agent_id || event.author;
  const agent = author ? resolveAuthor(author, agentsMap) : null;
  return (
    <div data-testid="error-event" style={{ display: 'flex', gap: 14, padding: '8px 0' }}>
      {agent && agent.kind === 'agent'
        ? <Avatar agent={agent} size={28} />
        : <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          border: '1px solid #E9C5BC', borderRadius: 10,
          background: '#FBEEE7', overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid #EFD3C9', background: '#FBE6DC',
          }}>
            <span style={{ color: '#B23A2E', display: 'flex' }}>
              <svg width="11" height="11" viewBox="0 0 11 11">
                <path d="M5.5 2v4M5.5 8v0.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/>
                <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="1" fill="none"/>
              </svg>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B23A2E', letterSpacing: 0.2 }}>
              {(event.subtype || 'error').replace(/_/g, ' ')}
            </span>
            {event.code && (
              <code style={{
                fontFamily: MONO_FONT, fontSize: 11.5, color: '#B23A2E',
                background: '#F1D4C9', padding: '1px 6px', borderRadius: 4,
              }}>{event.code}</code>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: '#9C5142' }}>{event.time}</span>
          </div>
          <div style={{ padding: '10px 14px' }}>
            <div style={{ fontSize: 13.5, color: '#1C1A17', lineHeight: 1.55 }}>
              <RichText text={event.message} />
            </div>
            {(event.agent_name || event.target_agent_name) && (
              <div style={{
                marginTop: 8, fontSize: 11.5, color: '#9C5142',
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              }}>
                {event.agent_name && (
                  <span>raised by <b style={{ color: '#B23A2E', fontWeight: 600 }}>{event.agent_name}</b></span>
                )}
                {event.target_agent_name && (
                  <>
                    <span>·</span>
                    <span>target <b style={{ color: '#B23A2E', fontWeight: 600 }}>{event.target_agent_name}</b></span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Pre-pass: drop runtime_session events (no UI), and when a thinking event
// is immediately followed by a message from the same author, attach it to
// that message as `_thought` so the message can render the chip inline
// instead of standalone.
function prepareEvents(events) {
  const visible = events.filter(e => e && e.kind !== 'runtime_session');
  const out = [];
  for (let i = 0; i < visible.length; i++) {
    const e = visible[i];
    if (e.kind === 'thinking') {
      const next = visible[i + 1];
      if (next && next.kind === 'message' && next.author === e.author) {
        out.push({ ...next, _thought: e });
        i += 1;
        continue;
      }
    }
    out.push(e);
  }
  return out;
}

// Collapse runs of consecutive `tool` events from the same author into a
// single `tool_group` synthetic event. A single tool stays as `tool` so it
// keeps its standalone compact row.
function groupConsecutiveTools(events) {
  const out = [];
  for (const e of events) {
    if (e.kind === 'tool') {
      const last = out[out.length - 1];
      if (last && last._toolRun && last.author === e.author) {
        last.events.push(e);
        continue;
      }
      out.push({ _toolRun: true, kind: 'tool_group', author: e.author, time: e.time, events: [e], _seq: e._seq });
      continue;
    }
    out.push(e);
  }
  return out.map(e => (e._toolRun && e.events.length === 1) ? e.events[0] : e);
}

function renderEventsWithHandovers({ events, agentsMap }) {
  const prepared = groupConsecutiveTools(prepareEvents(events));
  const out = [];
  // Track the last *agent* actor, not the last event author. A human turn
  // between two agents (e.g. "@Designer take it from here") should still let
  // us recognize the agent-to-agent handover that follows it.
  let prevAgentActor = null;
  // Track the previous event's tool author so consecutive tool calls from
  // the same agent share one header (avatar+name+time) instead of repeating.
  let prevToolAuthor = null;
  const isAgentActor = (id) => id && id !== '__human__';

  prepared.forEach((e, i) => {
    // 1. Explicit backend-emitted handover → render directly and update the
    //    last-agent tracker so the next agent message doesn't synthesize a
    //    duplicate divider.
    //
    //    The daemon emits TWO handover events per handoff: a "scheduled"
    //    event (source → target, what the user actually wants to see) and
    //    an "occurred" event written as the new agent activates with both
    //    sides set to that new agent (source === target — degenerate).
    //    Drop the degenerate one so we don't render "Designer → Designer".
    if (e.kind === 'handover') {
      const from = e.agent_id || e.author;
      const to = e.target_agent_id;
      if (from && to && from !== to) {
        out.push(
          <HandoverDivider
            key={`h-${e._seq ?? i}`}
            from={from}
            to={to}
            subtype={e.subtype}
            note={e.note}
            agentsMap={agentsMap}
          />
        );
        prevAgentActor = to;
        prevToolAuthor = null;
      } else if (from && to && from === to) {
        // Still update the actor tracker so subsequent events don't
        // synthesize a fallback divider for the same identity.
        prevAgentActor = to;
      }
      return;
    }

    // 2. Synthesized fallback for actor changes without an explicit handover
    //    event (e.g. user retargets via the composer's AgentPicker).
    const actor = e.author;
    if (isAgentActor(actor) && prevAgentActor && actor !== prevAgentActor) {
      out.push(
        <HandoverDivider
          key={`syn-${e._seq ?? i}`}
          from={prevAgentActor}
          to={actor}
          agentsMap={agentsMap}
        />
      );
    }

    const isTool = e.kind === 'tool' || e.kind === 'tool_group';
    const showHeader = !(isTool && prevToolAuthor === actor && actor);
    out.push(
      <EventRouter
        key={e._seq ?? i}
        event={e}
        agentsMap={agentsMap}
        showHeader={showHeader}
        thought={e._thought}
      />
    );

    if (isAgentActor(actor)) prevAgentActor = actor;
    prevToolAuthor = isTool ? actor : null;
  });
  return out;
}

// ─── Composer ─────────────────────────────────────────────────────────────────

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionBounds(value, cursor) {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor, query: match[2] || '' };
}

function mentionDeleteBounds(value, cursor, agents) {
  const names = agents.map(a => a.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0 || cursor <= 0) return null;

  const before = value.slice(0, cursor);
  const mentionRe = new RegExp(`(^|\\s)@(${names.map(escapeRegExp).join('|')})\\s?$`);
  const match = before.match(mentionRe);
  if (!match) return null;

  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor };
}

function HighlightedComposerText({ text, agents }) {
  if (!text) return null;
  const names = agents.map(a => a.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const mentionRe = new RegExp(`@(${names.map(escapeRegExp).join('|')})(?=$|\\s|[.,!?;:])`, 'g');
  const parts = [];
  let last = 0;
  let match;
  while ((match = mentionRe.exec(text))) {
    if (match.index > last) parts.push({ kind: 'text', value: text.slice(last, match.index) });
    parts.push({ kind: 'mention', value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });

  return (
    <>
      {parts.map((part, index) => part.kind === 'mention' ? (
        <span
          key={index}
          data-testid="composer-mention-highlight"
          style={{ color: '#2F79D8', fontWeight: 'inherit' }}
        >
          {part.value}
        </span>
      ) : (
        <React.Fragment key={index}>{part.value}</React.Fragment>
      ))}
    </>
  );
}

function AgentPicker({ value, onChange, agents }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const agent = agents.find(a => a.id === value) || agents[0];
  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!agent) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        data-testid="composer-agent-picker"
        onClick={() => setOpen(!open)}
        title={`Talking to ${agent.name} — click to redirect`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 8px 3px 3px', borderRadius: 999,
          border: '1px solid #E6DFCC', background: '#FCFAF1', cursor: 'pointer',
          fontFamily: UI_FONT,
        }}
      >
        <Avatar agent={agent} size={18} />
        <span style={{ fontSize: 12.5, color: '#1C1A17', fontWeight: 500 }}>{agent.name}</span>
        <svg width="9" height="9" viewBox="0 0 9 9" style={{ color: '#A89F92', marginLeft: 1 }}>
          <path d="M2 3.5l2.5 2.5L7 3.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Direct message to"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
            minWidth: 220, padding: 4, borderRadius: 10,
            background: '#FFFEF8', border: '1px solid #DCD3BC',
            boxShadow: '0 10px 30px -10px rgba(40,30,15,0.3), 0 4px 10px rgba(40,30,15,0.08)',
            zIndex: 30,
          }}
        >
          <div style={{ padding: '6px 10px 4px', fontSize: 11, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.5 }}>Direct to</div>
          {agents.map(a => {
            const active = a.id === value;
            return (
              <div
                key={a.id}
                role="option"
                aria-selected={active}
                onClick={() => { onChange(a.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                  background: active ? '#F7EFDD' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#FAF5E8'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <Avatar agent={a} size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1C1A17' }}>{a.name}</div>
                  {a.role && <div style={{ fontSize: 11.5, color: '#807972' }}>{a.role}</div>}
                </div>
                {active && (
                  <svg width="12" height="12" viewBox="0 0 12 12" style={{ color: '#C4644A' }}>
                    <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Composer({ onSend, isStreaming, onCancel, agentsMap, chatId, projectId, defaultTargetAgentId, targetAgentId, onChangeTargetAgent }) {
  const [val, setVal] = React.useState(() => readComposerDraft(projectId, chatId).text || '');
  const [cursor, setCursor] = React.useState(0);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const ta = React.useRef(null);
  const agents = React.useMemo(() => (
    Object.values(agentsMap || {})
      .filter(agent => agent?.id !== '__human__' && agent?.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [agentsMap]);

  React.useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(160, ta.current.scrollHeight) + 'px';
  }, [val]);

  React.useEffect(() => {
    if (!chatId || !projectId) return;
    const draft = readComposerDraft(projectId, chatId);
    setVal(draft.text || '');
    if (draft.targetAgentId) onChangeTargetAgent?.(draft.targetAgentId);
  }, [chatId, projectId, onChangeTargetAgent]);

  React.useEffect(() => {
    if (!chatId || !projectId) return;
    writeComposerDraft(projectId, chatId, {
      text: val,
      targetAgentId: targetAgentId && targetAgentId !== defaultTargetAgentId ? targetAgentId : '',
    });
  }, [chatId, projectId, defaultTargetAgentId, targetAgentId, val]);

  const activeMention = React.useMemo(() => mentionBounds(val, cursor), [val, cursor]);
  const mentionOptions = React.useMemo(() => {
    if (!activeMention) return [];
    const q = activeMention.query.toLowerCase();
    return agents.filter(agent => agent.name.toLowerCase().includes(q)).slice(0, 6);
  }, [activeMention, agents]);

  React.useEffect(() => {
    setActiveSuggestion(0);
  }, [activeMention?.query]);

  const updateCursor = (node) => {
    setCursor(node?.selectionStart ?? val.length);
  };

  const selectMention = (agent) => {
    if (!activeMention) return;
    const next = `${val.slice(0, activeMention.start)}@${agent.name} ${val.slice(activeMention.end)}`;
    const nextCursor = activeMention.start + agent.name.length + 2;
    setVal(next);
    setCursor(nextCursor);
    window.requestAnimationFrame?.(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const send = () => {
    const text = val.trim();
    if (!text || isStreaming) return;
    setVal('');
    if (chatId && projectId) clearComposerDraft(projectId, chatId);
    onSend(text);
  };

  const onKeyDown = (e) => {
    if (
      e.key === 'Backspace' &&
      e.currentTarget.selectionStart === e.currentTarget.selectionEnd
    ) {
      const bounds = mentionDeleteBounds(val, e.currentTarget.selectionStart, agents);
      if (bounds) {
        e.preventDefault();
        const next = val.slice(0, bounds.start) + val.slice(bounds.end);
        setVal(next);
        setCursor(bounds.start);
        window.requestAnimationFrame?.(() => {
          ta.current?.setSelectionRange(bounds.start, bounds.start);
        });
        return;
      }
    }

    if (mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion(i => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion(i => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(mentionOptions[activeSuggestion] || mentionOptions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCursor(-1);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
  };

  const canSend = Boolean(val.trim()) && !isStreaming;

  return (
    <div style={{ background: '#FAF5E8', padding: '0 36px 16px' }}>
      <div
        data-testid="composer-column"
        style={{
          ...conversationColumn,
          border: '1px solid #DCD3BC', borderRadius: 12, background: '#FFFEF8',
          padding: '10px 12px 8px', boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ position: 'relative' }}>
          {mentionOptions.length > 0 && (
            <div
              role="listbox"
              aria-label="Agent suggestions"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 'calc(100% + 8px)',
                zIndex: 5,
                background: '#FFFEF8',
                border: '1px solid #DCD3BC',
                borderRadius: 10,
                boxShadow: '0 8px 24px rgba(28,26,23,0.14)',
                padding: 4,
              }}
            >
              {mentionOptions.map((agent, index) => (
                <div
                  key={agent.id}
                  role="option"
                  aria-selected={index === activeSuggestion}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectMention(agent)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 9px', borderRadius: 7,
                    cursor: 'pointer',
                    background: index === activeSuggestion ? '#EFE9DB' : 'transparent',
                    color: '#1C1A17', fontSize: 13,
                  }}
                >
                  <Avatar agent={agent} size={22} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{agent.name}</div>
                    {agent.role && <div style={{ fontSize: 11.5, color: '#807972' }}>{agent.role}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {val && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'break-word',
                fontFamily: UI_FONT,
                fontSize: 14,
                lineHeight: 1.5,
                padding: 4,
                color: '#1C1A17',
              }}
            >
              <HighlightedComposerText text={val} agents={agents} />
            </div>
          )}
          <textarea
            data-testid="composer-input"
            ref={ta}
            value={val}
            onChange={(e) => { setVal(e.target.value); updateCursor(e.target); }}
            onSelect={(e) => updateCursor(e.target)}
            onClick={(e) => updateCursor(e.target)}
            onKeyUp={(e) => updateCursor(e.target)}
            onKeyDown={onKeyDown}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            disabled={isStreaming}
            placeholder={isStreaming ? 'Crew is working…' : 'Steer the crew — @agent to direct, ⌘↵ to send'}
            rows={1}
            style={{
              position: 'relative', zIndex: 1,
              width: '100%', minHeight: 22, border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', fontFamily: UI_FONT, fontSize: 14,
              color: val ? 'transparent' : '#1C1A17', caretColor: '#1C1A17',
              lineHeight: 1.5, padding: 4,
              opacity: isStreaming ? 0.5 : 1,
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {agents.length > 0 && onChangeTargetAgent && (
            <AgentPicker value={targetAgentId} onChange={onChangeTargetAgent} agents={agents} />
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: '#A89F92' }}>⌘↵ send</span>
          <button
            data-testid="composer-send"
            onClick={isStreaming ? onCancel : send}
            disabled={!isStreaming && !val.trim()}
            style={{
              ...chip,
              background: isStreaming || canSend ? '#1C1A17' : '#F0EAD8',
              color: isStreaming || canSend ? '#FCFBF7' : '#A89F92',
              border: '1px solid ' + (isStreaming || canSend ? '#1C1A17' : '#E6DFCC'),
              fontWeight: 500,
            }}
          >{isStreaming ? 'Stop' : '↑ Send'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── TaskView ─────────────────────────────────────────────────────────────────

export default function TaskView({ chatId, agentsMap, onStreamingChange }) {
  const [chat, setChat] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [targetAgentId, setTargetAgentId] = React.useState(null);
  const timelineRef = React.useRef(null);
  const lastSeqRef = React.useRef(0);
  const streamCleanupRef = React.useRef(() => {});

  // Auto-scroll when events change
  React.useLayoutEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [events.length, isStreaming]);

  React.useEffect(() => {
    if (!chatId) return;
    onStreamingChange?.(chatId, isStreaming);
    // Intentionally no cleanup: a chat may still be streaming on the backend
    // after the user switches away. The sidebar indicator should stay until
    // App.jsx confirms via its background poll that the run actually ended.
  }, [chatId, isStreaming, onStreamingChange]);

  const connectEventStream = React.useCallback((id, after) => {
    streamCleanupRef.current();
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

          if (mapped.kind === 'message' && mapped.author === '__human__') {
            const optimisticIndex = prev.findIndex(e =>
              e._optimistic &&
              e.kind === 'message' &&
              e.author === '__human__' &&
              e.body === mapped.body
            );
            if (optimisticIndex !== -1) {
              const updated = [...prev];
              updated[optimisticIndex] = mapped;
              return updated;
            }
          }

          // Merge tool_call_result into preceding tool event
          if (mapped.kind === 'tool_result') {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].kind === 'tool' && updated[i].tool === mapped.name && updated[i].result === 'pending') {
                updated[i] = {
                  ...updated[i],
                  result: 'ok',
                  output: mapped.output || '',
                  detail: mapped.output?.slice(0, 120),
                };
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
        console.error('Chat stream error:', err);
        setIsStreaming(false);
      }
    );
    streamCleanupRef.current = cleanup;
  }, []);

  // Load chat + connect event stream when chatId changes
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
        const defaultTarget = c.current_agent_id || c.main_agent_id || null;
        const draft = readComposerDraft(c.project_id, c.id);
        setTargetAgentId(draft.targetAgentId || defaultTarget);
      })
      .catch(err => setError(err.message));

    connectEventStream(chatId, 0);

    return () => {
      streamCleanupRef.current();
      streamCleanupRef.current = () => {};
    };
  }, [chatId, connectEventStream]);

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
      _optimistic: true,
    }]);

    try {
      // target_agent_id is required by the backend — prefer user-selected, fall back to current/lead
      const effectiveTarget = targetAgentId || chat?.current_agent_id || chat?.main_agent_id;
      await api.postMessage(chatId, text, effectiveTarget);
      // Reconnect after the last known seq to get agent response
      connectEventStream(chatId, lastSeqRef.current);
    } catch (err) {
      console.error('Send failed:', err);
      setIsStreaming(false);
    }
  }, [chatId, chat, connectEventStream, targetAgentId]);

  const handleCancel = React.useCallback(async () => {
    if (!chatId) return;
    try {
      await api.cancelChat(chatId);
      streamCleanupRef.current();
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
      <TaskHeader chat={chat} events={events} />
      <div
        ref={timelineRef}
        data-testid="conversation-scroll"
        style={{ flex: 1, overflow: 'auto', padding: '8px 36px 0' }}
      >
        <div data-testid="conversation-column" style={conversationColumn}>
          {renderEventsWithHandovers({ events, agentsMap })}
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
      <Composer
        onSend={handleSend}
        isStreaming={isStreaming}
        onCancel={handleCancel}
        agentsMap={agentsMap}
        chatId={chatId}
        projectId={chat?.project_id || ''}
        defaultTargetAgentId={chat?.current_agent_id || chat?.main_agent_id || null}
        targetAgentId={targetAgentId}
        onChangeTargetAgent={setTargetAgentId}
      />
      <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} } @keyframes cw-spin { to { transform: rotate(360deg) } } @keyframes wordFadeIn { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: translateY(0) } } @keyframes cw-fade-in { from { opacity: 0 } to { opacity: 1 } } @keyframes cw-expand-in { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: translateY(0) } } @keyframes cw-type-jump { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
