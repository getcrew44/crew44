import React from 'react';
import {
  listOptimizerSuggestions,
  runOptimizerScan,
  actOnSuggestion,
  getOptimizerSchedule,
  setOptimizerSchedule,
  getOptimizerScan,
  purgeOptimizerScans,
} from './api.js';

const AUTO_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
const AUTO_UI = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const CONTENT_MAX_WIDTH = 720;

const KIND_META = {
  'strategy':       { label: 'Strategy', dot: '#8A6B3E', tint: '#F5EBD2', icon: 'compass' },
  'skill':          { label: 'Skill',    dot: '#C4644A', tint: '#F7E5DC', icon: 'spark'   },
  'memory-project': { label: 'Memory · project', dot: '#5B7A6A', tint: '#E2EAE3', icon: 'pin' },
  'memory-user':    { label: 'Memory · you',     dot: '#7A5B8A', tint: '#ECE2F1', icon: 'pin' },
};

const FILTERS = [
  { key: 'all',      label: 'All'      },
  { key: 'strategy', label: 'Strategy' },
  { key: 'skill',    label: 'Skills'   },
  { key: 'memory',   label: 'Memories' },
];

const CLOSED_STATES = ['accepted', 'dismissed', 'snoozed', 'pending_compaction'];

const autoCard = { background: '#FCFAF1', border: '1px solid #ECE6D5', borderRadius: 10, overflow: 'hidden' };
const ghostBtn = { padding: '4px 10px', borderRadius: 6, fontSize: 12.5, border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B', cursor: 'pointer', fontFamily: AUTO_UI, display: 'inline-flex', alignItems: 'center', gap: 4 };
const ghostMini = { padding: '2px 8px', borderRadius: 5, fontSize: 11.5, border: '1px solid #E6DFCC', background: 'transparent', color: '#5C544B', cursor: 'pointer', fontFamily: AUTO_UI };
const primaryBtn = { padding: '4px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500, border: '1px solid #1C1A17', background: '#1C1A17', color: '#FCFBF7', cursor: 'pointer', fontFamily: AUTO_UI, display: 'inline-flex', alignItems: 'center', gap: 4 };
const inputStyle = { padding: '5px 10px', borderRadius: 6, border: '1px solid #E6DFCC', background: '#FCFAF1', fontFamily: AUTO_UI, fontSize: 12.5, color: '#1C1A17', outline: 'none' };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AutoIcon({ name, size = 14 }) {
  const s = { width: size, height: size, style: { flexShrink: 0, display: 'block' } };
  const p = { stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'compass': return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" {...p}/><path d="M10.5 5.5L7 7l-1.5 3.5L9 9z" {...p}/></svg>;
    case 'spark':   return <svg {...s} viewBox="0 0 16 16"><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M4 12l2-2M10 6l2-2" {...p}/></svg>;
    case 'pin':     return <svg {...s} viewBox="0 0 16 16"><path d="M8 1.5v6M5.5 7.5h5l-1 2.5h-3z M8 10v4.5" {...p}/></svg>;
    case 'check':   return <svg {...s} viewBox="0 0 16 16"><path d="M3 8l3 3 7-7" {...p}/></svg>;
    case 'x':       return <svg {...s} viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" {...p}/></svg>;
    case 'edit':    return <svg {...s} viewBox="0 0 16 16"><path d="M3 12.5L4 8.5l7-7a1.4 1.4 0 0 1 2 2l-7 7-4 1z" {...p}/></svg>;
    case 'snooze':  return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" {...p}/><path d="M5.5 6h3l-3 4h3" {...p}/></svg>;
    case 'play':    return <svg {...s} viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" {...p}/></svg>;
    case 'clock':   return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" {...p}/><path d="M8 5v3.2l2 1.3" {...p}/></svg>;
    case 'warn':    return <svg {...s} viewBox="0 0 16 16"><path d="M8 2l6 11H2z M8 6v4M8 11.5v0.5" {...p}/></svg>;
    default: return null;
  }
}

function Spinner({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0, display: 'block' }} aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" fill="none"/>
      <path d="M14 8a6 6 0 0 1-6 6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.9s" repeatCount="indefinite"/>
      </path>
    </svg>
  );
}

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function KindBadge({ kind }) {
  const m = KIND_META[kind] || { label: kind, dot: '#807972', tint: '#F0EAD8' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 7px', borderRadius: 999, fontSize: 11, fontWeight: 500, color: '#1C1A17', background: m.tint, border: `1px solid ${m.dot}22` }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot }}/>
      {m.label}
    </span>
  );
}

function PriorityChip({ p }) {
  const map = {
    high: { label: 'High impact', bg: '#F7EFDD', fg: '#C4644A' },
    med:  { label: 'Medium',      bg: '#F0EAD8', fg: '#807972' },
  };
  const m = map[p];
  if (!m) return null;
  return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: m.bg, color: m.fg, fontWeight: 500 }}>{m.label}</span>;
}

