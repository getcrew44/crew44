import React from 'react';

export const UI_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

export function Avatar({ agent, size = 28 }) {
  if (!agent) return null;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: agent.color || '#A89F92', color: '#FCFBF7',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 600, flexShrink: 0,
      letterSpacing: 0.2,
    }}>{agent.initial || (agent.name || '?')[0].toUpperCase()}</div>
  );
}

export function MetaPill({ children, dot, dotColor }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 999,
      border: '1px solid #E6DFCC', background: '#FCFAF1',
      fontSize: 12, color: '#5C544B',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor || '#C4644A' }} />}
      {children}
    </span>
  );
}

export function Toggle({ on, onChange }) {
  const [v, setV] = React.useState(on);
  React.useEffect(() => setV(on), [on]);
  const handleClick = () => {
    const next = !v;
    setV(next);
    onChange?.(next);
  };
  return (
    <button onClick={handleClick} style={{
      width: 32, height: 18, borderRadius: 999, border: 'none', padding: 0,
      background: v ? '#1C1A17' : '#DCD3BC', cursor: 'pointer', position: 'relative',
      transition: 'background 0.15s', flexShrink: 0,
    }}>
      <span style={{
        position: 'absolute', top: 2, left: v ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#FCFBF7',
        transition: 'left 0.15s',
      }} />
    </button>
  );
}

export function RichText({ text }) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  const re = /\{\{(file|ref):([^}]+)\}\}|(@\w+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1] === 'file') {
      parts.push({ kind: 'file', value: m[2] });
    } else if (m[1] === 'ref') {
      parts.push({ kind: 'ref', value: m[2] });
    } else if (m[3]) {
      parts.push({ kind: 'mention', value: m[3] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });

  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'file') return (
          <code key={i} style={{
            fontFamily: MONO_FONT, fontSize: 12.5, color: '#C4644A',
            background: '#F7EFDD', padding: '1px 5px', borderRadius: 4,
          }}>{p.value}</code>
        );
        if (p.kind === 'ref' || p.kind === 'mention') return (
          <span key={i} style={{ color: '#C4644A', fontWeight: 500 }}>{p.value.startsWith('@') ? p.value : '@' + p.value}</span>
        );
        return <React.Fragment key={i}>{p.value}</React.Fragment>;
      })}
    </>
  );
}

export function Icon({ name, size = 16 }) {
  const s = { width: size, height: size };
  const p = { stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'new':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 12.5L4 8.5l7-7a1.4 1.4 0 0 1 2 2l-7 7-4 1z" {...p}/><path d="M10 2.5l2.5 2.5" {...p}/></svg>;
    case 'agents':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="4.5" cy="5" r="1.8" {...p}/><circle cx="11.5" cy="5" r="1.8" {...p}/><circle cx="4.5" cy="11" r="1.8" {...p}/><circle cx="11.5" cy="11" r="1.8" {...p}/></svg>;
    case 'auto':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" {...p}/><path d="M8 4v4l2.5 1.5" {...p}/></svg>;
    case 'search':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" {...p}/><path d="M10.5 10.5l3 3" {...p}/></svg>;
    case 'folder':
      return <svg {...s} viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.2 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z" {...p}/></svg>;
    case 'folder-open':
      return <svg {...s} viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.2 1.5H13a1 1 0 0 1 1 1v.5M2 5v7a1 1 0 0 0 1 1h10l1.5-5.5a.5.5 0 0 0-.5-.6H3.5a.5.5 0 0 0-.5.4L2 12" {...p}/></svg>;
    case 'gear':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" {...p}/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" {...p}/></svg>;
    case 'phone':
      return <svg {...s} viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" {...p}/><line x1="7" y1="12.5" x2="9" y2="12.5" {...p}/></svg>;
    case 'chev':
      return <svg {...s} viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" {...p}/></svg>;
    case 'plus':
      return <svg {...s} viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" {...p}/></svg>;
    case 'reset':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 8a5 5 0 1 0 1.6-3.7" {...p}/><path d="M3 2.5v3h3" {...p}/></svg>;
    default: return null;
  }
}

export const ghostBtn = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

export const primaryBtn = {
  padding: '4px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #1C1A17', background: '#1C1A17', color: '#FCFBF7',
  cursor: 'pointer', fontFamily: UI_FONT,
};

export const chipBtn = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

export const card = {
  background: '#FCFAF1', border: '1px solid #ECE6D5',
  borderRadius: 10, overflow: 'hidden',
};
