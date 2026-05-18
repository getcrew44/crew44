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

// Inline tokens: {{file:...}}, {{ref:...}}, **bold**, *italic*, `code`.
function renderInline(text, keyPrefix = '') {
  if (!text) return null;
  const tokens = [];
  const re = /\{\{(file|ref):([^}]+)\}\}|\*\*([^*]+)\*\*|\*([^*\n]+)\*|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1] === 'file') tokens.push({ kind: 'file', value: m[2] });
    else if (m[1] === 'ref') tokens.push({ kind: 'ref', value: m[2] });
    else if (m[3] != null) tokens.push({ kind: 'bold', value: m[3] });
    else if (m[4] != null) tokens.push({ kind: 'italic', value: m[4] });
    else if (m[5] != null) tokens.push({ kind: 'code', value: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });

  return tokens.map((p, i) => {
    const key = keyPrefix + i;
    if (p.kind === 'file') return (
      <code key={key} style={{
        fontFamily: MONO_FONT, fontSize: 12.5, color: '#C4644A',
        background: '#F7EFDD', padding: '1px 5px', borderRadius: 4,
      }}>{p.value}</code>
    );
    if (p.kind === 'code') return (
      <code key={key} style={{
        fontFamily: MONO_FONT, fontSize: 12.5, color: '#1C1A17',
        background: '#ECE6D5', padding: '1px 5px', borderRadius: 4,
      }}>{p.value}</code>
    );
    if (p.kind === 'bold') return (
      <strong key={key} style={{ fontWeight: 600, color: '#1C1A17' }}>{p.value}</strong>
    );
    if (p.kind === 'italic') return (
      <em key={key} style={{ fontStyle: 'italic' }}>{p.value}</em>
    );
    if (p.kind === 'ref') return (
      <span key={key} style={{ color: '#C4644A', fontWeight: 500 }}>{'@' + p.value}</span>
    );
    return <React.Fragment key={key}>{p.value}</React.Fragment>;
  });
}

const HEADING_STYLE = {
  1: { fontSize: 20, fontWeight: 700, lineHeight: 1.25, margin: '12px 0 8px' },
  2: { fontSize: 17, fontWeight: 650, lineHeight: 1.3,  margin: '12px 0 6px' },
  3: { fontSize: 15, fontWeight: 600, lineHeight: 1.35, margin: '10px 0 4px' },
  4: { fontSize: 14, fontWeight: 600, lineHeight: 1.4,  margin: '8px 0 4px'  },
};

const CODE_BLOCK_STYLE = {
  padding: '10px 12px', borderRadius: 6,
  background: '#F4EFE0', border: '1px solid #ECE6D5',
  fontFamily: MONO_FONT, fontSize: 12.5, lineHeight: 1.55,
  color: '#1C1A17', whiteSpace: 'pre',
  overflowX: 'auto',
};

// Render an inline paragraph's lines, preserving single newlines as <br>.
function renderParagraphLines(lines, keyPrefix) {
  return lines.map((line, idx) => (
    <React.Fragment key={`${keyPrefix}${idx}`}>
      {idx > 0 && <br />}
      {renderInline(line, `${keyPrefix}${idx}-`)}
    </React.Fragment>
  ));
}

// Block renderer: paragraphs (single-newline preserves a soft break), fenced
// code blocks (```lang … ```), bullet lists (`- `/`* `), ordered lists (`1.`),
// ATX headings (`#`–`####`), and horizontal rules (`---`/`***`). A single
// paragraph body renders without wrapping so inline layouts stay tight.
export function RichText({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  let fence = null; // { lang, lines } while inside a ``` block

  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', lines: para }); para = []; } };
  const flushList = () => { if (list && list.items.length) { blocks.push(list); list = null; } };

  for (const raw of lines) {
    const fenceMatch = raw.match(/^\s*```\s*([\w+-]*)\s*$/);

    if (fence) {
      if (fenceMatch) {
        blocks.push({ kind: 'code', lang: fence.lang, lines: fence.lines });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    if (fenceMatch) {
      flushPara();
      flushList();
      fence = { lang: fenceMatch[1] || '', lines: [] };
      continue;
    }

    const line = raw.replace(/\s+$/, '');
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bullet = /^\s*[-*]\s+/.test(line);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    const hr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', level: heading[1].length, text: heading[2] });
    } else if (hr) {
      flushPara();
      flushList();
      blocks.push({ kind: 'hr' });
    } else if (bullet) {
      flushPara();
      if (!list || list.kind !== 'ul') { flushList(); list = { kind: 'ul', items: [] }; }
      list.items.push(line.replace(/^\s*[-*]\s+/, ''));
    } else if (numbered) {
      flushPara();
      if (!list || list.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [] }; }
      list.items.push(numbered[1]);
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  if (fence) blocks.push({ kind: 'code', lang: fence.lang, lines: fence.lines });
  flushPara();
  flushList();

  if (blocks.length === 1 && blocks[0].kind === 'p') {
    return <>{renderParagraphLines(blocks[0].lines, '')}</>;
  }

  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          const Tag = `h${Math.min(b.level + 1, 6)}`;
          const s = HEADING_STYLE[b.level] || HEADING_STYLE[4];
          return (
            <Tag key={i} style={{ ...s, color: '#1C1A17', marginTop: i === 0 ? 0 : s.margin.split(' ')[0] }}>
              {renderInline(b.text, `${i}-`)}
            </Tag>
          );
        }
        if (b.kind === 'hr') return (
          <hr key={i} style={{
            border: 'none', borderTop: '1px solid #ECE6D5',
            margin: '12px 0',
          }} />
        );
        if (b.kind === 'code') return (
          <pre key={i} style={{
            ...CODE_BLOCK_STYLE,
            margin: i === 0 ? '0 0 8px' : '8px 0',
          }}>{b.lines.join('\n')}</pre>
        );
        if (b.kind === 'p') return (
          <p key={i} style={{ margin: i === 0 ? '0 0 8px' : '8px 0' }}>
            {renderParagraphLines(b.lines, `${i}-`)}
          </p>
        );
        if (b.kind === 'ul' || b.kind === 'ol') {
          const ListTag = b.kind === 'ol' ? 'ol' : 'ul';
          return (
            <ListTag key={i} style={{
              margin: i === 0 ? '0 0 8px' : '8px 0',
              padding: '0 0 0 22px',
              listStyle: b.kind === 'ol' ? 'decimal' : 'disc',
            }}>
              {b.items.map((it, j) => (
                <li key={j} style={{ margin: '2px 0' }}>{renderInline(it, `${i}-${j}-`)}</li>
              ))}
            </ListTag>
          );
        }
        return null;
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
