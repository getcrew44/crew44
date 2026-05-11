import React from 'react';
import { UI_FONT } from './components.jsx';
import * as api from './api.js';

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function FolderIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 3.5a1 1 0 0 1 1-1h2.8l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
        stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  );
}

function FolderAddIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 3.5a1 1 0 0 1 1-1h2.8l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
        stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M7 6.5v3M5.5 8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function AgentIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M2 12c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// Generic custom picker — used for both project and agent selection
function CustomPicker({ icon, placeholder, value, items, onChange, footer }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const ref = React.useRef(null);
  const searchRef = React.useRef(null);

  const selected = items.find(i => i.id === value);

  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  React.useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setSearch('');
  }, [open]);

  const filtered = items.filter(i =>
    !search || i.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          ...chip,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: open ? '#EBE5D6' : '#FCFAF1',
          border: open ? '1px solid #DCD3BC' : '1px solid #E6DFCC',
          padding: '4px 8px 4px 9px',
          color: '#807972',
        }}
      >
        {icon}
        <span style={{ color: selected ? '#1C1A17' : '#5C544B' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: '#FFFFFF', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
          width: 240, fontFamily: UI_FONT, overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#F4F0E8', borderRadius: 8, padding: '6px 10px',
            }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="5.5" cy="5.5" r="4" stroke="#A89F92" strokeWidth="1.2"/>
                <path d="M9 9l2.5 2.5" stroke="#A89F92" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 13, color: '#1C1A17', width: '100%', fontFamily: UI_FONT,
                }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 6px' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 10px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
                No results
              </div>
            )}
            {filtered.map(item => (
              <PickerRow
                key={item.id}
                icon={icon}
                label={item.label}
                selected={item.id === value}
                onClick={() => { onChange(item.id); setOpen(false); }}
              />
            ))}
          </div>

          {footer && (
            <div style={{ borderTop: '1px solid #ECE6D5', padding: '4px 6px 6px' }}>
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PickerRow({ icon, label, selected, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 8, cursor: 'default',
        background: selected ? '#EBE5D6' : hover ? '#F4F0E8' : 'transparent',
        fontSize: 13, color: '#1C1A17', userSelect: 'none',
      }}
    >
      <span style={{ color: '#807972', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="#1C1A17" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

const SUGGESTIONS = [
  {
    t: 'Audit a flow',
    b: 'Have an agent run a heuristic review and write up findings.',
    fill: 'Audit our main onboarding flow. Run a heuristic review and surface the top drop-off points with clear recommendations.',
  },
  {
    t: 'Refactor a component',
    b: 'Hand an agent a file and a constraint, get a PR back.',
    fill: 'Refactor the TaskHeader component. Reduce prop drilling while keeping the same external API. One PR please.',
  },
  {
    t: 'Plan a release',
    b: 'Agent sequences subtasks, no code touched.',
    fill: 'Plan the next release. Sequence all remaining work, identify blockers, and produce a clear timeline. No code changes yet.',
  },
  {
    t: 'Reproduce a bug',
    b: 'Write a failing test before fixing anything.',
    fill: 'The composer sometimes submits twice on mobile. Reproduce it and write a failing test before we touch the fix.',
  },
];

export default function NewTaskRoute({ projects, agents, onNewTask, onExistingFolder }) {
  const [val, setVal] = React.useState('');
  const [selectedProjectId, setSelectedProjectId] = React.useState('');
  const [selectedAgentId, setSelectedAgentId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  const projectItems = projects.map(p => ({ id: p.id, label: p.name }));
  const agentItems = agents.map(a => ({ id: a.id, label: a.name }));

  const startCrew = async () => {
    const text = val.trim();
    if (!text || submitting) return;

    const projectId = selectedProjectId || projects[0]?.id;
    const agentId = selectedAgentId || agents[0]?.id;

    if (!projectId || !agentId) {
      setError('Select a project and ensure at least one agent exists.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const title = text.length > 55 ? text.slice(0, 52) + '…' : text;
      const chat = await api.createChat(projectId, title, agentId);
      await api.postMessage(chat.id, text, chat.main_agent_id);
      onNewTask(chat.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startCrew(); }
  };

  const canStart = val.trim() && !submitting && (selectedProjectId || projects.length > 0) && selectedAgentId;

  return (
    <div style={{ height: '100%', background: '#FAF5E8', padding: '60px 36px', overflow: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 12.5, color: '#A89F92', marginBottom: 6 }}>New task</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 24px', color: '#1C1A17', letterSpacing: -0.3 }}>
          What should the crew tackle?
        </h1>

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#FEF3EE', border: '1px solid #F5DDD4', fontSize: 13, color: '#C4644A' }}>
            {error}
          </div>
        )}

        <div style={{
          border: '1px solid #DCD3BC', borderRadius: 14, background: '#FFFEF8',
          padding: 16, boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
        }}>
          <textarea
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={submitting}
            placeholder="Describe a task. The lead agent will plan it and assign subtasks."
            rows={5}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'vertical',
              background: 'transparent', fontFamily: UI_FONT, fontSize: 15,
              color: '#1C1A17', lineHeight: 1.55, minHeight: 100,
            }}
          />
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            paddingTop: 12, borderTop: '1px solid #ECE6D5', flexWrap: 'wrap',
          }}>
            <CustomPicker
              icon={<FolderAddIcon size={13} />}
              placeholder="Pick a project"
              value={selectedProjectId}
              items={projectItems}
              onChange={setSelectedProjectId}
              footer={(close) => (
                <PickerRow
                  icon={<FolderAddIcon size={14} />}
                  label="Use existing folder"
                  onClick={() => { close(); onExistingFolder?.(); }}
                />
              )}
            />

            <CustomPicker
              icon={<AgentIcon size={13} />}
              placeholder="Pick a lead"
              value={selectedAgentId}
              items={agentItems}
              onChange={setSelectedAgentId}
            />

            <div style={{ flex: 1 }} />
            <button
              onClick={startCrew}
              disabled={!canStart}
              style={{
                ...chip,
                background: canStart ? '#1C1A17' : '#F0EAD8',
                color: canStart ? '#FCFBF7' : '#A89F92',
                border: '1px solid ' + (canStart ? '#1C1A17' : '#E6DFCC'),
                fontWeight: 500, padding: '6px 14px',
              }}
            >
              {submitting ? 'Starting…' : 'Start crew →'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {SUGGESTIONS.map((s, i) => (
            <div
              key={i}
              onClick={() => setVal(s.fill)}
              style={{ padding: 14, borderRadius: 10, border: '1px solid #ECE6D5', background: '#FCFAF1', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#EBE5D6'}
              onMouseLeave={e => e.currentTarget.style.background = '#FCFAF1'}
            >
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17', marginBottom: 4 }}>{s.t}</div>
              <div style={{ fontSize: 12.5, color: '#807972', lineHeight: 1.5 }}>{s.b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