function relAgo(iso) {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  if (!d || Number.isNaN(d)) return '—';
  const sec = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h';
  return Math.floor(sec / 86400) + 'd';
}

function isNeverScanDate(iso) {
  if (!iso) return true;
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isNaN(t) || t <= 0 || d.getUTCFullYear() <= 1970;
}

function formatLastScanParts(iso) {
  if (isNeverScanDate(iso)) return null;
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(d),
    time: new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(d),
  };
}

function Preview({ preview }) {
  if (!preview) return null;
  if (preview.type === 'plan') {
    return (
      <div style={{ padding: '12px 16px' }}>
        {(preview.lines || []).map((l, i) => (
          <div key={i} style={{ fontSize: 12.5, color: '#1C1A17', padding: '3px 0', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ color: '#A89F92', fontFamily: AUTO_MONO, fontSize: 10, width: 14 }}>{String(i+1).padStart(2, '0')}</span>
            <span>{l}</span>
          </div>
        ))}
      </div>
    );
  }
  if (preview.type === 'diff') {
    return (
      <pre style={{ margin: 0, padding: '12px 16px', fontFamily: AUTO_MONO, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
        {(preview.lines || []).map((l, i) => {
          const isMinus = l.startsWith('-');
          const isPlus  = l.startsWith('+');
          return (
            <div key={i} style={{
              background: isPlus ? 'rgba(91, 156, 95, 0.10)' : isMinus ? 'rgba(196, 100, 74, 0.10)' : 'transparent',
              color:       isPlus ? '#3E7A4A' : isMinus ? '#A4503A' : '#5C544B',
              padding: '1px 6px', margin: '0 -6px',
            }}>{l}</div>
          );
        })}
      </pre>
    );
  }
  if (preview.type === 'skill') {
    return (
      <div style={{ padding: '6px 16px 12px' }}>
        <div style={{ fontFamily: AUTO_MONO, fontSize: 11, color: '#A89F92', marginBottom: 6 }}>
          skills/<span style={{ color: '#1C1A17', fontWeight: 500 }}>{preview.name}</span>/SKILL.md
        </div>
        <pre style={{ margin: 0, fontFamily: AUTO_MONO, fontSize: 11.5, lineHeight: 1.7, color: '#1C1A17', whiteSpace: 'pre-wrap' }}>{(preview.lines || []).join('\n')}</pre>
      </div>
    );
  }
  if (preview.type === 'memory') {
    return (
      <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ padding: '2px 8px', borderRadius: 4, background: '#F0EAD8', fontFamily: AUTO_MONO, fontSize: 11, color: '#5C544B', flexShrink: 0, marginTop: 2 }}>{preview.scope}</div>
        <div style={{ fontSize: 13.5, color: '#1C1A17', lineHeight: 1.55, fontStyle: 'italic' }}>"{preview.text}"</div>
      </div>
    );
  }
  return null;
}

function previewToText(p) {
  if (!p) return '';
  if (p.type === 'memory') return p.text || '';
  return (p.lines || []).join('\n');
}
function applyPreviewText(p, text) {
  if (p.type === 'memory') return { ...p, text };
  return { ...p, lines: text.split('\n') };
}

function PreviewEditor({ preview, onSave, onCancel }) {
  const [text, setText] = React.useState(previewToText(preview));
  const isMemory = preview.type === 'memory';
  return (
    <div style={{ padding: '12px 16px', background: '#FAF5E8', borderTop: '1px solid #ECE6D5' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        <AutoIcon name="edit" size={11}/> Editing {isMemory ? 'memory text' : preview.type === 'skill' ? 'skill body' : preview.type}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus spellCheck={false}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: isMemory ? 80 : 140, padding: '10px 12px', borderRadius: 8, border: '1px solid #E6DFCC', background: '#FCFAF1', fontFamily: isMemory ? AUTO_UI : AUTO_MONO, fontSize: isMemory ? 13 : 12, lineHeight: 1.6, color: '#1C1A17', resize: 'vertical', outline: 'none' }}/>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button onClick={() => onSave(text)} style={primaryBtn}>
          <AutoIcon name="check" size={11}/>&nbsp;Save edits
        </button>
      </div>
    </div>
  );
}

