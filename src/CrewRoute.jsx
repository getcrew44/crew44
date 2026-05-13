import React from 'react';
import { Avatar, Icon, Toggle, ghostBtn, primaryBtn, card, MONO_FONT, UI_FONT } from './components.jsx';
import { relativeTime } from './utils.js';
import * as api from './api.js';

const CONTENT_MAX_WIDTH = 720;

// ─── Atoms ────────────────────────────────────────────────────────────────────

function relativeTimeAgo(isoString) {
  const value = relativeTime(isoString);
  if (!value) return '';
  return value === 'just now' ? value : `${value} ago`;
}

function StatusDot({ on }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: on ? '#3E7A4A' : '#A89F92' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#5B9C5F' : '#C9BFA8' }} />
      {on ? 'online' : 'offline'}
    </span>
  );
}

function RuntimeBadge({ engine }) {
  const ch = (engine || '?')[0].toUpperCase();
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 6,
      background: '#F0EAD8', border: '1px solid #E6DFCC',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MONO_FONT, fontSize: 11, fontWeight: 600, color: '#5C544B',
    }}>{ch}</span>
  );
}

function PropRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, padding: '5px 0', fontSize: 13, alignItems: 'center' }}>
      <span style={{ color: '#807972' }}>{label}</span>
      <span style={{ color: '#1C1A17' }}>{value}</span>
    </div>
  );
}

function SectionHeader({ icon, title, count, hint, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ color: '#807972', display: 'flex' }}><Icon name={icon} size={15} /></span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17' }}>{title}</span>
      {count != null && <span style={{ fontSize: 12.5, color: '#A89F92' }}>{count}</span>}
      {hint && <span style={{ fontSize: 12.5, color: '#807972' }}>{hint}</span>}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

const tableHead = {
  display: 'grid', alignItems: 'center', padding: '8px 16px',
  fontSize: 11.5, fontWeight: 500, color: '#A89F92',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '1px solid #ECE6D5',
};

const tableRow = {
  display: 'grid', alignItems: 'center', padding: '12px 16px',
  borderBottom: '1px solid #ECE6D5', fontSize: 13, color: '#1C1A17',
};

// ─── Runtimes ─────────────────────────────────────────────────────────────────

function RuntimesSection({ runtimes, onDataRefresh, onToast }) {
  const [rescanning, setRescanning] = React.useState(false);
  const grid = '1.4fr 0.8fr 0.6fr 1fr';
  const display = runtimes.length > 0 ? runtimes : [];

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    try {
      await api.rescanRuntimes();
      await onDataRefresh?.();
      onToast?.('Runtimes refreshed.');
    } finally {
      setRescanning(false);
    }
  };

  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="auto" title="Runtimes" count={display.length}
        hint="· environments your agents run in"
        action={
          <button
            style={{ ...ghostBtn, opacity: rescanning ? 0.65 : 1, cursor: rescanning ? 'default' : 'pointer' }}
            onClick={handleRescan}
            disabled={rescanning}
          >
            {rescanning ? 'Scanning…' : 'Rescan'}
          </button>
        }
      />
      <div style={card}>
        <div style={{ ...tableHead, gridTemplateColumns: grid }}>
          <span>Runtime</span><span>Health</span><span>Agents</span><span>CLI version</span>
        </div>
        {display.length === 0 && (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            No runtimes detected. Make sure a runtime manifest is in the scan directory.
          </div>
        )}
        {display.map(r => (
          <div key={r.id} style={{ ...tableRow, gridTemplateColumns: grid }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <RuntimeBadge engine={r.provider || r.name} />
              <span style={{ fontWeight: 500 }}>{r.name || r.id}</span>
            </span>
            <StatusDot on={r.status === 'available'} />
            <span style={{ color: '#A89F92' }}>—</span>
            <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: '#5C544B' }}>{r.version || '—'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────

function AgentChip({ agent, onClick }) {
  const clickable = !!onClick;
  return (
    <span
      onClick={clickable ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px 2px 2px', borderRadius: 999,
        background: '#FCFAF1', border: '1px solid #ECE6D5',
        fontSize: 12, color: '#1C1A17', maxWidth: '100%',
        cursor: clickable ? 'pointer' : 'default',
      }}
      title={agent.name}
    >
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: agent.color, color: '#FCFBF7',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 600, flexShrink: 0,
      }}>{agent.initial}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {agent.name}
      </span>
    </span>
  );
}

