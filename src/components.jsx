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

// Shared fixed-position tooltip — anchored to a DOMRect supplied by the
// caller. Useful when a tooltip needs to escape an overflow-clipped parent.
// Prefers the anchor's top edge but flips below when that would clip past the
// viewport (e.g. for toolbar buttons hugging the window's top).
export function FixedTooltip({ text, anchorRect }) {
  if (!anchorRect) return null;
  const TOOLTIP_HEIGHT = 28;
  const GAP = 6;
  const VIEWPORT_PAD = 4;
  const aboveTop = anchorRect.top - GAP - TOOLTIP_HEIGHT;
  const flipBelow = aboveTop < VIEWPORT_PAD;
  const top = flipBelow ? anchorRect.bottom + GAP : aboveTop;
  return (
    <div style={{
      position: 'fixed',
      top,
      left: anchorRect.left + anchorRect.width / 2,
      transform: 'translateX(-50%)',
      background: 'rgba(28,26,23,0.88)', color: '#FCFBF7',
      fontFamily: UI_FONT, fontSize: 12, fontWeight: 400, whiteSpace: 'nowrap',
      textTransform: 'none', letterSpacing: 0,
      padding: '5px 9px', borderRadius: 7,
      pointerEvents: 'none', zIndex: 9999,
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    }}>{text}</div>
  );
}

// FixedTooltip wrapper that reads the anchor element's rect lazily so the
// caller just supplies a ref and a `visible` flag.
export function HeadingTooltip({ text, anchorRef, visible }) {
  const [rect, setRect] = React.useState(null);
  React.useEffect(() => {
    if (visible && anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    else setRect(null);
  }, [visible, anchorRef]);
  if (!visible || !rect) return null;
  return <FixedTooltip text={text} anchorRect={rect} />;
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

export { RichText } from './RichText.jsx';

export function Icon({ name, size = 16 }) {
  const s = { width: size, height: size };
  const p = { stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'new':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 12.5L4 8.5l7-7a1.4 1.4 0 0 1 2 2l-7 7-4 1z" {...p}/><path d="M10 2.5l2.5 2.5" {...p}/></svg>;
    case 'agents':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="4.5" cy="5" r="1.8" {...p}/><circle cx="11.5" cy="5" r="1.8" {...p}/><circle cx="4.5" cy="11" r="1.8" {...p}/><circle cx="11.5" cy="11" r="1.8" {...p}/></svg>;
    case 'auto':
      return <svg {...s} viewBox="0 0 16 16"><path d="M6,4.5 L7.2,8.3 L11,9.5 L7.2,10.7 L6,14.5 L4.8,10.7 L1,9.5 L4.8,8.3 Z M13,1 L13.6,2.9 L15.5,3.5 L13.6,4.1 L13,6 L12.4,4.1 L10.5,3.5 L12.4,2.9 Z" {...p}/></svg>;
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
    case 'trash':
      return <svg {...s} viewBox="0 0 16 16"><path d="M5.5 5.5v7M8 5.5v7M10.5 5.5v7" {...p}/><path d="M3 4h10M6.2 4V2.8h3.6V4M4 4l.6 10h6.8L12 4" {...p}/></svg>;
    case 'edit':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 12.5l.8-3 6.8-6.8a1.3 1.3 0 0 1 1.8 1.8L5.6 11.3l-2.6 1.2z" {...p}/><path d="M9.6 3.7l2.7 2.7" {...p}/></svg>;
    case 'app-store':
      return <svg {...s} viewBox="0 0 16 16"><path d="M5.2 3.2l5.6 9.6" {...p}/><path d="M10.8 3.2L5.2 12.8" {...p}/><path d="M3.5 10.7h9" {...p}/></svg>;
    case 'google-play':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3.5 2.5l8.5 5.5-8.5 5.5z" {...p}/><path d="M3.5 2.5l5.5 5.5-5.5 5.5" {...p}/></svg>;
    case 'copy':
      return <svg {...s} viewBox="0 0 16 16"><rect x="5" y="5" width="8" height="8" rx="1.4" {...p}/><path d="M3 10.5V3.8A.8.8 0 0 1 3.8 3h6.7" {...p}/></svg>;
    case 'check':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3.5 8.2l3 3L12.8 5" {...p}/></svg>;
    case 'more':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/></svg>;
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