function SuggestionCard({ entry, editing, onAct, onEdit, onSaveEdit, onCancelEdit }) {
  const s = entry.suggestion;
  const state = entry.state?.state;
  const edited = entry.state?.edited_preview;
  const m = KIND_META[s.kind] || { dot: '#807972', tint: '#F0EAD8', icon: 'pin' };
  const [expanded, setExpanded] = React.useState(s.priority === 'high');
  React.useEffect(() => { if (editing) setExpanded(true); }, [editing]);

  if (CLOSED_STATES.includes(state)) {
    const acceptedLabel = (
      s.kind === 'strategy' ? 'Logged' :
      s.kind === 'skill' ? 'Saved to skills/' :
      'Pinned'
    );
    const stateLabel = state === 'accepted'
      ? acceptedLabel
      : state === 'pending_compaction'
        ? 'Queued for compaction'
        : state;
    const stateIcon = state === 'accepted'
      ? 'check'
      : state === 'dismissed'
        ? 'x'
        : state === 'pending_compaction'
          ? 'clock'
          : 'snooze';
    return (
      <div style={{ ...autoCard, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: 0.62, fontSize: 12.5 }}>
        <span style={{ color: state === 'accepted' ? '#3E7A4A' : '#807972', display: 'flex' }}>
          <AutoIcon name={stateIcon} size={14}/>
        </span>
        <KindBadge kind={s.kind}/>
        <span style={{ flex: 1, color: '#5C544B', textDecoration: state === 'dismissed' ? 'line-through' : 'none' }}>{s.title}</span>
        <span style={{ fontSize: 11.5, color: '#A89F92' }}>{stateLabel}</span>
        {(state === 'dismissed' || state === 'snoozed') && (
          <button onClick={() => onAct(s.id, 'reset')} style={ghostMini}>Undo</button>
        )}
      </div>
    );
  }

  const preview = edited || s.preview;

  return (
    <div style={autoCard}>
      <div style={{ padding: '14px 16px 12px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: m.tint, color: m.dot, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <AutoIcon name={m.icon} size={14}/>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <KindBadge kind={s.kind}/>
            <PriorityChip p={s.priority}/>
            {edited && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#E2EAE3', color: '#3E7A4A', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AutoIcon name="edit" size={10}/> Edited
              </span>
            )}
            <span style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: '#A89F92', fontFamily: AUTO_MONO, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <AutoIcon name="clock" size={11}/> {relAgo(s.generated_at)}
              </span>
              {s.impact && <span>· {s.impact}</span>}
            </span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 500, color: '#1C1A17', marginBottom: 4 }}>{s.title}</div>
          <div style={{ fontSize: 13, color: '#5C544B', lineHeight: 1.55 }}>{s.body}</div>
        </div>
      </div>
      {expanded && !editing && s.evidence && (s.evidence.runs?.length || s.evidence.windows?.length) ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 16px 4px', fontSize: 12, color: '#807972' }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10.5, color: '#A89F92' }}>Evidence</span>
          {(s.evidence.runs || []).map(r => (
            <span key={r} style={{ fontFamily: AUTO_MONO, fontSize: 11, padding: '1px 6px', background: '#F0EAD8', borderRadius: 4, color: '#5C544B' }}>{r}</span>
          ))}
          {(s.evidence.windows || []).map((w, i) => <span key={i} style={{ color: '#807972' }}>· {w}</span>)}
        </div>
      ) : null}
      {expanded && !editing && <Preview preview={preview}/>}
      {editing && (
        <PreviewEditor preview={preview}
          onSave={(text) => onSaveEdit(s.id, applyPreviewText(preview, text))}
          onCancel={() => onCancelEdit(s.id)}/>
      )}
      <div style={{ borderTop: '1px solid #ECE6D5', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={() => setExpanded(e => !e)} style={ghostBtn} disabled={editing}>{expanded ? 'Hide details' : 'View details'}</button>
        <span style={{ flex: 1 }}/>
        <button onClick={() => onAct(s.id, 'snooze')}   style={ghostBtn} disabled={editing}>Snooze 7d</button>
        <button onClick={() => onAct(s.id, 'dismiss')}  style={ghostBtn} disabled={editing}>Dismiss</button>
        <button onClick={() => onEdit(s.id)}            style={ghostBtn} disabled={editing}>
          <AutoIcon name="edit" size={11}/>&nbsp;{edited ? 'Edit again' : 'Edit'}
        </button>
        <button onClick={() => onAct(s.id, 'accept')}   style={primaryBtn} disabled={editing}>
          <AutoIcon name="check" size={11}/>&nbsp;Accept{edited ? ' edits' : ''}
        </button>
      </div>
    </div>
  );
}

function Banner({ status, error, onRetry, onDismiss }) {
  if (!status || status === 'success' || status === 'running') return null;
  return (
    <div style={{ ...autoCard, padding: '12px 16px', marginBottom: 16, background: '#F7E5DC', borderColor: '#C4644A22', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: '#A4503A', display: 'flex' }}><AutoIcon name="warn" size={14}/></span>
      <div style={{ flex: 1, fontSize: 13, color: '#1C1A17' }}>
        Last auto-scan {status === 'failed' ? 'failed' : status}. {error}
      </div>
      <button onClick={onRetry} style={primaryBtn}><AutoIcon name="play" size={11}/>&nbsp;Retry</button>
      <button onClick={onDismiss} style={ghostBtn}>Dismiss</button>
    </div>
  );
}