function UsedByCell({ usedBy }) {
  if (usedBy.length === 0) {
    return <span style={{ color: '#A89F92', fontSize: 12.5 }}>— Unused</span>;
  }
  const MAX_INLINE = 2;
  const visible = usedBy.slice(0, MAX_INLINE);
  const overflow = usedBy.length - visible.length;
  const overflowTitle = usedBy.slice(MAX_INLINE).map(a => a.name).join(', ');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', minWidth: 0 }}>
      {visible.map(a => <AgentChip key={a.id} agent={a} />)}
      {overflow > 0 && (
        <span title={overflowTitle} style={{ color: '#807972', fontSize: 12 }}>+{overflow}</span>
      )}
    </span>
  );
}

function SkillsSection({ skills, agentsMap, onOpenSkill }) {
  const [filter, setFilter] = React.useState('all');
  const grid = '1.4fr 1.6fr 0.6fr 24px';

  const agentsArray = Object.values(agentsMap).filter(a => a.kind === 'agent');

  // Build usedBy for each skill from agent data
  const skillUsedBy = React.useMemo(() => {
    const map = {};
    agentsArray.forEach(agent => {
      (agent.skill_ids || []).forEach(sid => {
        if (!map[sid]) map[sid] = [];
        map[sid].push(agent);
      });
    });
    return map;
  }, [agentsArray]);

  const filtered = skills.filter(s => {
    const used = (skillUsedBy[s.id] || []).length > 0;
    if (filter === 'used') return used;
    if (filter === 'unused') return !used;
    return true;
  });

  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="new" title="Skills" count={skills.length}
        hint="· instructions any agent can pick up"
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'All'], ['used', 'In use'], ['unused', 'Unused']].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                ...ghostBtn,
                background: filter === k ? '#EBE5D6' : '#FCFAF1',
                fontWeight: filter === k ? 500 : 400,
              }}>{l}</button>
            ))}
            <button style={primaryBtn}>+ New skill</button>
          </div>
        }
      />
      <div style={card}>
        <div style={{ ...tableHead, gridTemplateColumns: grid }}>
          <span>Name</span><span>Used by</span><span>Updated</span><span />
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            No skills found.
          </div>
        )}
        {filtered.map(s => {
          const usedBy = skillUsedBy[s.id] || [];
          return (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenSkill?.(s)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSkill?.(s); } }}
              style={{ ...tableRow, gridTemplateColumns: grid, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAF5E8'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{s.name}</div>
              </span>
              <span style={{ minWidth: 0 }}>
                <UsedByCell usedBy={usedBy} />
              </span>
              <span style={{ color: '#807972', fontSize: 12.5 }}>{relativeTime(s.updated_at)}</span>
              <span style={{ color: '#A89F92', textAlign: 'right' }}>›</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Skill detail dialog ──────────────────────────────────────────────────────

function SkillDetailDialog({ skill, agentsMap, onClose }) {
  const [files, setFiles] = React.useState(null);
  const [loadError, setLoadError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setLoadError(null);
    api.listSkillFiles(skill.id)
      .then(items => { if (!cancelled) setFiles(items || []); })
      .catch(err => { if (!cancelled) setLoadError(err?.message || 'Failed to load files.'); });
    return () => { cancelled = true; };
  }, [skill.id]);

  const usedBy = React.useMemo(() => {
    return Object.values(agentsMap)
      .filter(a => a.kind === 'agent' && (a.skill_ids || []).includes(skill.id));
  }, [agentsMap, skill.id]);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={dialogBackdrop} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Skill ${skill.name}`}
        style={{ ...dialogSurface, width: 'min(640px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17', wordBreak: 'break-word' }}>{skill.name}</div>
            {skill.path && (
              <div style={{ fontSize: 12, color: '#807972', fontFamily: MONO_FONT, marginTop: 4, wordBreak: 'break-all' }}>
                {skill.path}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: '#807972', marginTop: 6 }}>
              Updated {relativeTimeAgo(skill.updated_at) || '—'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              border: 'none', background: 'transparent', color: '#807972',
              cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4, marginTop: -4, marginRight: -4,
            }}
          >×</button>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 6 }}>
            Used by <span style={{ color: '#807972' }}>{usedBy.length}</span>
          </div>
          {usedBy.length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>No agents are using this skill.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {usedBy.map(a => <AgentChip key={a.id} agent={a} />)}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 6 }}>
            Instructions
          </div>
          <div style={{
            ...card, padding: 0, flex: 1, minHeight: 120, maxHeight: '46vh', overflow: 'auto',
          }}>
            {files === null && !loadError && (
              <div style={{ padding: '14px 16px', fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>Loading…</div>
            )}
            {loadError && (
              <div style={{ padding: '14px 16px', fontSize: 12.5, color: '#C4644A' }}>{loadError}</div>
            )}
            {files && files.length === 0 && !loadError && (
              <div style={{ padding: '14px 16px', fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>
                No instruction files for this skill.
              </div>
            )}
            {files && files.map(f => (
              <div key={f.id} style={{ borderBottom: '1px solid #ECE6D5' }}>
                <div style={{ padding: '8px 14px', fontFamily: MONO_FONT, fontSize: 11.5, color: '#807972', background: '#FAF5E8' }}>
                  {f.id}
                </div>
                <pre style={{
                  margin: 0, padding: '12px 14px', fontFamily: MONO_FONT, fontSize: 12,
                  color: '#1C1A17', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>{f.content}</pre>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={ghostBtn}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Dialogs ──────────────────────────────────────────────────────────────────

const dialogBackdrop = {
  position: 'fixed', inset: 0, zIndex: 9999,
  background: 'rgba(28,26,23,0.28)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};

const dialogSurface = {
  width: 'min(460px, 100%)',
  background: '#FCFBF7',
  border: '1px solid #E6DFCC',
  borderRadius: 10,
  boxShadow: '0 20px 60px rgba(28,26,23,0.22)',
  padding: 20,
};

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid #D8CFB8', borderRadius: 6,
  background: '#FFFDF7', color: '#1C1A17',
  fontSize: 13, padding: '9px 11px', outline: 'none',
  fontFamily: UI_FONT,
};

function AgentFormDialog({ mode, initial, runtimes, onCancel, onSubmit }) {
  const [name, setName] = React.useState(initial?.name || '');
  const [runtimeId, setRuntimeId] = React.useState(initial?.runtime_id || runtimes[0]?.id || '');
  const [model, setModel] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  const isCreate = mode === 'create';
  const canSubmit = name.trim().length > 0 && (!isCreate || runtimeId);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), runtime_id: runtimeId, model: model.trim() });
    } catch (err) {
      setError(err?.message || 'Something went wrong');
      setSubmitting(false);
    }
  };

  const runtimeOptions = runtimes.map(r => ({ value: r.id, label: r.name || r.id }));

  return (
    <div style={dialogBackdrop} onClick={onCancel}>
      <div role="dialog" aria-modal="true" style={dialogSurface} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17', marginBottom: 4 }}>
          {isCreate ? 'New agent' : 'Rename agent'}
        </div>
        <div style={{ fontSize: 13, color: '#807972', marginBottom: 16 }}>
          {isCreate ? 'Give your agent a name, pick the runtime, and optionally a model.' : 'Choose a new name for this agent.'}
        </div>

        <label style={{ fontSize: 12, fontWeight: 500, color: '#5C544B', display: 'block', marginBottom: 6 }}>Name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && canSubmit) handleSubmit();
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="e.g. Coding Agent"
          style={{ ...inputStyle, marginBottom: isCreate ? 14 : 8 }}
        />

        {isCreate && (
          <>
            <label style={{ fontSize: 12, fontWeight: 500, color: '#5C544B', display: 'block', marginBottom: 6 }}>Runtime</label>
            {runtimes.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#A89F92', fontStyle: 'italic', marginBottom: 8 }}>
                No runtimes available. Add one in the Runtimes tab first.
              </div>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <CustomSelect
                  value={runtimeId}
                  options={runtimeOptions}
                  onChange={setRuntimeId}
                  placeholder="Pick a runtime…"
                />
              </div>
            )}

            <label style={{ fontSize: 12, fontWeight: 500, color: '#5C544B', display: 'block', marginBottom: 6 }}>Model</label>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && canSubmit) handleSubmit();
                if (e.key === 'Escape') onCancel();
              }}
              placeholder="Auto"
              style={{ ...inputStyle, marginBottom: 4, fontFamily: MONO_FONT, fontSize: 12.5 }}
            />
            <div style={{ fontSize: 11.5, color: '#A89F92', marginBottom: 8 }}>
              Leave blank to use the runtime's default model.
            </div>
          </>
        )}

        {error && (
          <div style={{ fontSize: 12.5, color: '#C4644A', marginTop: 4, marginBottom: 4 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            style={{
              ...primaryBtn,
              opacity: canSubmit && !submitting ? 1 : 0.6,
              cursor: canSubmit && !submitting ? 'pointer' : 'default',
            }}
          >
            {submitting ? (isCreate ? 'Creating…' : 'Saving…') : (isCreate ? 'Create agent' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, onCancel, onConfirm }) {
  const [submitting, setSubmitting] = React.useState(false);
  const handleConfirm = async () => {
    setSubmitting(true);
    try { await onConfirm(); } finally { setSubmitting(false); }
  };
  return (
    <div style={dialogBackdrop} onClick={onCancel}>
      <div role="dialog" aria-modal="true" style={dialogSurface} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: '#5C544B', lineHeight: 1.5, marginBottom: 18 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={submitting}
            style={{
              ...primaryBtn,
              background: danger ? '#C4644A' : '#1C1A17',
              borderColor: danger ? '#C4644A' : '#1C1A17',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomSelect({ value, options, onChange, placeholder, disabled, size = 'md' }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const selected = options.find(o => o.value === value);
  const isCompact = size === 'sm';

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
        style={{
          width: '100%', boxSizing: 'border-box',
          display: 'flex', alignItems: 'center', gap: 8,
          border: '1px solid ' + (open ? '#C9BFA8' : '#E6DFCC'),
          borderRadius: 6, background: '#FCFAF1', color: '#1C1A17',
          fontSize: isCompact ? 12.5 : 13, fontFamily: UI_FONT,
          padding: isCompact ? '4px 8px' : '8px 11px',
          cursor: disabled ? 'default' : 'pointer',
          outline: 'none', textAlign: 'left',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: selected ? '#1C1A17' : '#A89F92',
        }}>{selected ? selected.label : (placeholder || 'Select…')}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, color: '#807972' }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 9999,
          background: '#FFFFFF', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
          padding: 4, maxHeight: 240, overflowY: 'auto',
          fontFamily: UI_FONT,
        }}>
          {options.length === 0 && (
            <div style={{ padding: '7px 10px', fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>No options</div>
          )}
          {options.map(opt => (
            <DropdownRow
              key={opt.value}
              label={opt.label}
              hint={opt.hint}
              selected={opt.value === value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DropdownRow({ label, hint, selected, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 7, cursor: 'default',
        background: hover ? '#F0EAD8' : 'transparent',
        fontSize: 13, color: '#1C1A17',
        userSelect: 'none',
      }}
    >
      <span style={{ flex: 1, fontWeight: selected ? 500 : 400 }}>{label}</span>
      {hint && <span style={{ fontSize: 12, color: '#A89F92' }}>{hint}</span>}
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: '#5C544B' }}>
          <path d="M2.5 6l2.5 2.5L9.5 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

function MenuRow({ icon, label, danger, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 7, cursor: 'default',
        background: hover ? (danger ? '#FEF3EE' : '#F4F0E8') : 'transparent',
        fontSize: 13, color: danger ? '#C4644A' : '#1C1A17',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'inline-flex', width: 14, height: 14, color: danger ? '#C4644A' : '#5C544B' }}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function AgentMenu({ isPreset, canDelete = true, onRename, onResetPreset, onDelete, onClose }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const items = [
    {
      label: 'Rename',
      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 10.5l.8-3 6-6a1.2 1.2 0 0 1 1.7 1.7l-6 6-2.5.3z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      action: () => { onClose(); onRename?.(); },
    },
    ...(isPreset ? [
      { divider: true },
      {
        label: 'Reset to factory version',
        icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 4.5a4 4 0 1 1-.4 4M2.5 2.5v2h2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        action: () => { onClose(); onResetPreset?.(); },
      },
    ] : []),
    ...(canDelete ? [
      { divider: true },
      {
        label: 'Remove',
        icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2h3v1.5M3.5 3.5l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
        danger: true,
        action: () => { onClose(); onDelete?.(); },
      },
    ] : []),
  ];

  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 4,
      zIndex: 9999,
      background: '#FFFFFF', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
      padding: '4px', minWidth: 172,
      fontFamily: UI_FONT,
    }}>
      {items.map((item, i) => item.divider ? (
        <div key={i} style={{ height: 1, background: '#ECE6D5', margin: '3px 0' }} />
      ) : (
        <MenuRow key={i} icon={item.icon} label={item.label} danger={item.danger} onClick={item.action} />
      ))}
    </div>
  );
}

function canDeleteAgent(agent) {
  return !(agent?.preset_id === 'default-crew' && agent?.preset_key === 'partner');
}

function displayModel(model) {
  return model || 'auto';
}

// ─── Agents grid ──────────────────────────────────────────────────────────────

function AgentsSection({ agents, runtimes, onPickAgent, onDataRefresh, onToast, onViewRuntimes }) {
  const runtimeMap = Object.fromEntries(runtimes.map(r => [r.id, r]));
  const [menuOpenId, setMenuOpenId] = React.useState(null);
  const [renameFor, setRenameFor] = React.useState(null);
  const [deleteFor, setDeleteFor] = React.useState(null);
  const [resetFor, setResetFor] = React.useState(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [presets, setPresets] = React.useState([]);
  const [seedBusy, setSeedBusy] = React.useState(false);
  const [resetBusy, setResetBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    api.listPresets().then(items => { if (!cancelled) setPresets(items); }).catch(() => {});
    return () => { cancelled = true; };
  }, [agents]);

  const missingPresets = presets.filter(p => !p.has_copy);
  const hasMissingPresets = missingPresets.length > 0;
  const noRuntimes = runtimes.length === 0;
  const noAgents = agents.length === 0;
  const needsRuntimeSetup = noRuntimes && noAgents;

  const handleCreate = async ({ name, runtime_id, model }) => {
    await api.createAgent(name, '', runtime_id, model || '');
    setShowCreate(false);
    onDataRefresh?.();
  };

  const handleRename = async ({ name }) => {
    await api.updateAgent(renameFor.id, { ...renameFor, name });
    setRenameFor(null);
    onDataRefresh?.();
  };

  const handleDelete = async () => {
    await api.archiveAgent(deleteFor.id);
    setDeleteFor(null);
    onDataRefresh?.();
  };

  const handleSeed = async () => {
    setSeedBusy(true);
    try {
      const result = await api.seedDefaultCrew();
      const created = (result?.created_agents || []).length;
      const skipped = (result?.skipped_agents || []).length;
      if (created === 0 && skipped > 0) {
        onToast?.('Starter crew already present.');
      } else {
        onToast?.(`Added ${created} starter agent${created === 1 ? '' : 's'}.`);
      }
      onDataRefresh?.();
    } catch (e) {
      onToast?.('Could not add starter crew. Try again.');
    } finally {
      setSeedBusy(false);
    }
  };

  const handleResetAgent = async () => {
    if (!resetFor) return;
    setResetBusy(true);
    try {
      await api.resetAgentPreset(resetFor.id);
      onToast?.(`Reset "${resetFor.name}" to factory version.`);
      setResetFor(null);
      onDataRefresh?.();
    } catch (e) {
      onToast?.('Reset failed. Try again.');
    } finally {
      setResetBusy(false);
    }
  };

  const headerAction = (
    <div style={{ display: 'flex', gap: 8 }}>
      {hasMissingPresets && !noRuntimes && (
        <button
          style={{ ...primaryBtn, background: '#FCFAF1', color: '#5C544B', border: '1px solid #ECE6D5' }}
          onClick={handleSeed}
          disabled={seedBusy}
        >
          {seedBusy ? 'Adding…' : '+ Add starter crew'}
        </button>
      )}
      {!noRuntimes && <button style={primaryBtn} onClick={() => setShowCreate(true)}>+ New agent</button>}
    </div>
  );

  return (
    <section>
      <SectionHeader
        icon="agents" title="Agents" count={agents.length}
        hint="· the crew"
        action={headerAction}
      />
      {needsRuntimeSetup ? (
        <div style={{
          padding: '18px 0 4px',
          borderTop: '1px solid #ECE6D5',
          color: '#807972',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17', marginBottom: 6 }}>
            Install a runtime to get started.
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 480, marginBottom: 12 }}>
            Install Claude Code, Codex, Cursor, or another supported runtime, then rescan from Runtimes.
          </div>
          <button style={ghostBtn} onClick={onViewRuntimes}>View runtimes</button>
        </div>
      ) : noAgents && (
        <div style={{ fontSize: 13, color: '#A89F92', fontStyle: 'italic', padding: '8px 0' }}>
          No agents yet. Create one to get started.
        </div>
      )}
      <div style={{
        display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
      }}>
        {agents.map(a => {
          const rt = runtimeMap[a.runtime_id];
          const menuOpen = menuOpenId === a.id;
          return (
            <div key={a.id}
              onClick={() => onPickAgent(a.id)}
              style={{
                ...card, padding: '22px 22px 16px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 18,
                transition: 'background 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s',
                minHeight: 132, position: 'relative',
                boxShadow: '0 8px 22px rgba(92, 84, 75, 0.035)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#FAF5E8';
                e.currentTarget.style.borderColor = '#DCD3BC';
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 12px 28px rgba(92, 84, 75, 0.06)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '#FCFAF1';
                e.currentTarget.style.borderColor = '#ECE6D5';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 8px 22px rgba(92, 84, 75, 0.035)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <Avatar agent={a} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 16.5, fontWeight: 600, color: '#1C1A17',
                    letterSpacing: -0.1, lineHeight: 1.25,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{a.name}</div>
                  <div style={{ fontSize: 13, color: '#A89F92', marginTop: 4, fontWeight: 500 }}>
                    {a.updated_at ? `Updated ${relativeTimeAgo(a.updated_at)}` : 'Never updated'}
                  </div>
                </div>
                <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpen ? null : a.id);
                    }}
                    aria-label="Agent options"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    style={{
                      border: 'none',
                      background: menuOpen ? '#ECE6D5' : 'transparent',
                      padding: 4,
                      color: menuOpen ? '#5C544B' : '#A89F92',
                      cursor: 'pointer', display: 'inline-flex',
                      borderRadius: 6, marginTop: -2, marginRight: -4,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#ECE6D5'; e.currentTarget.style.color = '#5C544B'; }}
                    onMouseLeave={e => {
                      if (!menuOpen) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = '#A89F92';
                      }
                    }}
                  >
                    <Icon name="more" size={16} />
                  </button>
                  {menuOpen && (
                    <AgentMenu
                      isPreset={!!a.preset_key}
                      canDelete={canDeleteAgent(a)}
                      onClose={() => setMenuOpenId(null)}
                      onRename={() => { setMenuOpenId(null); setRenameFor(a); }}
                      onResetPreset={() => { setMenuOpenId(null); setResetFor(a); }}
                      onDelete={() => { setMenuOpenId(null); setDeleteFor(a); }}
                    />
                  )}
                </div>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                paddingTop: 14, borderTop: '1px solid #E9E1CE',
                marginTop: 'auto',
              }}>
                {rt ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }} title={rt.name}>
                    <span style={{
                      fontSize: 12.5, color: '#807972', fontWeight: 500,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {rt.name || rt.id}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>No runtime</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <AgentFormDialog
          mode="create"
          runtimes={runtimes}
          onCancel={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}
      {renameFor && (
        <AgentFormDialog
          mode="rename"
          initial={renameFor}
          runtimes={runtimes}
          onCancel={() => setRenameFor(null)}
          onSubmit={handleRename}
        />
      )}
      {deleteFor && (
        <ConfirmDialog
          title={`Delete ${deleteFor.name}?`}
          message={`This will archive "${deleteFor.name}". Chats and sessions that referenced this agent will keep their history, but you won't be able to assign new work to it.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteFor(null)}
          onConfirm={handleDelete}
        />
      )}
      {resetFor && (
        <ConfirmDialog
          title={`Reset ${resetFor.name} to factory version?`}
          message={`This overwrites the agent's instructions, name, and assigned skills with the original factory definition. Any edits you made to this agent will be lost. Chats and history are kept.`}
          confirmLabel={resetBusy ? 'Resetting…' : 'Reset to factory'}
          onCancel={resetBusy ? undefined : () => setResetFor(null)}
          onConfirm={handleResetAgent}
        />
      )}
    </section>
  );
}

