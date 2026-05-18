import React from 'react';
import { Avatar, RichText, UI_FONT, MONO_FONT, HeadingTooltip } from './components.jsx';
import { mapBackendEvent, mergeToolResults, relativeTime, formatTime, HUMAN_USER, resolveAuthor } from './utils.js';
import * as api from './api.js';
import { clearComposerDraft, readComposerDraft, writeComposerDraft } from './draftStore.js';
import { AttachmentTray } from './AttachmentChips.jsx';
import { attachmentsSupported, dedupeAttachments, droppedAttachments, pickAttachments } from './attachments.js';
import { dataTransferHasFiles } from './dragDrop.js';
import { primeAudioContext, playDoneSound } from './audio.js';

function isAgentActivityEvent(event) {
  if (!event) return false;
  if (event.type === 'message' && event.message?.role === 'user') return false;
  return Boolean(event.actor_agent_id || event.error?.agent_id);
}

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

function SteerTrendIcon({ size = 11 }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 11 11"
      fill="none"
      style={{ flex: '0 0 auto' }}
    >
      <path
        d="M2 7.5 5 4.5l2 2 2.5-3M7 3.5h2.5V6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QueueClockIcon({ size = 10 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 10 10" fill="none" style={{ flex: '0 0 auto' }}>
      <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
      <path
        d="M5 2.6V5l1.7 1"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
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

function MessageEvent({ event, agentsMap, thought, showHeader = true }) {
  const agent = resolveAuthor(event.author, agentsMap) || HUMAN_USER;
  const isUser = agent.kind === 'human';

  if (isUser) {
    const steeredAgent = event.steerAgentId ? agentsMap?.[event.steerAgentId] : null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', padding: '14px 0' }}>
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
          <AttachmentTray attachments={event.attachments} />
        </div>
        {event.userSteer && (
          <div style={{
            marginTop: 6,
            padding: '0 4px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11.5,
            color: '#807972',
            fontFamily: UI_FONT,
          }}>
            <span style={{ color: '#C4644A', display: 'inline-flex' }}><SteerTrendIcon size={11} /></span>
            <span>
              Steered <span style={{ color: '#5C544B', fontWeight: 500 }}>
                {steeredAgent ? steeredAgent.name : 'the crew'}
              </span>
              <span style={{ color: '#A89F92' }}> mid-run</span>
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 14, padding: showHeader ? '14px 0 2px' : '2px 0' }}>
      {showHeader
        ? <Avatar agent={agent} size={28} />
        : <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {showHeader && (
          <div style={{ fontSize: 13.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
            {agent.archived && <DeletedTag />}
            <span style={{ color: '#A89F92' }}>· {event.time}</span>
          </div>
        )}
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

function ThinkingEvent({ event, agentsMap, showHeader = true }) {
  const agent = resolveAuthor(event.author, agentsMap);
  if (!agent || agent.kind !== 'agent') return null;
  return (
    <div style={{ display: 'flex', gap: 14, padding: showHeader ? '10px 0 2px' : '2px 0' }}>
      {showHeader
        ? <Avatar agent={agent} size={28} />
        : <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        {showHeader && (
          <div style={{ fontSize: 13.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: '#1C1A17' }}>{agent.name}</span>
            {agent.archived && <DeletedTag />}
            <span style={{ color: '#A89F92' }}>· {event.time}</span>
          </div>
        )}
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
      style={{ display: 'flex', gap: 14, padding: showHeader ? '10px 0 2px' : '2px 0' }}
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
  const mountedLengthRef = React.useRef(events.length);
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
            }}>{(() => {
              const groups = [];
              const indexByName = new Map();
              for (const { tool } of events) {
                if (indexByName.has(tool)) {
                  groups[indexByName.get(tool)].count++;
                } else {
                  indexByName.set(tool, groups.length);
                  groups.push({ name: tool, count: 1 });
                }
              }
              const isLive = events.length > mountedLengthRef.current;
              return groups.map((g, i) => (
                <React.Fragment key={g.name}>
                  {i > 0 && ' · '}
                  {g.name}
                  {g.count > 1 && (
                    <>
                      {' '}
                      <span
                        key={g.count}
                        style={{ display: 'inline-block', animation: isLive ? 'cw-count-pop .28s ease-out' : undefined }}
                      >x{g.count}</span>
                    </>
                  )}
                </React.Fragment>
              ));
            })()}</span>
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

function StreamingIndicator({ agentsMap, currentAgentId, showHeader = true }) {
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
      {showHeader && agent
        ? <Avatar agent={agent} size={28} />
        : <div style={{ width: 28, flexShrink: 0 }} aria-hidden="true" />}
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
  if (event.kind === 'message') return <MessageEvent event={event} agentsMap={agentsMap} thought={thought} showHeader={showHeader} />;
  if (event.kind === 'thinking') return <ThinkingEvent event={event} agentsMap={agentsMap} showHeader={showHeader} />;
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

// Minimum widths the split layout will honor when the drawer is open. The
// conversation column stops shrinking at MIN_CONVERSATION_PX so messages and
// the composer stay legible; the drawer stops shrinking at MIN_DRAWER_PX so
// the file list and diff cards have room to render.
const MIN_CONVERSATION_PX = 480;
const MIN_DRAWER_PX = 280;

function elapsedText(start, end) {
  if (!start) return '';
  const startMs = new Date(start).getTime();
  if (Number.isNaN(startMs)) return '';
  const endMs = end ? new Date(end).getTime() : Date.now();
  let secs = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const days = Math.floor(secs / 86400); secs -= days * 86400;
  const hours = Math.floor(secs / 3600); secs -= hours * 3600;
  const mins = Math.floor(secs / 60); secs -= mins * 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

function TaskHeader({ chat, events, fileCount, drawerOpen, onToggleDrawer }) {
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

  function handleDoubleClick(e) {
    if (e.target.closest('button, a, input, select, textarea')) return;
    window.electronAPI?.zoomWindow?.();
  }

  return (
    <div onDoubleClick={handleDoubleClick} style={{ padding: '20px 36px 16px', borderBottom: '1px solid #ECE6D5', background: '#FAF5E8', WebkitAppRegion: 'drag' }}>
      <div style={{ ...headerColumn, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
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
        {!drawerOpen && onToggleDrawer && (
          <button
            type="button"
            data-testid="files-drawer-toggle"
            onClick={onToggleDrawer}
            title="Workspace files"
            style={{
              WebkitAppRegion: 'no-drag',
              padding: '5px 10px 5px 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
              border: '1px solid #DCD3BC', background: '#FCFAF1', color: '#1C1A17',
              cursor: 'pointer', fontFamily: UI_FONT,
              display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ color: '#5C544B', display: 'block' }} aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.2"/>
              <line x1="11.5" y1="5.5" x2="13" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="11.5" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="11.5" y1="10.5" x2="13" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span>Files</span>
            {fileCount > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 500, color: '#807972',
                background: '#F0EAD8', padding: '1px 6px', borderRadius: 999,
                marginLeft: 1,
              }}>{fileCount}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Files drawer ─────────────────────────────────────────────────────────────

// Pluck the most likely file-path field off a tool call's input. We only
// surface a path when it's clearly a filesystem reference — bash commands,
// search queries, etc. are intentionally skipped so the drawer stays clean.
const FILE_PATH_KEYS = ['file_path', 'path', 'target_file', 'filepath'];

function extractFilePath(input) {
  if (!input || typeof input !== 'object') return null;
  for (const key of FILE_PATH_KEYS) {
    const v = input[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

// Tools that read but don't modify. Used to decide whether a file got "touched"
// (read) versus "changed" (write/edit/create).
const READ_ONLY_TOOLS = new Set([
  'Read', 'read_file', 'read', 'view', 'cat', 'view_file', 'open',
]);

function operationKind(toolName) {
  if (READ_ONLY_TOOLS.has(toolName)) return 'read';
  return 'edit';
}

// Strip a workdir prefix from an absolute path so the drawer can show clean
// project-relative paths. Returns the original path if it doesn't live under
// workdir or if workdir is empty.
function relativizePath(path, workdir) {
  if (!path || !workdir) return path;
  const norm = (s) => s.replace(/\/+$/, '');
  const w = norm(workdir);
  if (path === w) return '';
  if (path.startsWith(w + '/')) return path.slice(w.length + 1);
  return path;
}

function collectFiles(events, workdir) {
  const map = new Map();
  for (const e of events || []) {
    if (e.kind !== 'tool') continue;
    const raw = extractFilePath(e.input);
    if (!raw) continue;
    const path = relativizePath(raw, workdir);
    if (!path) continue;
    if (!map.has(path)) {
      map.set(path, {
        path,
        operations: [],
        edits: 0,
        reads: 0,
        lastAuthor: e.author,
        lastTool: e.tool,
        lastTime: e.time,
        firstSeq: e._seq ?? 0,
      });
    }
    const f = map.get(path);
    const kind = operationKind(e.tool);
    f.operations.push({
      tool: e.tool,
      kind,
      author: e.author,
      time: e.time,
      result: e.result,
      output: e.output || '',
      seq: e._seq ?? 0,
    });
    if (kind === 'read') f.reads += 1;
    else f.edits += 1;
    f.lastAuthor = e.author;
    f.lastTool = e.tool;
    f.lastTime = e.time;
  }
  return [...map.values()].sort((a, b) => {
    // Edited files float above read-only ones; within each, most recently
    // touched first.
    if ((a.edits > 0) !== (b.edits > 0)) return a.edits > 0 ? -1 : 1;
    return b.firstSeq - a.firstSeq;
  });
}

function buildFileTree(paths) {
  const root = { name: '', isFile: false, children: new Map(), path: '' };
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      if (!node.children.has(name)) {
        node.children.set(name, {
          name,
          isFile,
          children: new Map(),
          path: parts.slice(0, i + 1).join('/'),
        });
      }
      node = node.children.get(name);
    }
  }
  return root;
}

function TreeNode({ node, depth = 0, onPick, selectedPath, filesByPath, workdir, defaultOpenDepth = Infinity }) {
  // Folders auto-open while depth is below the cap. For the touched-files tree
  // this stays Infinity (everything open, since there are few entries); the
  // full project tree passes a small value so deep folders start collapsed.
  const [open, setOpen] = React.useState(depth < defaultOpenDepth);
  const [hovered, setHovered] = React.useState(false);
  const [revealHover, setRevealHover] = React.useState(false);
  const revealBtnRef = React.useRef(null);
  const kids = [...node.children.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  if (node.isFile) {
    const meta = filesByPath?.get(node.path);
    const isSelected = selectedPath === node.path;
    const canReveal = Boolean(workdir && window.electronAPI?.revealInFinder);
    return (
      <div
        onClick={() => onPick && onPick(node.path)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          padding: '3px 8px 3px ' + (depth * 14 + 10) + 'px',
          fontSize: 12.5, color: '#1C1A17', fontFamily: MONO_FONT,
          display: 'flex', alignItems: 'center', gap: 6,
          cursor: onPick ? 'pointer' : 'default', borderRadius: 5,
          background: isSelected ? '#F4ECD7' : (hovered && onPick ? '#EDE5CF' : 'transparent'),
        }}
      >
        <svg width="11" height="12" viewBox="0 0 11 12" style={{ color: '#A89F92', flexShrink: 0 }} aria-hidden="true">
          <path d="M2 1h4.5L9 3.5V11H2V1z" fill="none" stroke="currentColor" strokeWidth="0.9"/>
          <path d="M6.5 1v2.5H9" fill="none" stroke="currentColor" strokeWidth="0.9"/>
        </svg>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
        {meta && meta.edits > 0 && (
          <span style={{ fontSize: 10.5, color: '#8A6E2F', fontFamily: UI_FONT, fontWeight: 500 }}>
            {meta.edits} edit{meta.edits === 1 ? '' : 's'}
          </span>
        )}
        {canReveal && hovered && (
          <>
            <button
              ref={revealBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                const fullPath = workdir.replace(/\/+$/, '') + '/' + node.path;
                window.electronAPI.revealInFinder(fullPath);
              }}
              style={{
                background: 'none', border: 'none', padding: '1px 3px',
                cursor: 'pointer', color: '#A89F92', display: 'flex', alignItems: 'center',
                borderRadius: 3, flexShrink: 0, lineHeight: 0,
              }}
              onMouseEnter={(e) => { setRevealHover(true); e.currentTarget.style.color = '#5C544B'; e.currentTarget.style.background = '#EDE5D0'; }}
              onMouseLeave={(e) => { setRevealHover(false); e.currentTarget.style.color = '#A89F92'; e.currentTarget.style.background = 'none'; }}
            >
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden="true">
                <path d="M1 9.5V4C1 3.4477 1.4477 3 2 3H5L6 2H10.5C11.0523 2 11.5 2.4477 11.5 3V9.5C11.5 10.0523 11.0523 10.5 10.5 10.5H2C1.4477 10.5 1 10.0523 1 9.5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round"/>
              </svg>
            </button>
            <HeadingTooltip text="Reveal in Finder" anchorRef={revealBtnRef} visible={revealHover} />
          </>
        )}
      </div>
    );
  }
  return (
    <div>
      {node.name && (
        <div
          onClick={() => setOpen(!open)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            padding: '3px 4px 3px ' + (depth * 14 + 6) + 'px',
            fontSize: 12.5, color: '#5C544B', fontFamily: MONO_FONT,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            userSelect: 'none', borderRadius: 5,
            background: hovered ? '#EDE5CF' : 'transparent',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 9 9" style={{
            color: '#A89F92', flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 100ms ease',
          }} aria-hidden="true">
            <path d="M3 2l3 2.5L3 7" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ flex: 1 }}>{node.name}/</span>
          {hovered && workdir && window.electronAPI?.revealInFinder && (
            <>
              <button
                ref={revealBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  const fullPath = workdir.replace(/\/+$/, '') + '/' + node.path;
                  window.electronAPI.revealInFinder(fullPath);
                }}
                style={{
                  background: 'none', border: 'none', padding: '1px 3px',
                  cursor: 'pointer', color: '#A89F92', display: 'flex', alignItems: 'center',
                  borderRadius: 3, flexShrink: 0, lineHeight: 0,
                }}
                onMouseEnter={(e) => { setRevealHover(true); e.currentTarget.style.color = '#5C544B'; e.currentTarget.style.background = '#D8D0BC'; }}
                onMouseLeave={(e) => { setRevealHover(false); e.currentTarget.style.color = '#A89F92'; e.currentTarget.style.background = 'none'; }}
              >
                <svg width="13" height="11" viewBox="0 0 13 11" fill="none" aria-hidden="true">
                  <path d="M1 9.5V4C1 3.4477 1.4477 3 2 3H5L6 2H10.5C11.0523 2 11.5 2.4477 11.5 3V9.5C11.5 10.0523 11.0523 10.5 10.5 10.5H2C1.4477 10.5 1 10.0523 1 9.5Z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round"/>
                </svg>
              </button>
              <HeadingTooltip text="Reveal in Finder" anchorRef={revealBtnRef} visible={revealHover} />
            </>
          )}
        </div>
      )}
      {open && kids.map(k => (
        <TreeNode
          key={k.path || k.name}
          node={k}
          depth={node.name ? depth + 1 : depth}
          onPick={onPick}
          selectedPath={selectedPath}
          filesByPath={filesByPath}
          workdir={workdir}
          defaultOpenDepth={defaultOpenDepth}
        />
      ))}
    </div>
  );
}

// Diff mode glyph: + and − side by side. Active state colors them in the
// usual add/remove hues; inactive state keeps both neutral so the toolbar
// reads as quiet chrome until the user clicks.
function FileDiffIcon({ active }) {
  const addC = active ? '#3E7A4A' : '#807972';
  const delC = active ? '#B0413E' : '#807972';
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      {/* plus (left) */}
      <line x1="1.6" y1="7" x2="6.4" y2="7" stroke={addC} strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="4"   y1="4.6" x2="4"   y2="9.4" stroke={addC} strokeWidth="1.5" strokeLinecap="round"/>
      {/* minus (right) */}
      <line x1="9.6" y1="7" x2="14.4" y2="7" stroke={delC} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

// Directory mode glyph: a folder with a small tab. Filled when active.
function FileTreeIcon({ active }) {
  const c = active ? '#1C1A17' : '#807972';
  const fill = active ? '#F7EFDD' : 'transparent';
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
      <path
        d="M1.6 4.2 a1 1 0 0 1 1-1 H6 l1.4 1.5 H13.4 a1 1 0 0 1 1 1 V11.6 a1 1 0 0 1 -1 1 H2.6 a1 1 0 0 1 -1 -1 V4.2 z"
        fill={fill} stroke={c} strokeWidth="1.1" strokeLinejoin="round"
      />
    </svg>
  );
}

// Working-tree diff card: status badge + path + +/- line counts. Expands
// inline to show diff lines; a small icon opens the full file content view.
function GitDiffCard({ file, onOpen }) {
  const hasDiff = Boolean(file.diff?.length > 0);
  const [open, setOpen] = React.useState(hasDiff);
  const [headerHovered, setHeaderHovered] = React.useState(false);
  const [openFileHover, setOpenFileHover] = React.useState(false);
  const openFileBtnRef = React.useRef(null);
  const statusInfo = {
    'A': { color: '#3E7A4A', bg: '#E6F1DA' },
    'M': { color: '#8A6E2F', bg: '#F2E9D2' },
    'D': { color: '#B0413E', bg: '#F5DDD4' },
    'R': { color: '#5C7A8C', bg: '#E2EBF1' },
    'C': { color: '#5C7A8C', bg: '#E2EBF1' },
    '?': { color: '#5C7A8C', bg: '#E2EBF1' },
  }[file.status] || { color: '#8A6E2F', bg: '#F2E9D2' };
  return (
    <div
      data-testid="git-diff-row"
      style={{ border: '1px solid #E4DCCA', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}
    >
      <div
        onClick={() => hasDiff ? setOpen(o => !o) : onOpen()}
        onMouseEnter={() => setHeaderHovered(true)}
        onMouseLeave={() => setHeaderHovered(false)}
        style={{
          padding: '7px 8px 7px 10px', display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer',
          background: headerHovered ? '#EDE8DC' : '#FCFAF1',
          borderBottom: open && hasDiff ? '1px solid #E4DFCE' : 'none',
          transition: 'background 80ms ease',
        }}
      >
        <span style={{
          width: 16, height: 16, borderRadius: 3,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, color: statusInfo.color,
          background: statusInfo.bg, fontFamily: MONO_FONT, flexShrink: 0,
        }}>{file.status}</span>
        <div style={{
          flex: 1, minWidth: 0,
          fontFamily: MONO_FONT, fontSize: 12.5, fontWeight: 500, color: '#1C1A17',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={file.path}>{file.path}</div>
        {(file.added > 0 || file.removed > 0) && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, fontFamily: MONO_FONT, fontSize: 11 }}>
            {file.added > 0 && <span style={{ color: '#3E7A4A' }}>+{file.added}</span>}
            {file.removed > 0 && <span style={{ color: '#B0413E' }}>−{file.removed}</span>}
          </div>
        )}
        {file.binary && (
          <span style={{ fontSize: 10, color: '#807972', fontFamily: UI_FONT }}>binary</span>
        )}
        {hasDiff && (
          <>
            <button
              ref={openFileBtnRef}
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              style={{
                background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer',
                color: '#A89F92', display: 'flex', alignItems: 'center',
                borderRadius: 3, flexShrink: 0, lineHeight: 0,
              }}
              onMouseEnter={(e) => { setOpenFileHover(true); e.currentTarget.style.color = '#3C3630'; e.currentTarget.style.background = '#D0D4DC'; }}
              onMouseLeave={(e) => { setOpenFileHover(false); e.currentTarget.style.color = '#807972'; e.currentTarget.style.background = 'none'; }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M4 2H2C1.4477 2 1 2.4477 1 3V9C1 9.5523 1.4477 10 2 10H8C8.5523 10 9 9.5523 9 9V7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                <path d="M6 1H10M10 1V5M10 1L5 6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <HeadingTooltip text="Open file view" anchorRef={openFileBtnRef} visible={openFileHover} />
          </>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{
          color: '#9A9085', flexShrink: 0,
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 120ms ease',
        }} aria-hidden="true">
          <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      {open && hasDiff && <DiffLines lines={file.diff} compact />}
    </div>
  );
}

function DiffLines({ lines, compact }) {
  return (
    <div style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 1.65, padding: compact ? '6px 0' : '10px 0 20px' }}>
      {lines.map((line, i) => (
        <div key={i} style={{
          padding: '0 14px 0 26px', position: 'relative',
          background:
            line.kind === 'add'  ? 'rgba(132, 175, 95, 0.16)' :
            line.kind === 'del'  ? 'rgba(176, 65, 62, 0.12)' :
            line.kind === 'hunk' ? '#F4ECD7' : 'transparent',
          color:
            line.kind === 'ctx'  ? '#807972' :
            line.kind === 'hunk' ? '#5C544B' : '#1C1A17',
          whiteSpace: 'pre',
          fontStyle: line.kind === 'hunk' ? 'italic' : 'normal',
        }}>
          {line.kind !== 'hunk' && (
            <span style={{
              position: 'absolute', left: 10, fontWeight: 500,
              color: line.kind === 'add' ? '#3E7A4A' : line.kind === 'del' ? '#B0413E' : '#C2B89F',
            }}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
          )}
          {line.text}
        </div>
      ))}
    </div>
  );
}

// File content view: fetches the file from the daemon and renders it. For
// files that show up in `gitDiff`, offers a File/Diff toggle so the user can
// flip between the full content and just the working-tree changes. Falls back
// to a human-readable message when the file is binary, missing, or unreadable.
function FileContentView({ projectId, path, diff, onBack }) {
  const [content, setContent] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const hasDiff = Boolean(diff && diff.length > 0);
  const [view, setView] = React.useState(hasDiff ? 'diff' : 'file');

  React.useEffect(() => {
    if (!projectId || !path) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    api.readProjectFile(projectId, path).then(res => {
      if (cancelled) return;
      setContent(res);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      setError(err?.message || 'Failed to read file');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, path]);

  const codeLines = React.useMemo(() => {
    if (!content?.content) return [];
    return content.content.split('\n');
  }, [content]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={onBack}
          title="Back"
          aria-label="Back to file list"
          style={{
            width: 24, height: 24, borderRadius: 5,
            border: '1px solid transparent', background: 'transparent',
            cursor: 'pointer', color: '#5C544B',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#E8E0CC'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <path d="M8 2.5L3.5 6.5L8 10.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: MONO_FONT, fontSize: 12, color: '#1C1A17',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={content?.path || path}>{content?.path || path}</div>
        {hasDiff && (
          <div style={{
            display: 'inline-flex', background: '#F0EAD8', borderRadius: 6,
            padding: 2, border: '1px solid #DCD3BC', flexShrink: 0,
          }}>
            {['file', 'diff'].map(v => (
              <button key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '3px 9px', borderRadius: 4, fontSize: 11.5, fontWeight: 500,
                  background: view === v ? '#FCFAF1' : 'transparent',
                  color: view === v ? '#1C1A17' : '#807972',
                  border: 'none', cursor: 'pointer', fontFamily: UI_FONT,
                  boxShadow: view === v ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >{v === 'file' ? 'File' : 'Diff'}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {view === 'diff' && hasDiff && <DiffLines lines={diff} />}
        {view === 'file' && (
          <>
            {loading && (
              <div style={{ padding: '24px 16px', color: '#807972', fontSize: 12.5 }}>Loading…</div>
            )}
            {!loading && error && (
              <div style={{ padding: '20px 16px', color: '#B23A2E', fontSize: 12.5 }}>{error}</div>
            )}
            {!loading && !error && content?.binary && (
              <div style={{ padding: '24px 16px', color: '#807972', fontSize: 12.5 }}>
                Binary file — not previewable here.
              </div>
            )}
            {!loading && !error && content && !content.binary && (
              <div style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 1.65, padding: '10px 0 20px' }}>
                {codeLines.map((text, i) => (
                  <div key={i} style={{
                    padding: '0 16px 0 44px', position: 'relative',
                    color: '#1C1A17', whiteSpace: 'pre',
                  }}>
                    <span style={{
                      position: 'absolute', left: 0, width: 36, textAlign: 'right',
                      color: '#C2B89F', userSelect: 'none', fontSize: 11,
                    }}>{i + 1}</span>
                    {text || ' '}
                  </div>
                ))}
                {content?.truncated && (
                  <div style={{
                    padding: '14px 16px 4px', color: '#807972',
                    fontSize: 11.5, fontFamily: UI_FONT, fontStyle: 'italic',
                  }}>
                    Showing first {Math.floor(content.content.length / 1024)} KB · file is larger.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FileOperationsView({ file, agentsMap, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={onBack}
          title="Back"
          aria-label="Back to file list"
          style={{
            width: 24, height: 24, borderRadius: 5,
            border: '1px solid transparent', background: 'transparent',
            cursor: 'pointer', color: '#5C544B',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#E8E0CC'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
            <path d="M8 2.5L3.5 6.5L8 10.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div style={{
          flex: 1, minWidth: 0, fontFamily: MONO_FONT, fontSize: 12, color: '#1C1A17',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }} title={file.path}>{file.path}</div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 14px 20px' }}>
        <div style={{
          fontSize: 10.5, color: '#A89F92', fontWeight: 600, letterSpacing: 0.6,
          textTransform: 'uppercase', marginBottom: 8, fontFamily: UI_FONT,
        }}>Operations · {file.operations.length}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {file.operations.map((op, i) => {
            const agent = resolveAuthor(op.author, agentsMap);
            const opColor = op.kind === 'edit' ? '#8A6E2F' : '#5C7A8C';
            const opBg = op.kind === 'edit' ? '#F4EBC9' : '#E2EBF1';
            return (
              <div key={i} style={{
                border: '1px solid #E4DCCA', borderRadius: 8,
              }}>
                <div style={{
                  padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
                  borderBottom: op.output ? '1px solid #E4DCCA' : 'none',
                }}>
                  {agent && agent.kind === 'agent' && <Avatar agent={agent} size={18} />}
                  <span style={{
                    fontFamily: MONO_FONT, fontSize: 12, color: '#1C1A17', fontWeight: 500,
                  }}>{op.tool}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 999,
                    background: opBg, color: opColor, fontWeight: 600,
                    letterSpacing: 0.3, textTransform: 'uppercase', fontFamily: UI_FONT,
                  }}>{op.kind}</span>
                  <div style={{ flex: 1 }} />
                  <ToolStatusChip result={op.result} />
                  <span style={{ fontSize: 11, color: '#A89F92', fontFamily: UI_FONT }}>{op.time}</span>
                </div>
                {op.output && (
                  <pre style={{
                    margin: 0, padding: '8px 12px',
                    fontFamily: MONO_FONT, fontSize: 12, color: '#5C544B',
                    background: 'rgba(0,0,0,0.03)', lineHeight: 1.55,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 220, overflow: 'auto',
                    borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                  }}>{op.output.length > 1200 ? op.output.slice(0, 1200) + '\n…' : op.output}</pre>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Segmented mode toggle with sidebar-style tooltips on hover. Each button
// gets its own ref so HeadingTooltip can anchor against it.
function ModeToggleGroup({ modes, activeMode, onChange }) {
  const [hovered, setHovered] = React.useState(null);
  const refs = React.useRef({});
  const getRef = (key) => {
    if (!refs.current[key]) refs.current[key] = React.createRef();
    return refs.current[key];
  };
  return (
    <div style={{
      display: 'inline-flex', background: '#F0EAD8', borderRadius: 7,
      padding: 2, border: '1px solid #DCD3BC', flexShrink: 0, marginTop: 2,
    }}>
      {modes.map(({ key, Icon, title, enabled }) => {
        const buttonRef = getRef(key);
        return (
          <React.Fragment key={key}>
            <button
              ref={buttonRef}
              type="button"
              onClick={() => enabled && onChange(key)}
              onMouseEnter={() => setHovered(key)}
              onMouseLeave={() => setHovered(h => (h === key ? null : h))}
              aria-label={title}
              aria-pressed={activeMode === key}
              disabled={!enabled}
              data-testid={`files-drawer-mode-${key}`}
              style={{
                width: 28, height: 24, borderRadius: 5,
                background: activeMode === key ? '#FCFAF1' : 'transparent',
                border: 'none',
                cursor: enabled ? 'pointer' : 'not-allowed',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: activeMode === key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                opacity: enabled ? 1 : 0.4,
                padding: 0,
              }}
            ><Icon active={activeMode === key} /></button>
            <HeadingTooltip
              text={title}
              anchorRef={buttonRef}
              visible={hovered === key}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

function CloseDrawerButton({ onClick }) {
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={(e) => { setHover(true); e.currentTarget.style.background = '#F0EAD8'; }}
        onMouseLeave={(e) => { setHover(false); e.currentTarget.style.background = 'transparent'; }}
        aria-label="Close files drawer"
        data-testid="files-drawer-close"
        style={{
          width: 26, height: 26, borderRadius: 6,
          border: '1px solid transparent', background: 'transparent',
          cursor: 'pointer', color: '#807972',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
          <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      <HeadingTooltip text="Close" anchorRef={ref} visible={hover} />
    </>
  );
}

function FilesDrawer({ chatId, events, agentsMap, project, onClose }) {
  const workdir = project?.workdir || '';
  const files = React.useMemo(() => collectFiles(events, workdir), [events, workdir]);
  const filesByPath = React.useMemo(() => {
    const m = new Map();
    for (const f of files) m.set(f.path, f);
    return m;
  }, [files]);
  const totalEdits = files.reduce((s, f) => s + f.edits, 0);
  const projectId = project?.id || '';
  const hasWorkdir = Boolean(project?.workdir);

  const [mode, setMode] = React.useState(hasWorkdir ? 'diff' : 'tree');
  const [selectedPath, setSelectedPath] = React.useState(null);

  // Working-tree diff is loaded only while the drawer is open in diff mode.
  // The header badge stays based on chat-touched files, so visiting a chat
  // does not need to hit git until the user asks for workspace changes.
  const [gitDiff, setGitDiff] = React.useState([]);
  const [gitLoading, setGitLoading] = React.useState(false);
  const [gitError, setGitError] = React.useState(null);
  const [gitFetched, setGitFetched] = React.useState(false);

  // Full project file listing — drives the directory tree when the project has
  // a workdir, so the tree shows everything in the workspace and not just the
  // files the crew has touched in this chat.
  const [projectFiles, setProjectFiles] = React.useState([]);
  const [projectFilesLoading, setProjectFilesLoading] = React.useState(false);
  const [projectFilesError, setProjectFilesError] = React.useState(null);
  const [projectFilesFetched, setProjectFilesFetched] = React.useState(false);

  const toolEventCount = React.useMemo(() => events.filter(e => e.kind === 'tool').length, [events]);
  // Coalesce bursts of tool events into a single refetch tick so an active
  // stream doesn't storm `git diff` / workspace walks on every keystroke.
  const [debouncedToolEventCount, setDebouncedToolEventCount] = React.useState(toolEventCount);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedToolEventCount(toolEventCount), 600);
    return () => clearTimeout(t);
  }, [toolEventCount]);

  const fetchGitDiff = React.useCallback(() => {
    if (!projectId || !hasWorkdir) return undefined;
    let cancelled = false;
    setGitLoading(true);
    setGitError(null);
    api.getProjectGitDiff(projectId)
      .then(items => {
        if (cancelled) return;
        setGitDiff(items || []);
        setGitFetched(true);
      })
      .catch(err => {
        if (cancelled) return;
        setGitError(err?.message || 'Failed to load git diff');
        setGitFetched(true);
      })
      .finally(() => { if (!cancelled) setGitLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, hasWorkdir]);

  React.useEffect(() => {
    if (mode !== 'diff') return undefined;
    return fetchGitDiff();
  }, [mode, fetchGitDiff, debouncedToolEventCount]);

  // Fetch the full project file listing when entering tree mode. Capped at
  // 10k entries on the daemon side; that's more than enough for the kinds of
  // projects this UI targets.
  React.useEffect(() => {
    if (mode !== 'tree' || !projectId || !hasWorkdir) return undefined;
    let cancelled = false;
    setProjectFilesLoading(true);
    setProjectFilesError(null);
    api.listProjectFiles(projectId, '', 10000)
      .then(items => {
        if (cancelled) return;
        setProjectFiles(items || []);
        setProjectFilesFetched(true);
      })
      .catch(err => {
        if (cancelled) return;
        setProjectFilesError(err?.message || 'Failed to load project files');
        setProjectFilesFetched(true);
      })
      .finally(() => { if (!cancelled) setProjectFilesLoading(false); });
    return () => { cancelled = true; };
    // Re-fetch when chat (=project workspace state) or tool events change so
    // newly-created files surface in the tree.
  }, [mode, projectId, hasWorkdir, chatId, debouncedToolEventCount]);

  // Re-resolve the default mode when the project changes.
  React.useEffect(() => {
    setMode(hasWorkdir ? 'diff' : 'tree');
    setSelectedPath(null);
    setGitDiff([]);
    setGitLoading(false);
    setGitError(null);
    setGitFetched(false);
    setProjectFiles([]);
    setProjectFilesFetched(false);
  }, [chatId, hasWorkdir]);

  // Tree source: prefer the full project listing when we have it; otherwise
  // fall back to files the crew touched (covers no-workdir chats).
  const tree = React.useMemo(() => {
    if (hasWorkdir && projectFiles.length > 0) {
      // Only include file entries (skip pure directory entries — the tree
      // builder produces folders implicitly from path segments).
      const paths = projectFiles.filter(f => !f.is_dir).map(f => f.path);
      return buildFileTree(paths);
    }
    return buildFileTree(files.map(f => f.path));
  }, [hasWorkdir, projectFiles, files]);

  const diffByPath = React.useMemo(() => {
    const m = new Map();
    for (const f of gitDiff) m.set(f.path, f);
    return m;
  }, [gitDiff]);

  const selectedDiff = selectedPath ? diffByPath.get(selectedPath) : null;

  const modes = [
    { key: 'diff', Icon: FileDiffIcon, title: hasWorkdir ? 'Working changes' : 'Diff view (no workspace)', enabled: hasWorkdir },
    { key: 'tree', Icon: FileTreeIcon, title: 'Directory', enabled: true },
  ];

  const headerSubtitle = (() => {
    if (mode === 'diff') {
      if (!hasWorkdir) return ['no git workspace'];
      if (gitLoading && !gitFetched) return ['loading…'];
      if (gitError) return ['error loading diff'];
      const totalA = gitDiff.reduce((s, f) => s + (f.added || 0), 0);
      const totalR = gitDiff.reduce((s, f) => s + (f.removed || 0), 0);
      const out = [`${gitDiff.length} changed`];
      if (totalA > 0 || totalR > 0) {
        out.push(
          <>
            <span style={{ color: '#3E7A4A' }}>+{totalA}</span>
            {' '}
            <span style={{ color: '#B0413E' }}>−{totalR}</span>
          </>
        );
      }
      return out;
    }
    // tree mode
    if (hasWorkdir) {
      if (projectFilesLoading && !projectFilesFetched) return ['loading…'];
      if (projectFilesError) return ['error loading files'];
      const total = projectFiles.filter(f => !f.is_dir).length;
      const items = [`${total} file${total === 1 ? '' : 's'}`];
      if (files.length > 0) items.push(`${files.length} touched`);
      if (totalEdits > 0) items.push(`${totalEdits} edit${totalEdits === 1 ? '' : 's'}`);
      return items;
    }
    const items = [`${files.length} file${files.length === 1 ? '' : 's'} touched`];
    if (totalEdits > 0) items.push(`${totalEdits} edit${totalEdits === 1 ? '' : 's'}`);
    return items;
  })();

  return (
    <div style={{
      width: '100%', height: '100%', flexShrink: 0,
      background: '#F6F0DC',
      display: 'flex', flexDirection: 'column',
      minHeight: 0, minWidth: 0,
    }}>
      <div style={{
        padding: '14px 16px 12px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        minHeight: 75,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17' }}>
            {mode === 'diff' ? 'Working changes' : 'Workspace files'}
          </div>
          <div style={{
            fontSize: 11.5, color: '#807972', marginTop: 4, fontFamily: MONO_FONT,
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          }}>
            {project?.name && <>
              <span>{project.name}</span>
              <span style={{ color: '#D6CDB6' }}>·</span>
            </>}
            {headerSubtitle.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: '#D6CDB6' }}>·</span>}
                <span>{part}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        <ModeToggleGroup
          modes={modes}
          activeMode={mode}
          onChange={setMode}
        />

        <CloseDrawerButton onClick={onClose} />
      </div>

      {selectedPath ? (
        <FileContentView
          projectId={projectId}
          path={selectedPath}
          diff={selectedDiff?.diff || null}
          onBack={() => setSelectedPath(null)}
        />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px 20px' }}>
          {mode === 'diff' && !hasWorkdir && (
            <div style={{
              padding: '40px 12px', textAlign: 'center',
              fontSize: 12.5, color: '#807972', lineHeight: 1.6,
            }}>
              <div style={{ marginBottom: 4 }}>This chat isn't bound to a workspace.</div>
              <div style={{ fontSize: 11.5, color: '#A89F92' }}>Switch to Directory to see paths the crew touched.</div>
            </div>
          )}
          {mode === 'diff' && hasWorkdir && gitLoading && !gitFetched && (
            <div style={{ padding: '40px 12px', textAlign: 'center', fontSize: 12.5, color: '#807972' }}>Loading…</div>
          )}
          {mode === 'diff' && hasWorkdir && gitError && (
            <div style={{ padding: '40px 12px', textAlign: 'center', fontSize: 12.5, color: '#B23A2E', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 4 }}>{gitError}</div>
              {/not a git repository/i.test(gitError) && (
                <div style={{ fontSize: 11.5, color: '#9C5142' }}>
                  Switch to Directory to browse files in the workspace.
                </div>
              )}
            </div>
          )}
          {mode === 'diff' && hasWorkdir && !gitError && gitFetched && gitDiff.length === 0 && (
            <div style={{
              padding: '40px 12px', textAlign: 'center',
              fontSize: 12.5, color: '#807972', lineHeight: 1.6,
            }}>
              <div>No working-tree changes.</div>
            </div>
          )}
          {mode === 'diff' && hasWorkdir && gitDiff.length > 0 && (
            <div>
              {gitDiff.map(f => (
                <GitDiffCard key={f.path} file={f} onOpen={() => setSelectedPath(f.path)} />
              ))}
            </div>
          )}

          {mode === 'tree' && (() => {
            const fromWorkdir = hasWorkdir && projectFiles.length > 0;
            // Loading the project tree for the first time.
            if (hasWorkdir && projectFilesLoading && !projectFilesFetched) {
              return (
                <div style={{ padding: '40px 12px', textAlign: 'center', fontSize: 12.5, color: '#807972' }}>
                  Loading…
                </div>
              );
            }
            if (hasWorkdir && projectFilesError) {
              return (
                <div style={{
                  padding: '40px 12px', textAlign: 'center',
                  fontSize: 12.5, color: '#B23A2E', lineHeight: 1.6,
                }}>
                  {projectFilesError}
                </div>
              );
            }
            // Nothing to show: no workdir AND no touched files.
            if (!fromWorkdir && files.length === 0) {
              return (
                <div style={{
                  padding: '40px 12px', textAlign: 'center',
                  fontSize: 12.5, color: '#807972', lineHeight: 1.6,
                }}>
                  <div>No files touched yet.</div>
                </div>
              );
            }
            return (
              <TreeNode
                node={tree}
                onPick={setSelectedPath}
                selectedPath={selectedPath}
                filesByPath={filesByPath}
                workdir={workdir}
                defaultOpenDepth={fromWorkdir ? 1 : Infinity}
              />
            );
          })()}
        </div>
      )}
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
  // Track the last agent whose header (avatar+name+time) was rendered, so
  // consecutive events from the same agent share one header. Reset on
  // handovers and user messages (anything that visually breaks the run).
  let prevDisplayedActor = null;
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
        prevDisplayedActor = null;
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
      prevDisplayedActor = null;
    }

    // Events that don't display a header (user messages, tool_result) break
    // the run for visual purposes. Agent events with the same actor as the
    // previously displayed one suppress their header.
    const isHeaderless = !isAgentActor(actor) || e.kind === 'tool_result';
    const showHeader = isHeaderless ? true : prevDisplayedActor !== actor;
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
    if (isHeaderless) {
      // tool_result keeps the prior header context (it's a continuation of
      // the same agent's run). User messages break the run.
      if (!isAgentActor(actor)) prevDisplayedActor = null;
    } else if (showHeader) {
      prevDisplayedActor = actor;
    }
  });
  return { nodes: out, lastDisplayedActor: prevDisplayedActor, lastAgentActor: prevAgentActor };
}

// ─── Composer ─────────────────────────────────────────────────────────────────

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

const miniBtn = {
  background: 'transparent', border: '1px solid #DCD3BC',
  color: '#5C544B', fontSize: 11.5, fontFamily: UI_FONT,
  padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
};

const miniBtnPrimary = {
  background: '#1C1A17', border: '1px solid #1C1A17',
  color: '#FCFBF7', fontSize: 11.5, fontFamily: UI_FONT, fontWeight: 500,
  padding: '2px 10px', borderRadius: 999, cursor: 'pointer',
};

const miniBtnIcon = {
  background: 'transparent', border: '1px solid transparent',
  color: '#807972', padding: '2px 4px', borderRadius: 999, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function suggestionBounds(value, cursor) {
  const before = value.slice(0, cursor);
  let match = before.match(/(^|\s)@(\S*)$/);
  if (match) {
    const start = before.length - match[0].length + match[1].length;
    return { kind: 'mention', start, end: cursor, query: match[2] || '' };
  }
  match = before.match(/(^|\s)\/([^\s/]*)$/);
  if (match) {
    const start = before.length - match[0].length + match[1].length;
    return { kind: 'slash', start, end: cursor, query: match[2] || '' };
  }
  return null;
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

function HighlightedComposerText({ text, agents, skills }) {
  if (!text) return null;
  const tokens = [];
  const names = agents.map(a => a.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length > 0) {
    const agentRe = new RegExp(`@(${names.map(escapeRegExp).join('|')})(?=$|\\s|[.,!?;:])`, 'g');
    let m;
    while ((m = agentRe.exec(text))) {
      tokens.push({ start: m.index, end: m.index + m[0].length, value: m[0] });
    }
  }
  // Path-style @-mention: anything starting with @ and containing a slash or
  // dot is treated as a file reference.
  const pathRe = /(^|\s)(@[\w./~-][\w./~-]*)/g;
  let pm;
  while ((pm = pathRe.exec(text))) {
    const tokenStart = pm.index + pm[1].length;
    const value = pm[2];
    if (!value.includes('/') && !value.includes('.')) continue;
    tokens.push({ start: tokenStart, end: tokenStart + value.length, value });
  }
  const skillNames = (skills || []).map(s => s.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (skillNames.length > 0) {
    const skillRe = new RegExp(`(^|\\s)/(${skillNames.map(escapeRegExp).join('|')})(?=$|\\s|[.,!?;:])`, 'g');
    let sm;
    while ((sm = skillRe.exec(text))) {
      const tokenStart = sm.index + sm[1].length;
      tokens.push({ start: tokenStart, end: tokenStart + 1 + sm[2].length, value: text.slice(tokenStart, tokenStart + 1 + sm[2].length) });
    }
  }
  tokens.sort((a, b) => a.start - b.start);
  // Drop overlapping tokens (keep the earlier/longer one).
  const deduped = [];
  for (const t of tokens) {
    const last = deduped[deduped.length - 1];
    if (last && t.start < last.end) continue;
    deduped.push(t);
  }
  if (deduped.length === 0) return text;
  const parts = [];
  let last = 0;
  for (const t of deduped) {
    if (t.start > last) parts.push({ kind: 'text', value: text.slice(last, t.start) });
    parts.push({ kind: 'token', value: t.value });
    last = t.end;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });

  return (
    <>
      {parts.map((part, index) => part.kind === 'token' ? (
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

function FileGlyph({ isDir }) {
  return isDir ? (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 5.5a1 1 0 0 1 1-1h3.2l1.4 1.5h6.4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-7.5z"
        stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="#F4F0E8"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5 2.5h5.2L13.5 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"
        stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="#FCFBF7"/>
      <path d="M10.2 2.5V6h3.3" stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function SkillGlyph() {
  return (
    <div aria-hidden="true" style={{
      width: 22, height: 22, borderRadius: 5,
      background: '#EEE6D2', color: '#5C544B',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MONO_FONT, fontSize: 13, fontWeight: 600,
    }}>/</div>
  );
}

function SuggestionRow({ option, active, onSelect }) {
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 9px', borderRadius: 7,
    cursor: 'pointer',
    background: active ? '#EFE9DB' : 'transparent',
    color: '#1C1A17', fontSize: 13,
  };
  if (option.kind === 'agent') {
    return (
      <div role="option" aria-selected={active} onMouseDown={(e) => e.preventDefault()} onClick={onSelect} style={rowStyle}>
        <Avatar agent={option.agent} size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{option.agent.name}</div>
          {option.agent.role && <div style={{ fontSize: 11.5, color: '#807972' }}>{option.agent.role}</div>}
        </div>
      </div>
    );
  }
  if (option.kind === 'file') {
    const segments = option.file.path.split('/');
    const name = segments.pop();
    const dir = segments.join('/');
    return (
      <div role="option" aria-selected={active} onMouseDown={(e) => e.preventDefault()} onClick={onSelect} style={rowStyle}>
        <FileGlyph isDir={option.file.is_dir} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}{option.file.is_dir ? '/' : ''}
          </div>
          {dir && (
            <div style={{ fontSize: 11.5, color: '#807972', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dir}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (option.kind === 'skill') {
    return (
      <div role="option" aria-selected={active} onMouseDown={(e) => e.preventDefault()} onClick={onSelect} style={rowStyle}>
        <SkillGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{option.skill.name}</div>
          <div style={{ fontSize: 11.5, color: '#807972' }}>Skill</div>
        </div>
      </div>
    );
  }
  return null;
}

function QueuedSteerCard({ item, isLast, queueCount, onCancel, onEdit, onDeliverAll }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '2px 0' }}>
      <div style={{ maxWidth: '72%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        <div
          data-testid="queued-steer-card"
          onClick={onEdit}
          title="Click to edit"
          style={{
            background: 'repeating-linear-gradient(45deg, #FCFAF1 0 8px, #F6F0DC 8px 16px)',
            border: '1px dashed #C9BFA3',
            color: '#1C1A17',
            fontSize: 13,
            lineHeight: 1.45,
            padding: '6px 12px',
            borderRadius: 14,
            fontFamily: UI_FONT,
            cursor: 'pointer',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}
        >
          {item.content}
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 11.5, color: '#807972', padding: '0 4px',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color: '#C4644A', display: 'inline-flex' }}><QueueClockIcon size={10} /></span>
            <span>Queued</span>
          </span>
          <span style={{ color: '#D6CDB6' }}>·</span>
          <button type="button" onClick={onEdit} style={miniBtn}>Edit</button>
          {isLast && (
            <button type="button" data-testid="queued-steer-deliver" onClick={onDeliverAll} style={miniBtnPrimary}>
              {queueCount > 1 ? `Deliver all ${queueCount} now` : 'Deliver now'}
            </button>
          )}
          <button type="button" onClick={onCancel} title="Discard" style={miniBtnIcon}>
            <svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true">
              <path d="M2 2l5 5M7 2l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function Composer({ onSend, isStreaming, onCancel, pendingSteers = [], onCancelSteer, onEditSteer, onDeliverSteers, agentsMap, skills = [], projects = [], chatId, projectId, defaultTargetAgentId, targetAgentId, onChangeTargetAgent }) {
  const [val, setVal] = React.useState(() => readComposerDraft(projectId, chatId).text || '');
  const [attachments, setAttachments] = React.useState([]);
  const [cursor, setCursor] = React.useState(0);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const [fileMatches, setFileMatches] = React.useState([]);
  const [scrollTop, setScrollTop] = React.useState(0);
  const ta = React.useRef(null);
  const listboxRef = React.useRef(null);
  const canAttach = attachmentsSupported();
  const agents = React.useMemo(() => (
    Object.values(agentsMap || {})
      .filter(agent => agent?.id !== '__human__' && agent?.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [agentsMap]);

  const currentAgent = React.useMemo(() => {
    const id = targetAgentId || defaultTargetAgentId;
    return id ? agentsMap?.[id] : null;
  }, [agentsMap, targetAgentId, defaultTargetAgentId]);

  const agentSkills = React.useMemo(() => {
    if (!currentAgent?.skill_ids?.length) return [];
    const allowed = new Set(currentAgent.skill_ids);
    return (skills || []).filter(s => allowed.has(s.id));
  }, [currentAgent, skills]);

  const hasWorkdir = React.useMemo(() => {
    if (!projectId) return false;
    return Boolean((projects || []).find(p => p.id === projectId)?.workdir);
  }, [projects, projectId]);
  React.useEffect(() => {
    if (!ta.current) return;
    const prevScrollTop = ta.current.scrollTop;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(160, ta.current.scrollHeight) + 'px';
    ta.current.scrollTop = prevScrollTop;
    setScrollTop(ta.current.scrollTop);
  }, [val]);

  React.useEffect(() => {
    if (!chatId || !projectId) return;
    const draft = readComposerDraft(projectId, chatId);
    setVal(draft.text || '');
    setAttachments([]);
    if (draft.targetAgentId) onChangeTargetAgent?.(draft.targetAgentId);
  }, [chatId, projectId, onChangeTargetAgent]);

  React.useEffect(() => {
    if (!chatId || !projectId) return;
    writeComposerDraft(projectId, chatId, {
      text: val,
      targetAgentId: targetAgentId && targetAgentId !== defaultTargetAgentId ? targetAgentId : '',
    });
  }, [chatId, projectId, defaultTargetAgentId, targetAgentId, val]);

  const activeToken = React.useMemo(() => suggestionBounds(val, cursor), [val, cursor]);

  // Fetch matching files (debounced) whenever the active @-token changes.
  React.useEffect(() => {
    if (!activeToken || activeToken.kind !== 'mention' || !hasWorkdir || !projectId) {
      setFileMatches([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.listProjectFiles(projectId, activeToken.query, 12)
        .then(items => { if (!cancelled) setFileMatches(items || []); })
        .catch(() => { if (!cancelled) setFileMatches([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeToken?.kind, activeToken?.query, projectId, hasWorkdir]);

  const suggestionOptions = React.useMemo(() => {
    if (!activeToken) return [];
    const q = activeToken.query.toLowerCase();
    if (activeToken.kind === 'mention') {
      const agentItems = agents
        .filter(agent => agent.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map(agent => ({ kind: 'agent', key: `agent:${agent.id}`, agent }));
      const fileItems = (fileMatches || []).map(file => ({
        kind: 'file',
        key: `file:${file.path}`,
        file,
      }));
      return [...agentItems, ...fileItems].slice(0, 12);
    }
    if (activeToken.kind === 'slash') {
      return agentSkills
        .filter(skill => skill.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map(skill => ({ kind: 'skill', key: `skill:${skill.id}`, skill }));
    }
    return [];
  }, [activeToken, agents, fileMatches, agentSkills]);

  React.useEffect(() => {
    setActiveSuggestion(0);
  }, [activeToken?.kind, activeToken?.query, suggestionOptions.length]);

  React.useEffect(() => {
    const el = listboxRef.current?.children[activeSuggestion];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestion]);

  const updateCursor = (node) => {
    setCursor(node?.selectionStart ?? val.length);
  };

  const applySuggestion = (option) => {
    if (!activeToken || !option) return;
    let inserted;
    if (option.kind === 'agent') inserted = `@${option.agent.name}`;
    else if (option.kind === 'file') inserted = `@${option.file.path}`;
    else if (option.kind === 'skill') inserted = `/${option.skill.name}`;
    else return;
    const next = `${val.slice(0, activeToken.start)}${inserted} ${val.slice(activeToken.end)}`;
    const nextCursor = activeToken.start + inserted.length + 1;
    setVal(next);
    setCursor(nextCursor);
    window.requestAnimationFrame?.(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const addAttachments = React.useCallback((nextAttachments) => {
    if (!nextAttachments?.length) return;
    setAttachments(current => dedupeAttachments(current, nextAttachments));
  }, []);

  const chooseAttachments = React.useCallback(async () => {
    if (!canAttach) return;
    addAttachments(await pickAttachments());
  }, [addAttachments, canAttach]);

  const removeAttachment = React.useCallback((path) => {
    setAttachments(current => current.filter(attachment => attachment.path !== path));
  }, []);

  const handleDrop = React.useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canAttach || !dataTransferHasFiles(e.dataTransfer)) return;
    addAttachments(await droppedAttachments(e.dataTransfer));
  }, [addAttachments, canAttach]);

  const send = () => {
    const text = val.trim();
    if (!text && attachments.length === 0) return;
    const outgoingAttachments = attachments;
    setVal('');
    setAttachments([]);
    if (chatId && projectId) clearComposerDraft(projectId, chatId);
    onSend(text, outgoingAttachments);
  };

  const editPendingSteer = async (item) => {
    if (!item) return;
    const text = item.content || '';
    const queuedAttachments = item.attachments || [];
    await onEditSteer?.(item.id);
    setVal(text);
    setAttachments(queuedAttachments);
    window.requestAnimationFrame?.(() => {
      ta.current?.focus();
      const nextCursor = text.length;
      ta.current?.setSelectionRange(nextCursor, nextCursor);
      setCursor(nextCursor);
    });
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

    if (suggestionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion(i => Math.min(i + 1, suggestionOptions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestionOptions[activeSuggestion] || suggestionOptions[0]);
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

  const canSend = Boolean(val.trim()) || attachments.length > 0;

  return (
    <div style={{
      borderTop: '1px solid #ECE6D5',
      background: '#FCFAF1',
      padding: '10px 36px 14px',
    }}>
      {pendingSteers.length > 0 && (
        <div style={{ ...conversationColumn, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {pendingSteers.map((item, index) => (
            <QueuedSteerCard
              key={item.id || `${item.queued_at}:${index}`}
              item={item}
              isLast={index === pendingSteers.length - 1}
              queueCount={pendingSteers.length}
              onCancel={() => onCancelSteer?.(item.id)}
              onEdit={() => editPendingSteer(item)}
              onDeliverAll={() => onDeliverSteers?.(pendingSteers.map(steer => steer.id))}
            />
          ))}
        </div>
      )}
      <div
        data-testid="composer-column"
        onDragOver={(e) => {
          if (!dataTransferHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={handleDrop}
        style={{
          ...conversationColumn,
          border: '1px solid #DCD3BC', borderRadius: 12, background: '#FFFEF8',
          padding: '10px 12px 8px', boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
        }}
      >
        <AttachmentTray attachments={attachments} onRemove={removeAttachment} />
        <div style={{ position: 'relative' }}>
          {suggestionOptions.length > 0 && (
            <div
              ref={listboxRef}
              role="listbox"
              aria-label={activeToken?.kind === 'slash' ? 'Skill suggestions' : 'Mention suggestions'}
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
                scrollPaddingBlock: 4,
                maxHeight: 280,
                overflowY: 'auto',
              }}
            >
              {suggestionOptions.map((option, index) => (
                <SuggestionRow
                  key={option.key}
                  option={option}
                  active={index === activeSuggestion}
                  onSelect={() => applySuggestion(option)}
                />
              ))}
            </div>
          )}
          <div style={{ position: 'relative', overflow: 'hidden' }}>
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
                transform: `translateY(${-scrollTop}px)`,
              }}
            >
              <HighlightedComposerText text={val} agents={agents} skills={agentSkills} />
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
            onScroll={(e) => setScrollTop(e.target.scrollTop)}
            onKeyDown={onKeyDown}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={handleDrop}
            placeholder={isStreaming ? 'Steer this run…' : 'Steer the crew — @agent to direct, ⌘↵ to send'}
            rows={1}
            style={{
              position: 'relative', zIndex: 1,
              width: '100%', minHeight: 22, border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', fontFamily: UI_FONT, fontSize: 14,
              color: val ? 'transparent' : '#1C1A17', caretColor: '#1C1A17',
              lineHeight: 1.5, padding: 4,
              opacity: 1,
            }}
          />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {canAttach && (
            <button
              type="button"
              data-testid="composer-attach"
              onClick={chooseAttachments}
              title="Attach files"
              style={{
                width: 28, height: 28, borderRadius: 999, border: 'none',
                background: 'transparent', color: '#A89F92', cursor: 'pointer',
                fontFamily: UI_FONT, fontSize: 20, lineHeight: '24px',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                opacity: 1,
              }}
            >
              +
            </button>
          )}
          {agents.length > 0 && onChangeTargetAgent && (
            <AgentPicker value={targetAgentId} onChange={onChangeTargetAgent} agents={agents} />
          )}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: '#A89F92' }}>⌘↵ send</span>
          {isStreaming && (
            <button
              type="button"
              data-testid="composer-stop"
              onClick={onCancel}
              style={{
                ...chip,
                background: '#FCFAF1',
                color: '#807972',
                border: '1px solid #DCD3BC',
                fontWeight: 500,
              }}
            >Stop</button>
          )}
          <button
            data-testid="composer-send"
            onClick={send}
            disabled={!canSend}
            style={{
              ...chip,
              background: canSend ? '#1C1A17' : '#F0EAD8',
              color: canSend ? '#FCFBF7' : '#A89F92',
              border: '1px solid ' + (canSend ? '#1C1A17' : '#E6DFCC'),
              fontWeight: 500,
            }}
          >{isStreaming ? 'Steer' : '↑ Send'}</button>
        </div>
      </div>
    </div>
  );
}

// ─── TaskView ─────────────────────────────────────────────────────────────────

export default function TaskView({ chatId, agentsMap, skills = [], projects = [], onStreamingChange }) {
  const [chat, setChat] = React.useState(null);
  const [events, setEvents] = React.useState([]);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [targetAgentId, setTargetAgentId] = React.useState(null);
  const [pendingSteers, setPendingSteers] = React.useState([]);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerMounted, setDrawerMounted] = React.useState(false);
  // drawerVisible is the CSS-driven state: the drawer mounts at visible=false
  // (collapsed to width 0) and flips to true on the next frame so the width
  // transition runs and the drawer slides in from the right edge.
  const [drawerVisible, setDrawerVisible] = React.useState(false);
  const [splitRatio, setSplitRatio] = React.useState(0.58);
  const [dragging, setDragging] = React.useState(false);
  const splitRef = React.useRef(null);
  const timelineRef = React.useRef(null);
  const lastSeqRef = React.useRef(0);
  const streamCleanupRef = React.useRef(() => {});
  const waitingForAgentRef = React.useRef(false);
  const waitingAfterSeqRef = React.useRef(0);
  const agentActivitySinceSendRef = React.useRef(false);

  // Three-phase animation:
  //   open click → drawerOpen=true → drawerMounted=true (still hidden) →
  //     next frame: drawerVisible=true → CSS transitions width 0 → drawerWidth
  //   close click → drawerOpen=false → drawerVisible=false (transition out) →
  //     after 260ms: drawerMounted=false (unmount)
  React.useEffect(() => {
    if (drawerOpen) {
      setDrawerMounted(true);
      return undefined;
    }
    setDrawerVisible(false);
    if (!drawerMounted) return undefined;
    const t = setTimeout(() => setDrawerMounted(false), 260);
    return () => clearTimeout(t);
  }, [drawerOpen, drawerMounted]);

  // Once the drawer is in the DOM, kick off the slide-in on the next frame so
  // the browser has a chance to lay out at width 0 before the transition fires.
  React.useEffect(() => {
    if (!drawerMounted || !drawerOpen) return undefined;
    const raf = requestAnimationFrame(() => setDrawerVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [drawerMounted, drawerOpen]);

  // Reset the drawer when switching chats so it doesn't carry state across
  // unrelated conversations.
  React.useEffect(() => { setDrawerOpen(false); }, [chatId]);

  const currentProject = React.useMemo(() => {
    const pid = chat?.project_id;
    if (!pid) return null;
    return (projects || []).find(p => p.id === pid) || null;
  }, [chat?.project_id, projects]);
  const editedEventFileCount = React.useMemo(
    () => collectFiles(events, currentProject?.workdir || '').filter(f => f.edits > 0).length,
    [events, currentProject?.workdir],
  );
  const headerToolEventCount = React.useMemo(() => events.filter(e => e.kind === 'tool').length, [events]);
  const [workingTreeFileCount, setWorkingTreeFileCount] = React.useState(null);
  const currentProjectId = currentProject?.id || '';
  const hasCurrentWorkdir = Boolean(currentProject?.workdir);

  React.useEffect(() => {
    if (!currentProjectId || !hasCurrentWorkdir) {
      setWorkingTreeFileCount(null);
      return undefined;
    }
    let cancelled = false;
    setWorkingTreeFileCount(null);
    api.getProjectGitDiff(currentProjectId)
      .then(items => {
        if (!cancelled) setWorkingTreeFileCount((items || []).length);
      })
      .catch(() => {
        if (!cancelled) setWorkingTreeFileCount(null);
      });
    return () => { cancelled = true; };
  }, [currentProjectId, hasCurrentWorkdir, headerToolEventCount]);

  const fileCount = hasCurrentWorkdir && workingTreeFileCount !== null
    ? workingTreeFileCount
    : editedEventFileCount;

  const onSplitDragStart = React.useCallback((e) => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    setDragging(true);
    const onMove = (ev) => {
      const rect = container.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      // Floor the conversation column at MIN_CONVERSATION_PX so the drag handle
      // can't push it below readable width. The drawer side has its own min of
      // 240px so the file list always has room to render.
      const rawRatio = x / rect.width;
      const minConvRatio = Math.min(0.85, MIN_CONVERSATION_PX / Math.max(rect.width, 1));
      const maxConvRatio = 1 - (MIN_DRAWER_PX / Math.max(rect.width, 1));
      const ratio = Math.min(Math.max(rawRatio, minConvRatio), Math.max(maxConvRatio, minConvRatio));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

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
        if (
          waitingForAgentRef.current &&
          event.seq > waitingAfterSeqRef.current &&
          isAgentActivityEvent(event)
        ) {
          agentActivitySinceSendRef.current = true;
        }
        setEvents(prev => {
          const mapped = mapBackendEvent(event);
          if (!mapped) return prev;
          if (prev.some(e => e._seq === event.seq)) return prev;
          lastSeqRef.current = Math.max(lastSeqRef.current, event.seq);

          if (mapped.kind === 'message' && mapped.author === '__human__') {
            if (mapped.userSteer) {
              api.getChat(id).then(c => {
                setChat(c);
                setPendingSteers(c.stream?.pending_steers || []);
              }).catch(() => {});
            }
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
        if (waitingForAgentRef.current && !agentActivitySinceSendRef.current) {
          api.getChat(id).then(c => {
            setChat(c);
            setPendingSteers(c.stream?.pending_steers || []);
            setIsStreaming(c.stream?.status === 'streaming');
          }).catch(() => {});
          return;
        }
        setIsStreaming(false);
        if (waitingForAgentRef.current) {
          waitingForAgentRef.current = false;
          agentActivitySinceSendRef.current = false;
          playDoneSound();
        }
        // Refresh chat metadata
        api.getChat(id).then(c => {
          setChat(c);
          setPendingSteers(c.stream?.pending_steers || []);
        }).catch(() => {});
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
    setPendingSteers([]);
    lastSeqRef.current = 0;
    waitingForAgentRef.current = false;
    waitingAfterSeqRef.current = 0;
    agentActivitySinceSendRef.current = false;

    api.getChat(chatId)
      .then(c => {
        setChat(c);
        setPendingSteers(c.stream?.pending_steers || []);
        if (c.stream?.status === 'streaming') {
          waitingForAgentRef.current = true;
        }
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

  const handleSend = React.useCallback(async (text, attachments = []) => {
    if (!chatId) return;
    const steeringActiveRun = isStreaming;

    // Prime the AudioContext while we still have a user gesture. The
    // done-sound that fires when the agent finishes is created from a
    // network event, which Chromium does not count as activation; without
    // priming here the context stays suspended and produces silence.
    primeAudioContext();

    if (!steeringActiveRun) {
      // Optimistic user message for normal sends. Interrupt messages are
      // appended by the daemon only after the previous run has actually
      // stopped, preserving the session order.
      const now = new Date();
      const ts = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
      setEvents(prev => [...prev, {
        kind: 'message',
        author: '__human__',
        time: ts,
        body: text,
        attachments,
        _seq: -Date.now(),
        _optimistic: true,
      }]);
    }

    try {
      waitingForAgentRef.current = true;
      waitingAfterSeqRef.current = lastSeqRef.current;
      agentActivitySinceSendRef.current = false;
      if (steeringActiveRun) {
        const updatedChat = await api.interruptMessage(chatId, text, attachments);
        setChat(updatedChat);
        setPendingSteers(updatedChat?.stream?.pending_steers || []);
      } else {
        // target_agent_id is required by the backend — prefer user-selected, fall back to current/lead
        const effectiveTarget = targetAgentId || chat?.current_agent_id || chat?.main_agent_id;
        await api.postMessage(chatId, text, effectiveTarget, attachments);
        // Reconnect after the last known seq to get agent response
        connectEventStream(chatId, lastSeqRef.current);
      }
    } catch (err) {
      console.error('Send failed:', err);
      if (!steeringActiveRun) setIsStreaming(false);
    }
  }, [chatId, chat, connectEventStream, isStreaming, targetAgentId]);

  const handleCancelSteer = React.useCallback(async (steerId) => {
    if (!chatId || !steerId) return;
    try {
      const updatedChat = await api.cancelPendingSteer(chatId, steerId);
      setChat(updatedChat);
      setPendingSteers(updatedChat?.stream?.pending_steers || []);
    } catch (err) {
      console.error('Cancel steer failed:', err);
    }
  }, [chatId]);

  const handleDeliverSteers = React.useCallback(async (steerIds) => {
    if (!chatId || !steerIds?.length) return;
    try {
      const updatedChat = await api.deliverPendingSteers(chatId, steerIds);
      setChat(updatedChat);
      setPendingSteers(updatedChat?.stream?.pending_steers || []);
    } catch (err) {
      console.error('Deliver steer failed:', err);
    }
  }, [chatId]);

  const handleCancel = React.useCallback(async () => {
    if (!chatId) return;
    try {
      await api.cancelChat(chatId);
      waitingForAgentRef.current = false;
      agentActivitySinceSendRef.current = false;
      streamCleanupRef.current();
      setIsStreaming(false);
      setPendingSteers([]);
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

  const drawerWidthExpr = `calc(${((1 - splitRatio) * 100).toFixed(3)}% - 3px)`;
  const drawerTransition = dragging ? 'none' : 'width 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease';

  return (
    <div
      ref={splitRef}
      style={{ display: 'flex', height: '100%', background: '#FAF5E8', overflow: 'hidden', minHeight: 0, minWidth: 0 }}
    >
      <div style={{
        flex: '1 1 0',
        minWidth: drawerMounted ? MIN_CONVERSATION_PX : 0,
        display: 'flex', flexDirection: 'column',
      }}>
        <TaskHeader
          chat={chat}
          events={events}
          fileCount={fileCount}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen(true)}
        />
        <div
          ref={timelineRef}
          data-testid="conversation-scroll"
          style={{ flex: 1, overflow: 'auto', padding: '8px 36px 24px' }}
        >
          <div data-testid="conversation-column" style={conversationColumn}>
            {(() => {
              const { nodes, lastDisplayedActor, lastAgentActor } = renderEventsWithHandovers({ events, agentsMap });
              const streamingAgentId = lastAgentActor || chat?.current_agent_id;
              const showStreamingHeader = lastDisplayedActor !== streamingAgentId;
              return (
                <>
                  {nodes}
                  {isStreaming && (
                    <StreamingIndicator agentsMap={agentsMap} currentAgentId={streamingAgentId} showHeader={showStreamingHeader} />
                  )}
                </>
              );
            })()}
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
          pendingSteers={pendingSteers}
          onCancelSteer={handleCancelSteer}
          onEditSteer={handleCancelSteer}
          onDeliverSteers={handleDeliverSteers}
          agentsMap={agentsMap}
          skills={skills}
          projects={projects}
          chatId={chatId}
          projectId={chat?.project_id || ''}
          defaultTargetAgentId={chat?.current_agent_id || chat?.main_agent_id || null}
          targetAgentId={targetAgentId}
          onChangeTargetAgent={setTargetAgentId}
        />
      </div>

      {drawerMounted && (
        <>
          <div
            onMouseDown={onSplitDragStart}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            style={{
              width: drawerVisible ? 6 : 0, flexShrink: 0, cursor: 'col-resize',
              position: 'relative', background: 'transparent', zIndex: 5,
              transition: drawerTransition,
              overflow: 'hidden',
              pointerEvents: drawerVisible ? 'auto' : 'none',
            }}
          >
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 2.5, width: 1,
              background: dragging ? '#C4644A' : '#ECE6D5',
              transition: dragging ? 'none' : 'background 120ms ease',
            }}/>
            <div style={{
              position: 'absolute', top: '50%', left: 0, width: 6, height: 36,
              transform: 'translateY(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: dragging ? 1 : 0.55,
            }}>
              <div style={{
                width: 3, height: 28, borderRadius: 2,
                background: dragging ? '#C4644A' : '#D6CDB6',
              }}/>
            </div>
          </div>

          <div style={{
            width: drawerVisible ? drawerWidthExpr : 0,
            opacity: drawerVisible ? 1 : 0,
            transition: drawerTransition,
            overflow: 'hidden',
            flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            minWidth: 0,
          }}>
            <FilesDrawer
              chatId={chatId}
              events={events}
              agentsMap={agentsMap}
              project={currentProject}
              onClose={() => setDrawerOpen(false)}
            />
          </div>
        </>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} } @keyframes cw-spin { to { transform: rotate(360deg) } } @keyframes wordFadeIn { from { opacity: 0; transform: translateY(2px) } to { opacity: 1; transform: translateY(0) } } @keyframes cw-fade-in { from { opacity: 0 } to { opacity: 1 } } @keyframes cw-expand-in { from { opacity: 0; transform: translateY(-3px) } to { opacity: 1; transform: translateY(0) } } @keyframes cw-type-jump { from { opacity: 0 } to { opacity: 1 } } @keyframes cw-count-pop { 0% { transform: scale(1.35); color: #5C544B } 60% { transform: scale(.96); color: #807972 } 100% { transform: scale(1); color: #A89F92 } }`}</style>
    </div>
  );
}