function Counter({ label, n, sub, stack = false, valueStyle }) {
  return (
    <div style={{ flex: 1, padding: '14px 16px', borderRight: '1px solid #ECE6D5' }}>
      <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'flex-start' : 'baseline', gap: stack ? 3 : 8 }}>
        <div style={{ fontSize: 24, fontWeight: 600, color: '#1C1A17', lineHeight: 1, ...valueStyle }}>{n}</div>
        <div style={{ fontSize: 12, color: '#807972' }}>{sub}</div>
      </div>
    </div>
  );
}

function LastScanCounter({ iso, runsAnalyzed }) {
  const scan = formatLastScanParts(iso);
  if (!scan) {
    return <Counter label="Last scan" n="never" sub="" />;
  }
  const sub = runsAnalyzed ? `${scan.time} · ${runsAnalyzed} runs` : scan.time;
  return (
    <div style={{ flex: 1, padding: '14px 16px', borderRight: '1px solid #ECE6D5' }}>
      <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Last scan</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
        <div data-testid="last-scan-date" style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17', lineHeight: 1.15 }}>{scan.date}</div>
        <div data-testid="last-scan-time" style={{ fontSize: 12, color: '#807972', lineHeight: 1.25 }}>{sub}</div>
      </div>
    </div>
  );
}

function describeSchedule(s) {
  if (!s || s.cadence === 'off') return 'Paused';
  const time = s.time || '03:00';
  if (s.cadence === 'daily')   return `Daily · ${time} ${s.tz || ''}`;
  if (s.cadence === 'weekly')  return `${DAYS[s.day || 0]} ${time} ${s.tz || ''} · weekly`;
  if (s.cadence === 'monthly') return `Day ${s.dom || 1} · ${time} ${s.tz || ''}`;
  return '—';
}

function ScheduleStrip({ list, onRun, onSchedule, schedule, scanElapsedMs, onViewResults }) {
  const items = list?.items || [];
  const scanning = !!list?.scanning;
  const runStyle = scanning
    ? { ...primaryBtn, background: '#C9BFA8', borderColor: '#C9BFA8', color: '#5C544B', cursor: 'not-allowed' }
    : primaryBtn;
  return (
    <div style={{ ...autoCard, display: 'flex', alignItems: 'stretch', marginBottom: 20 }}>
      <Counter label="New this scan" n={items.length} sub="suggestions"/>
      <Counter label="High impact"   n={items.filter(e => e.suggestion.priority === 'high').length} sub="worth a look"/>
      <LastScanCounter iso={list?.last_scan_at} runsAnalyzed={list?.runs_analyzed}/>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, minWidth: 220 }}>
        <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4 }}>Next scan</div>
        <div style={{ fontSize: 12.5, color: '#5C544B', textAlign: 'right' }}>{describeSchedule(schedule)}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {typeof onViewResults === 'function' && (
            <button onClick={onViewResults} style={ghostBtn} disabled={scanning}>View results</button>
          )}
          <button onClick={onSchedule} style={ghostBtn} disabled={scanning}>Schedule</button>
          <button onClick={onRun} style={runStyle} disabled={scanning} aria-busy={scanning}>
            {scanning ? <Spinner size={11}/> : <AutoIcon name="play" size={11}/>}
            &nbsp;{scanning ? <>Scanning… <span data-testid="scan-elapsed" style={{ fontFamily: AUTO_MONO, fontSize: 11.5, marginLeft: 2, opacity: 0.8 }}>{formatElapsed(scanElapsedMs)}</span></> : 'Scan now'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterTabs({ filter, setFilter }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 16, borderBottom: '1px solid #ECE6D5' }}>
      {FILTERS.map(f => {
        const active = filter === f.key;
        return (
          <div key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: '8px 14px', fontSize: 13, cursor: 'pointer',
            color: active ? '#1C1A17' : '#807972',
            fontWeight: active ? 500 : 400,
            borderBottom: '2px solid ' + (active ? '#1C1A17' : 'transparent'),
            marginBottom: -1,
            fontFamily: AUTO_UI,
          }}>{f.label}</div>
        );
      })}
      <span style={{ flex: 1 }}/>
      <span style={{ fontSize: 12, color: '#807972', padding: '0 0 8px' }}>Sorted by impact</span>
    </div>
  );
}