// ─── Agent detail ─────────────────────────────────────────────────────────────

const INSTRUCTION_EDITOR_MAX_HEIGHT = 560;

function resizeInstructionEditor(editor) {
  if (!editor) return;

  editor.style.height = 'auto';
  const nextHeight = Math.min(editor.scrollHeight || 52, INSTRUCTION_EDITOR_MAX_HEIGHT);
  editor.style.height = `${nextHeight}px`;
  editor.style.overflowY = editor.scrollHeight > INSTRUCTION_EDITOR_MAX_HEIGHT ? 'auto' : 'hidden';
}

function AgentDetail({ agent, skills, runtimes, agentsMap, onBack, onSave, onRefresh, onOpenSkill }) {
  const [tab, setTab] = React.useState('instructions');
  const [instruction, setInstruction] = React.useState(agent.instruction || '');
  const [saving, setSaving] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const instructionEditorRef = React.useRef(null);

  React.useLayoutEffect(() => {
    resizeInstructionEditor(instructionEditorRef.current);
  }, [instruction, tab]);

  const agentSkills = skills.filter(s => (agent.skill_ids || []).includes(s.id));
  const nonAgentSkills = skills.filter(s => !(agent.skill_ids || []).includes(s.id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgent(agent.id, { ...agent, instruction });
      onSave?.();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSkill = async (skillId, on) => {
    const current = agent.skill_ids || [];
    const next = on ? [...current, skillId] : current.filter(id => id !== skillId);
    try {
      await api.replaceAgentSkills(agent.id, next);
      onRefresh?.();
    } catch (err) {
      console.error('Skill toggle failed:', err);
    }
  };

  const handleRuntimeChange = async (nextRuntimeId) => {
    if (!nextRuntimeId || nextRuntimeId === agent.runtime_id) return;
    try {
      await api.updateAgent(agent.id, { ...agent, runtime_id: nextRuntimeId });
      onRefresh?.();
    } catch (err) {
      console.error('Runtime switch failed:', err);
    }
  };

  const handleDelete = async () => {
    await api.archiveAgent(agent.id);
    setConfirmDelete(false);
    onBack?.();
    onRefresh?.();
  };

  const runtimeOptions = runtimes || [];
  const runtimeSelectable = runtimeOptions.length > 0;
  const deleteAllowed = canDeleteAgent(agent);
  const modelLabel = displayModel(agent.model);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FAF5E8' }}>
      <div style={{
        padding: '16px 36px 12px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
        WebkitAppRegion: 'drag',
      }}>
        <span onClick={onBack} style={{ color: '#807972', cursor: 'pointer', WebkitAppRegion: 'no-drag' }}>Agents</span>
        <span style={{ color: '#C9BFA8' }}>›</span>
        <span style={{ color: '#1C1A17', fontWeight: 500 }}>{agent.name}</span>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 36px' }}>
        <div data-testid="agent-detail-content" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, maxWidth: CONTENT_MAX_WIDTH, margin: '0 auto', width: '100%' }}>
          {/* Left: identity */}
          <aside>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: agent.color, color: '#FCFBF7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 600, marginBottom: 14,
            }}>{agent.initial}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17' }}>{agent.name}</div>
            <div style={{ fontSize: 13, color: '#807972', marginBottom: 16 }}>{modelLabel}</div>

            <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>Properties</div>
            <PropRow label="Model" value={<code style={{ fontFamily: MONO_FONT, fontSize: 12 }}>{modelLabel}</code>} />
            <PropRow label="Runtime" value={
              runtimeSelectable ? (
                <CustomSelect
                  value={agent.runtime_id || ''}
                  options={runtimeOptions.map(r => ({ value: r.id, label: r.name || r.id }))}
                  onChange={handleRuntimeChange}
                  placeholder="Pick a runtime…"
                  size="sm"
                />
              ) : (agent.runtime_id || '—')
            } />
            <PropRow label="Created" value={relativeTimeAgo(agent.created_at)} />
            <PropRow label="Updated" value={relativeTimeAgo(agent.updated_at)} />

            <div style={{ marginTop: 20, fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>
              Skills <span style={{ color: '#807972' }}>{agentSkills.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {agentSkills.map(s => (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenSkill?.(s)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSkill?.(s); } }}
                  style={{
                    padding: '6px 10px', borderRadius: 6, background: '#FCFAF1',
                    border: '1px solid #ECE6D5', fontSize: 12.5, cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#F4EDD8'; e.currentTarget.style.borderColor = '#DCD3BC'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#FCFAF1'; e.currentTarget.style.borderColor = '#ECE6D5'; }}
                  title="View skill details"
                >
                  <span style={{ fontFamily: MONO_FONT, fontSize: 11, color: '#5C544B' }}>{s.name}</span>
                </div>
              ))}
              {agentSkills.length === 0 && (
                <div style={{ fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>No skills attached</div>
              )}
            </div>

            {deleteAllowed && (
              <button
                onClick={() => setConfirmDelete(true)}
                style={{
                  marginTop: 28,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  border: '1px solid #E8C9BD', background: '#FCFAF1',
                  color: '#C4644A', borderRadius: 6,
                  padding: '6px 11px', fontSize: 12.5, fontFamily: UI_FONT,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#FEF3EE'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#FCFAF1'; }}
              >
                <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                  <path d="M2 3.5h9M5 3.5V2h3v1.5M3.5 3.5l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Delete agent
              </button>
            )}
          </aside>

          {/* Right: tabs */}
          <main>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ECE6D5', marginBottom: 18 }}>
              {[['instructions', 'Instructions'], ['skills', 'Skills']].map(([k, l]) => (
                <div key={k} onClick={() => setTab(k)} style={{
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                  color: tab === k ? '#1C1A17' : '#807972',
                  fontWeight: tab === k ? 500 : 400,
                  borderBottom: '2px solid ' + (tab === k ? '#1C1A17' : 'transparent'),
                  marginBottom: -1,
                }}>{l}</div>
              ))}
            </div>

            {tab === 'instructions' && (
              <div style={{ ...card, padding: 0 }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid #ECE6D5', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: '#807972' }}>system prompt</span>
                  <div style={{ flex: 1 }} />
                  <button style={ghostBtn} onClick={() => setInstruction(agent.instruction || '')}>Revert</button>
                  <button style={primaryBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <textarea
                  ref={instructionEditorRef}
                  data-testid="agent-instruction-input"
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  rows={1}
                  style={{
                    width: '100%', maxHeight: INSTRUCTION_EDITOR_MAX_HEIGHT, border: 'none', outline: 'none', resize: 'none',
                    padding: 16, background: 'transparent', fontFamily: MONO_FONT, fontSize: 12.5,
                    color: '#1C1A17', lineHeight: 1.6,
                  }}
                />
              </div>
            )}

            {tab === 'skills' && (
              <div style={card}>
                {skills.length === 0 && (
                  <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
                    No skills available. Create some in the Skills tab.
                  </div>
                )}
                {skills.map(s => {
                  const on = (agent.skill_ids || []).includes(s.id);
                  return (
                    <div key={s.id} style={{
                      padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
                      display: 'flex', alignItems: 'center', gap: 14,
                    }}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenSkill?.(s)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSkill?.(s); } }}
                        style={{ flex: 1, cursor: 'pointer' }}
                        title="View skill details"
                      >
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>{s.name}</div>
                      </div>
                      <Toggle on={on} onChange={(v) => handleToggleSkill(s.id, v)} />
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${agent.name}?`}
          message={`This will archive "${agent.name}". Chats and sessions that referenced this agent will keep their history, but you won't be able to assign new work to it.`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

// ─── Crew tabs ────────────────────────────────────────────────────────────────

const CREW_TABS = [
  { key: 'agents',   label: 'Agents',   subtitle: 'Your crew. Pick one to edit instructions, attach skills, or tune the runtime.' },
  { key: 'skills',   label: 'Skills',   subtitle: 'Shared instructions any agent in this workspace can pick up.' },
  { key: 'runtimes', label: 'Runtimes', subtitle: 'The environments your agents run in. Add hosts, watch their health and spend.' },
];

function CrewTabs({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #ECE6D5', marginBottom: 22 }}>
      {CREW_TABS.map(t => (
        <div key={t.key} onClick={() => setTab(t.key)} style={{
          padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          color: tab === t.key ? '#1C1A17' : '#807972',
          fontWeight: tab === t.key ? 500 : 400,
          borderBottom: '2px solid ' + (tab === t.key ? '#1C1A17' : 'transparent'),
          marginBottom: -1,
        }}>{t.label}</div>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function CrewRoute({ agents, agentsMap, skills, runtimes, initialTab, onDataRefresh, onToast }) {
  const [tab, setTab] = React.useState(initialTab || 'agents');
  const [openAgentId, setOpenAgentId] = React.useState(null);
  const [openSkillId, setOpenSkillId] = React.useState(null);

  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const openSkill = openSkillId ? skills.find(s => s.id === openSkillId) : null;
  const skillDialog = openSkill ? (
    <SkillDetailDialog
      skill={openSkill}
      agentsMap={agentsMap}
      onClose={() => setOpenSkillId(null)}
    />
  ) : null;

  const detail = openAgentId ? agents.find(a => a.id === openAgentId) : null;
  if (detail) return (
    <>
      <AgentDetail
        agent={detail}
        skills={skills}
        runtimes={runtimes}
        agentsMap={agentsMap}
        onBack={() => setOpenAgentId(null)}
        onSave={() => { setOpenAgentId(null); onDataRefresh?.(); }}
        onRefresh={() => onDataRefresh?.()}
        onOpenSkill={(s) => setOpenSkillId(s.id)}
      />
      {skillDialog}
    </>
  );

  const meta = CREW_TABS.find(t => t.key === tab);
  return (
    <div data-testid="crew-route-shell" style={{ height: '100%', background: '#FAF5E8', overflow: 'auto', position: 'relative', padding: '60px 36px' }}>
      <div aria-hidden="true" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 38,
        WebkitAppRegion: 'drag',
      }} />
      <div data-testid="crew-route-content" style={{ maxWidth: CONTENT_MAX_WIDTH, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17', letterSpacing: -0.2 }}>Crew</h1>
        <div style={{ fontSize: 13, color: '#807972', marginBottom: 18 }}>{meta?.subtitle}</div>
        <CrewTabs tab={tab} setTab={setTab} />
        {tab === 'agents'   && <AgentsSection agents={agents} runtimes={runtimes} onPickAgent={setOpenAgentId} onDataRefresh={onDataRefresh} onToast={onToast} onViewRuntimes={() => setTab('runtimes')} />}
        {tab === 'skills'   && <SkillsSection skills={skills} agentsMap={agentsMap} onOpenSkill={(s) => setOpenSkillId(s.id)} />}
        {tab === 'runtimes' && <RuntimesSection runtimes={runtimes} onDataRefresh={onDataRefresh} onToast={onToast} />}
      </div>
      {skillDialog}
    </div>
  );
}