function ScheduleModal({ open, schedule, onClose, onSave }) {
  const [draft, setDraft] = React.useState(schedule || {});
  React.useEffect(() => { if (open) setDraft(schedule || {}); }, [open, schedule]);
  if (!open) return null;
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const setSurface = (k, v) => setDraft(d => ({ ...d, surfaces: { ...(d.surfaces || {}), [k]: v } }));
  const cadenceOpts = [['off','Off'], ['daily','Daily'], ['weekly','Weekly'], ['monthly','Monthly']];
  const threshOpts  = [['all','All signals'], ['med','Medium +'], ['high','High only']];
  return (
    <Modal title="Schedule auto-scan" onClose={onClose} footer={<>
      <button onClick={onClose} style={ghostBtn}>Cancel</button>
      <button onClick={() => onSave(draft)} style={primaryBtn}><AutoIcon name="check" size={11}/>&nbsp;Save schedule</button>
    </>}>
      <Row label="Cadence">
        <Seg value={draft.cadence} onChange={v => set('cadence', v)} opts={cadenceOpts}/>
      </Row>
      {draft.cadence === 'weekly' && (
        <Row label="Day">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => set('day', i)} style={{
                minWidth: 42, height: 34, padding: 0, borderRadius: 8,
                border: draft.day === i ? '1px solid #1C1A17' : '1px solid #E6DFCC',
                background: draft.day === i ? '#1C1A17' : '#FCFAF1',
                color: draft.day === i ? '#FCFBF7' : '#5C544B',
                fontSize: 12.5, fontWeight: draft.day === i ? 600 : 400, fontFamily: AUTO_UI, cursor: 'pointer',
              }}>{d}</button>
            ))}
          </div>
        </Row>
      )}
      {draft.cadence === 'monthly' && (
        <Row label="Day of month">
          <input type="number" min="1" max="28" value={draft.dom || 1}
            onChange={e => set('dom', Math.max(1, Math.min(28, +e.target.value || 1)))} style={inputStyle}/>
        </Row>
      )}
      {draft.cadence !== 'off' && (
        <>
          <Row label="Time">
            <input type="time" value={draft.time || '03:00'} onChange={e => set('time', e.target.value)}
              style={{ ...inputStyle, width: 140 }}/>
            <span style={{ fontSize: 12, color: '#807972', marginLeft: 8 }}>{draft.tz || 'Local'}</span>
          </Row>
          <Row label="Scan for">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[['skill','Skills — repeated workflows worth codifying'],
                ['memory','Memories — project and personal preferences'],
                ['strategy','Strategy — direction, spend, team shape']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#1C1A17', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!(draft.surfaces || {})[k]} onChange={() => setSurface(k, !(draft.surfaces || {})[k])} style={{ accentColor: '#1C1A17' }}/>
                  {label}
                </label>
              ))}
            </div>
          </Row>
          <Row label="Threshold">
            <Seg value={draft.threshold} onChange={v => set('threshold', v)} opts={threshOpts}/>
          </Row>
        </>
      )}
    </Modal>
  );
}

function Modal({ title, children, footer, onClose, width = 520 }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 50, background: 'rgba(28,26,23,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width, maxWidth: 'calc(100% - 48px)', maxHeight: 'calc(100% - 64px)', background: '#FCFAF1', borderRadius: 12, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(0,0,0,0.10), 0 30px 60px -10px rgba(40,30,15,0.4)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #ECE6D5', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1C1A17' }}>{title}</div>
          <button onClick={onClose} style={{ ...ghostMini, padding: '4px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <AutoIcon name="x" size={11}/> esc
          </button>
        </div>
        <div style={{ padding: '16px 18px', overflow: 'auto', flex: 1 }}>{children}</div>
        {footer && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid #ECE6D5', background: '#FAF5E8', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>{footer}</div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 14, alignItems: 'center', padding: '10px 0', borderBottom: '1px dashed #ECE6D5' }}>
      <div style={{ fontSize: 12, color: '#807972' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function Seg({ value, opts, onChange }) {
  return (
    <div style={{ display: 'inline-flex', padding: 2, borderRadius: 7, background: '#F0EAD8', border: '1px solid #E6DFCC' }}>
      {opts.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: '4px 10px', borderRadius: 5, border: 'none',
          background: value === v ? '#FCFAF1' : 'transparent', color: '#1C1A17',
          boxShadow: value === v ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
          fontSize: 12, fontWeight: value === v ? 500 : 400, cursor: 'pointer', fontFamily: AUTO_UI,
        }}>{label}</button>
      ))}
    </div>
  );
}

function WhatItSeesModal({ open, onClose, latestScanId }) {
  const [tab, setTab] = React.useState('what');
  const [scan, setScan] = React.useState(null);
  React.useEffect(() => {
    if (!open || tab !== 'sample' || !latestScanId) return;
    let alive = true;
    getOptimizerScan(latestScanId).then(s => { if (alive) setScan(s); }).catch(() => {});
    return () => { alive = false; };
  }, [open, tab, latestScanId]);
  if (!open) return null;
  return (
    <Modal title="What auto-optimization sees" width={580} onClose={onClose} footer={
      <><button onClick={onClose} style={ghostBtn}>Close</button>
        <button onClick={onClose} style={primaryBtn}>Got it</button></>}>
      <div style={{ display: 'inline-flex', padding: 2, borderRadius: 7, marginBottom: 14, background: '#F0EAD8', border: '1px solid #E6DFCC' }}>
        {[['what','What it reads'], ['sample','Sample data'], ['privacy','Privacy']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            padding: '4px 12px', borderRadius: 5, border: 'none',
            background: tab === k ? '#FCFAF1' : 'transparent', color: '#1C1A17',
            boxShadow: tab === k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            fontSize: 12.5, fontWeight: tab === k ? 500 : 400, cursor: 'pointer', fontFamily: AUTO_UI,
          }}>{label}</button>
        ))}
      </div>
      {tab === 'what' && (
        <>
          <div style={{ fontSize: 13, color: '#5C544B', lineHeight: 1.6, marginBottom: 14 }}>
            Auto-optimization runs through your configured Partner agent — same model, same provider, same redaction rules as any manual Partner chat.
          </div>
          <SeesRow ok label="Run metadata" sub="Duration, status, exit code, agent, model, cost, queue time"/>
          <SeesRow ok label="Tool-call shape and payload excerpts" sub="Same redaction rules as Partner"/>
          <SeesRow ok label="Filenames touched"  sub="Paths created, modified, deleted"/>
          <SeesRow ok label="Your edits to drafts" sub="Diff statistics for style preference learning"/>
          <SeesRow ok label="Scheduling history"  sub="When tasks fire vs when you engage"/>
          <SeesRow ok label="Transcript excerpts inside the time window" sub="Same redaction as Partner chats"/>
          <div style={{ height: 14 }}/>
          <SeesRow no label="File contents or secrets" sub="Redaction rules still apply"/>
        </>
      )}
      {tab === 'sample' && (
        <>
          <div style={{ fontSize: 12.5, color: '#807972', marginBottom: 10 }}>
            {scan ? `Latest scan: ${scan.id}, ${scan.runs_analyzed} runs analyzed.` : (latestScanId ? 'Loading…' : 'No scans yet.')}
          </div>
          {scan && (
            <pre style={{ margin: 0, padding: 12, fontFamily: AUTO_MONO, fontSize: 11.5, color: '#1C1A17', background: '#FCFAF1', border: '1px solid #ECE6D5', borderRadius: 8, maxHeight: 240, overflow: 'auto' }}>
{JSON.stringify({ id: scan.id, status: scan.status, runs_analyzed: scan.runs_analyzed, suggestions: (scan.suggestions || []).map(s => ({ id: s.id, kind: s.kind, priority: s.priority, title: s.title })) }, null, 2)}
            </pre>
          )}
        </>
      )}
      {tab === 'privacy' && (
        <>
          <PrivacyItem title="Runs through your configured Partner agent" body="Wherever your Partner runtime sends data, the scanner sends the same kind of data."/>
          <PrivacyItem title="Output is reviewed before anything changes" body="Suggestions are accepted, edited, or dismissed per row. Nothing mutates skills, memory files, or schedules unless you accept."/>
          <PrivacyItem title="Retention" body="Scan corpus is kept under ~/.crewai/optimizer/scans/ until you purge it. No automatic aggregation in v1."/>
          <PrivacyItem title="What an accepted suggestion does" body="Strategy → writes a record of intent to applied/. Skill → drops a SKILL.md in your skills folder. Memory → writes a typed markdown file under memory/ and adds a one-line pointer to MEMORY.md."/>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button style={ghostBtn} onClick={() => purgeOptimizerScans().then(() => setScan(null))}>Purge scan corpus now</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function PrivacyItem({ title, body }) {
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px dashed #ECE6D5' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#1C1A17', marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#5C544B', lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function SeesRow({ ok, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px dashed #ECE6D5' }}>
      <span style={{ marginTop: 2, width: 18, height: 18, borderRadius: '50%', background: ok ? '#E2EAE3' : '#F7E5DC', color: ok ? '#3E7A4A' : '#A4503A', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <AutoIcon name={ok ? 'check' : 'x'} size={10}/>
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: '#1C1A17' }}>{label}</div>
        {sub && <div style={{ fontSize: 12, color: '#807972', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function formatScanTimestamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() <= 1970) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }).format(d);
}

function StatusPill({ status }) {
  const map = {
    success: { label: 'Success',  bg: '#E2EAE3', fg: '#3E7A4A' },
    failed:  { label: 'Failed',   bg: '#F7E5DC', fg: '#A4503A' },
    running: { label: 'Running',  bg: '#F0EAD8', fg: '#5C544B' },
  };
  const m = map[status] || { label: status || 'Unknown', bg: '#F0EAD8', fg: '#807972' };
  return (
    <span style={{ fontSize: 11.5, padding: '2px 9px', borderRadius: 999, background: m.bg, color: m.fg, fontWeight: 500 }}>
      {m.label}
    </span>
  );
}

function ScanResultsModal({ open, onClose, scanId }) {
  const [scan, setScan] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!open) { setScan(null); setErr(null); return; }
    let alive = true;
    setLoading(true);
    setErr(null);
    // Empty scanId asks the daemon for the latest scan, so the link works
    // before the daemon has been restarted to ship last_scan_id.
    getOptimizerScan(scanId || '')
      .then(s => { if (alive) { setScan(s); setLoading(false); } })
      .catch(e => { if (alive) { setErr(e?.message || String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [open, scanId]);
  if (!open) return null;
  const suggestions = scan?.suggestions || [];
  return (
    <Modal title="Scan results" width={620} onClose={onClose} footer={
      <button onClick={onClose} style={primaryBtn}>Close</button>
    }>
      {loading && <div style={{ fontSize: 12.5, color: '#807972' }}>Loading…</div>}
      {err && <div style={{ fontSize: 13, color: '#A4503A' }}>Could not load scan: {err}</div>}
      {scan && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <StatusPill status={scan.status}/>
            <span style={{ fontSize: 12.5, color: '#5C544B' }}>{scan.runs_analyzed || 0} runs analyzed</span>
            <span style={{ flex: 1 }}/>
            <span style={{ fontSize: 11.5, color: '#A89F92', fontFamily: AUTO_MONO }}>{scan.id}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '4px 14px', fontSize: 12.5, color: '#5C544B', marginBottom: 14, paddingBottom: 12, borderBottom: '1px dashed #ECE6D5' }}>
            <div style={{ color: '#807972' }}>Started</div>
            <div>{formatScanTimestamp(scan.started_at) || '—'}</div>
            <div style={{ color: '#807972' }}>Finished</div>
            <div>{formatScanTimestamp(scan.finished_at) || '—'}</div>
            {scan.error && (
              <>
                <div style={{ color: '#807972' }}>Error</div>
                <div style={{ color: '#A4503A', wordBreak: 'break-word' }}>{scan.error}</div>
              </>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
            Suggestions ({suggestions.length})
          </div>
          {suggestions.length === 0 ? (
            <div style={{ fontSize: 13, color: '#807972', padding: '14px 0' }}>
              The agent did not surface any suggestions in this scan. This usually means recent activity does not show clear patterns worth codifying yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {suggestions.map(s => (
                <div key={s.id} style={{ padding: '10px 12px', borderRadius: 8, background: '#FCFAF1', border: '1px solid #ECE6D5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <KindBadge kind={s.kind}/>
                    <PriorityChip p={s.priority}/>
                    <span style={{ flex: 1 }}/>
                    {s.impact && <span style={{ fontSize: 11.5, color: '#807972', fontFamily: AUTO_MONO }}>{s.impact}</span>}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17', marginBottom: 2 }}>{s.title}</div>
                  {s.body && <div style={{ fontSize: 12.5, color: '#5C544B', lineHeight: 1.5 }}>{s.body}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function AutoRoute({ onToast }) {
  const [list, setList] = React.useState(null);
  const [schedule, setSchedule] = React.useState(null);
  const [editingId, setEditingId] = React.useState(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [whatOpen, setWhatOpen] = React.useState(false);
  const [resultsOpen, setResultsOpen] = React.useState(false);
  const [filter, setFilter] = React.useState('all');
  const [error, setError] = React.useState(null);
  const [bannerDismissed, setBannerDismissed] = React.useState(false);

  const refresh = React.useCallback(() => {
    listOptimizerSuggestions().then(setList).catch(e => setError(e.message || String(e)));
  }, []);

  React.useEffect(() => {
    refresh();
    getOptimizerSchedule().then(setSchedule).catch(() => {});
  }, [refresh]);

  // Poll while scanning so the spinner clears when the daemon finishes.
  React.useEffect(() => {
    if (!list?.scanning) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [list?.scanning, refresh]);

  // Tick an elapsed-time counter while a scan is running.
  const [scanElapsedMs, setScanElapsedMs] = React.useState(0);
  React.useEffect(() => {
    if (!list?.scanning) {
      setScanElapsedMs(0);
      return;
    }
    const start = Date.now();
    setScanElapsedMs(0);
    const t = setInterval(() => setScanElapsedMs(Date.now() - start), 1000);
    return () => clearInterval(t);
  }, [list?.scanning]);

  const handleRun = () => {
    setBannerDismissed(false);
    runOptimizerScan().then(refresh).catch(e => onToast?.(e.message || 'Scan failed'));
  };

  const handleAct = (id, action) => {
    actOnSuggestion(id, action).then(() => {
      refresh();
      if (action === 'accept') {
        const e = (list?.items || []).find(x => x.suggestion.id === id);
        const kind = e?.suggestion.kind;
        onToast?.(kind === 'strategy' ? 'Strategy logged' : kind === 'skill' ? 'Saved to skills/' : kind ? 'Memory pinned' : 'Done');
      }
    }).catch(e => onToast?.(e.message || 'Action failed'));
  };

  const handleSaveEdit = (id, nextPreview) => {
    actOnSuggestion(id, 'edit', nextPreview).then(() => {
      setEditingId(null);
      refresh();
      onToast?.('Edits saved — accept to apply');
    }).catch(e => onToast?.(e.message || 'Edit failed'));
  };

  const handleSaveSchedule = (next) => {
    setOptimizerSchedule(next).then(s => {
      setSchedule(s);
      setScheduleOpen(false);
      onToast?.('Schedule saved');
    }).catch(e => onToast?.(e.message || 'Save failed'));
  };

  const matches = (e, key) => {
    const k = e.suggestion.kind;
    if (key === 'all') return true;
    if (key === 'memory') return k === 'memory-project' || k === 'memory-user';
    return k === key;
  };

  const items = (list?.items || []).filter(e => matches(e, filter));
  const showBanner = !bannerDismissed && list?.last_scan_status && list.last_scan_status !== 'success' && list.last_scan_status !== 'running';
  const showWhatItSeesPrompt = !!list && isNeverScanDate(list.last_scan_at) && (list.items || []).length === 0;
  const hasScan = !!list && !isNeverScanDate(list.last_scan_at);

  return (
    <div data-testid="auto-route-shell" style={{ height: '100%', background: '#FAF5E8', overflow: 'auto', position: 'relative', padding: '60px 36px' }}>
      <div aria-hidden="true" data-testid="auto-route-drag" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 38,
        WebkitAppRegion: 'drag',
      }} />
      <div data-testid="auto-route-content" style={{ maxWidth: CONTENT_MAX_WIDTH, margin: '0 auto', width: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17', letterSpacing: -0.2 }}>Auto optimization</h1>
          <div style={{ fontSize: 13, color: '#807972', maxWidth: 640 }}>
            A weekly read of your run history. Surfaces repeating workflows worth turning into skills, facts worth pinning to memory, and co-founder-style nudges on where to spend energy next.
          </div>
        </div>

        {showBanner && (
          <Banner status={list.last_scan_status} error={list.last_scan_error}
            onRetry={handleRun} onDismiss={() => setBannerDismissed(true)}/>
        )}

        <ScheduleStrip list={list} schedule={schedule} scanElapsedMs={scanElapsedMs}
          onRun={handleRun} onSchedule={() => setScheduleOpen(true)}
          onViewResults={hasScan ? () => setResultsOpen(true) : null}/>
        <FilterTabs filter={filter} setFilter={setFilter}/>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && (
            <div style={{ ...autoCard, padding: 20, textAlign: 'center', color: '#A4503A' }}>
              Could not reach the daemon: {error} <button onClick={refresh} style={ghostBtn}>Retry</button>
            </div>
          )}
          {!error && items.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#807972', fontSize: 13 }}>
              {hasScan ? 'No suggestions in this category. Nice — your crew is dialed in.' : 'Run your first scan to see suggestions.'}
              {hasScan && (
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => setResultsOpen(true)} style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: '#5C544B', textDecoration: 'underline', fontSize: 12.5, fontFamily: AUTO_UI,
                  }}>View last scan results</button>
                </div>
              )}
            </div>
          )}
          {items.map(entry => (
            <SuggestionCard key={entry.suggestion.id} entry={entry}
              editing={editingId === entry.suggestion.id}
              onAct={handleAct}
              onEdit={(id) => setEditingId(id)}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingId(null)}/>
          ))}
        </div>

        {showWhatItSeesPrompt && (
          <div style={{ marginTop: 'auto', padding: '14px 16px', borderRadius: 10, background: '#F4EFE0', border: '1px dashed #E6DFCC', fontSize: 12.5, color: '#807972', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#A89F92' }}>ⓘ</span>
            <span>
              Auto-optimization runs through your Partner agent and only reads run history + your edits.{' '}
              <button onClick={() => setWhatOpen(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#5C544B', textDecoration: 'underline', font: 'inherit' }}>What it sees</button>
            </span>
          </div>
        )}
      </div>

      <ScheduleModal open={scheduleOpen} schedule={schedule} onClose={() => setScheduleOpen(false)} onSave={handleSaveSchedule}/>
      <WhatItSeesModal open={whatOpen} onClose={() => setWhatOpen(false)} latestScanId={list?.last_scan_id || list?.items?.[0]?.suggestion?.scan_id}/>
      <ScanResultsModal open={resultsOpen} onClose={() => setResultsOpen(false)} scanId={list?.last_scan_id || ''}/>
    </div>
  );
}
