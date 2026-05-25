import React from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const UI_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

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

const TABLE_WRAP_STYLE = {
  overflowX: 'auto',
  margin: '8px 0',
};

const TABLE_STYLE = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
  lineHeight: 1.45,
  color: '#1C1A17',
};

const CELL_STYLE = {
  border: '1px solid #ECE6D5',
  padding: '6px 8px',
  verticalAlign: 'top',
};

function renderSearchHighlights(text, searchQuery, keyPrefix, getSearchMatchIndex, activeSearchMatchIndex) {
  if (!searchQuery) return text;
  const needle = searchQuery.toLowerCase();
  if (!needle) return text;

  const lower = text.toLowerCase();
  const parts = [];
  let cursor = 0;
  let match = lower.indexOf(needle, cursor);
  while (match !== -1) {
    if (match > cursor) parts.push(text.slice(cursor, match));
    const value = text.slice(match, match + searchQuery.length);
    const index = getSearchMatchIndex?.() ?? 0;
    const active = index === activeSearchMatchIndex;
    parts.push(
      <mark
        key={`${keyPrefix}match-${index}-${match}`}
        data-testid="conversation-search-match"
        data-conversation-search-active={active ? 'true' : undefined}
        style={{
          background: active ? '#1C1A17' : '#F4CF56',
          color: active ? '#FCFBF7' : '#1C1A17',
          borderRadius: 3,
          padding: '0 1px',
        }}
      >
        {value}
      </mark>
    );
    cursor = match + searchQuery.length;
    match = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function pushTextToken(tokens, text) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text') last.value += text;
  else tokens.push({ kind: 'text', value: text });
}

function tokenizeInline(text) {
  const tokens = [];
  let plainStart = 0;
  let i = 0;

  const flushPlain = (end) => {
    pushTextToken(tokens, text.slice(plainStart, end));
    plainStart = end;
  };

  while (i < text.length) {
    if (text.startsWith('{{file:', i) || text.startsWith('{{ref:', i)) {
      const close = text.indexOf('}}', i + 2);
      if (close !== -1) {
        flushPlain(i);
        const raw = text.slice(i + 2, close);
        const sep = raw.indexOf(':');
        tokens.push({ kind: raw.slice(0, sep), value: raw.slice(sep + 1) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text.startsWith('**', i)) {
      const close = text.indexOf('**', i + 2);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: 'bold', value: text.slice(i + 2, close) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: 'code', value: text.slice(i + 1, close) });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    if (text.startsWith('\\(', i)) {
      const close = text.indexOf('\\)', i + 2);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: 'math', value: text.slice(i + 2, close), displayMode: false });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === '$' && text[i + 1] !== '$') {
      const close = text.indexOf('$', i + 1);
      const value = close === -1 ? '' : text.slice(i + 1, close);
      if (close !== -1 && value && value.trim() === value) {
        flushPlain(i);
        tokens.push({ kind: 'math', value, displayMode: false });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === '*') {
      const close = text.indexOf('*', i + 1);
      const value = close === -1 ? '' : text.slice(i + 1, close);
      if (close !== -1 && value && !value.includes('\n')) {
        flushPlain(i);
        tokens.push({ kind: 'italic', value });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    i += 1;
  }

  pushTextToken(tokens, text.slice(plainStart));
  return tokens;
}

function MathNode({ value, displayMode = false }) {
  const html = katex.renderToString(value, {
    displayMode,
    throwOnError: false,
    strict: 'ignore',
    trust: false,
  });
  const Tag = displayMode ? 'div' : 'span';
  return (
    <Tag
      className={displayMode ? 'cw-math-block' : 'cw-math-inline'}
      aria-label={value}
      style={displayMode ? { margin: '8px 0', overflowX: 'auto' } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderInline(text, keyPrefix = '', searchQuery = '', getSearchMatchIndex, activeSearchMatchIndex = 0) {
  if (!text) return null;

  return tokenizeInline(text).map((p, i) => {
    const key = keyPrefix + i;
    if (p.kind === 'file') return (
      <code key={key} style={{
        fontFamily: MONO_FONT, fontSize: 12.5, color: '#C4644A',
        background: '#F7EFDD', padding: '1px 5px', borderRadius: 4,
      }}>{renderSearchHighlights(p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}</code>
    );
    if (p.kind === 'code') return (
      <code key={key} style={{
        fontFamily: MONO_FONT, fontSize: 12.5, color: '#1C1A17',
        background: '#ECE6D5', padding: '1px 5px', borderRadius: 4,
      }}>{renderSearchHighlights(p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}</code>
    );
    if (p.kind === 'bold') return (
      <strong key={key} style={{ fontWeight: 600, color: '#1C1A17' }}>
        {renderSearchHighlights(p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}
      </strong>
    );
    if (p.kind === 'italic') return (
      <em key={key} style={{ fontStyle: 'italic' }}>
        {renderSearchHighlights(p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}
      </em>
    );
    if (p.kind === 'math') return <MathNode key={key} value={p.value} displayMode={p.displayMode} />;
    if (p.kind === 'ref') return (
      <span key={key} style={{ color: '#C4644A', fontWeight: 500 }}>
        {renderSearchHighlights('@' + p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}
      </span>
    );
    return <React.Fragment key={key}>{renderSearchHighlights(p.value, searchQuery, `${key}-`, getSearchMatchIndex, activeSearchMatchIndex)}</React.Fragment>;
  });
}

function CodeBlock({ lines, margin, searchQuery = '', getSearchMatchIndex, activeSearchMatchIndex = 0 }) {
  const [copied, setCopied] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const text = lines.join('\n');
  const copy = React.useCallback(() => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [text]);
  return (
    <div
      style={{ position: 'relative', margin }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <pre style={CODE_BLOCK_STYLE}>
        {lines.map((line, index) => (
          <React.Fragment key={index}>
            {index > 0 && '\n'}
            {renderSearchHighlights(line, searchQuery, `code-${index}-`, getSearchMatchIndex, activeSearchMatchIndex)}
          </React.Fragment>
        ))}
      </pre>
      {(hovered || copied) && (
        <button
          type="button"
          onClick={copy}
          style={{
            position: 'absolute', top: 6, right: 6,
            padding: '2px 8px', borderRadius: 4,
            background: copied ? '#6E9E5B' : 'rgba(244,239,224,0.95)',
            color: copied ? '#FCFBF7' : '#5C544B',
            border: '1px solid ' + (copied ? '#6E9E5B' : '#DCD3BC'),
            cursor: 'pointer',
            fontFamily: UI_FONT, fontSize: 11, fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}

function splitTableRow(line) {
  let value = line.trim();
  if (!value.includes('|')) return null;
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|')) value = value.slice(0, -1);

  const cells = [];
  let cell = '';
  let escaped = false;
  let inCode = false;
  for (const char of value) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '`') inCode = !inCode;
    if (char === '|' && !inCode) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimiterRow(line) {
  const cells = splitTableRow(line);
  if (!cells || cells.length < 1) return null;
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    alignments.push(left && right ? 'center' : right ? 'right' : left ? 'left' : undefined);
  }
  return alignments;
}

function parseTableAt(lines, start) {
  const header = splitTableRow(lines[start]);
  if (!header || !lines[start + 1]) return null;
  const alignments = parseDelimiterRow(lines[start + 1]);
  if (!alignments || alignments.length !== header.length) return null;

  const rows = [];
  let index = start + 2;
  while (index < lines.length) {
    const raw = lines[index].replace(/\s+$/, '');
    if (!raw.trim() || !raw.includes('|')) break;
    const row = splitTableRow(raw);
    if (!row) break;
    rows.push(header.map((_, cellIndex) => row[cellIndex] || ''));
    index += 1;
  }

  return { block: { kind: 'table', header, alignments, rows }, nextIndex: index };
}

function renderTable(block, key, searchQuery, getSearchMatchIndex, activeSearchMatchIndex) {
  return (
    <div key={key} style={TABLE_WRAP_STYLE}>
      <table style={TABLE_STYLE}>
        <thead>
          <tr>
            {block.header.map((cell, cellIndex) => (
              <th
                key={cellIndex}
                style={{
                  ...CELL_STYLE,
                  textAlign: block.alignments[cellIndex] || 'left',
                  background: '#F7EFDD',
                  fontWeight: 600,
                }}
              >
                {renderInline(cell, `${key}-h-${cellIndex}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{
                    ...CELL_STYLE,
                    textAlign: block.alignments[cellIndex] || 'left',
                    background: rowIndex % 2 === 0 ? '#FCFBF7' : '#FAF5E8',
                  }}
                >
                  {renderInline(cell, `${key}-${rowIndex}-${cellIndex}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderParagraphLines(lines, keyPrefix, searchQuery, getSearchMatchIndex, activeSearchMatchIndex) {
  return lines.map((line, idx) => (
    <React.Fragment key={`${keyPrefix}${idx}`}>
      {idx > 0 && <br />}
      {renderInline(line, `${keyPrefix}${idx}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}
    </React.Fragment>
  ));
}

// Block renderer: paragraphs (single-newline preserves a soft break), fenced
// code blocks, lists, headings, rules, GFM-style pipe tables, and KaTeX math.
export function RichText({ text, searchQuery = '', getSearchMatchIndex, activeSearchMatchIndex = 0 }) {
  if (!text) return null;
  const lines = text.split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  let fence = null;
  let mathBlock = null;

  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', lines: para }); para = []; } };
  const flushList = () => { if (list && list.items.length) { blocks.push(list); list = null; } };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
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

    if (mathBlock) {
      if (raw.trim() === mathBlock.end) {
        blocks.push({ kind: 'math', displayMode: true, value: mathBlock.lines.join('\n') });
        mathBlock = null;
      } else {
        mathBlock.lines.push(raw);
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
    const singleLineDollarMath = line.match(/^\s*\$\$\s*(\S[\s\S]*?)\s*\$\$\s*$/);
    const singleLineBracketMath = line.match(/^\s*\\\[\s*(\S[\s\S]*?)\s*\\\]\s*$/);
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bullet = /^\s*[-*]\s+/.test(line);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    const hr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    const table = parseTableAt(lines, index);

    if (singleLineDollarMath || singleLineBracketMath) {
      flushPara();
      flushList();
      blocks.push({ kind: 'math', displayMode: true, value: singleLineDollarMath?.[1] || singleLineBracketMath?.[1] || '' });
    } else if (line.trim() === '$$' || line.trim() === '\\[') {
      flushPara();
      flushList();
      mathBlock = { end: line.trim() === '$$' ? '$$' : '\\]', lines: [] };
    } else if (table) {
      flushPara();
      flushList();
      blocks.push(table.block);
      index = table.nextIndex - 1;
    } else if (heading) {
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
  if (mathBlock) blocks.push({ kind: 'math', displayMode: true, value: mathBlock.lines.join('\n') });
  flushPara();
  flushList();

  if (blocks.length === 1 && blocks[0].kind === 'p') {
    return <>{renderParagraphLines(blocks[0].lines, '', searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}</>;
  }

  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          const Tag = `h${Math.min(b.level + 1, 6)}`;
          const s = HEADING_STYLE[b.level] || HEADING_STYLE[4];
          return (
            <Tag key={i} style={{ ...s, color: '#1C1A17', marginTop: i === 0 ? 0 : s.margin.split(' ')[0] }}>
              {renderInline(b.text, `${i}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}
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
          <CodeBlock
            key={i}
            lines={b.lines}
            margin={i === 0 ? '0 0 8px' : '8px 0'}
            searchQuery={searchQuery}
            getSearchMatchIndex={getSearchMatchIndex}
            activeSearchMatchIndex={activeSearchMatchIndex}
          />
        );
        if (b.kind === 'math') return <MathNode key={i} value={b.value} displayMode={b.displayMode} />;
        if (b.kind === 'table') return renderTable(b, i, searchQuery, getSearchMatchIndex, activeSearchMatchIndex);
        if (b.kind === 'p') return (
          <p key={i} style={{ margin: i === 0 ? '0 0 8px' : '8px 0' }}>
            {renderParagraphLines(b.lines, `${i}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}
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
                <li key={j} style={{ margin: '2px 0' }}>{renderInline(it, `${i}-${j}-`, searchQuery, getSearchMatchIndex, activeSearchMatchIndex)}</li>
              ))}
            </ListTag>
          );
        }
        return null;
      })}
    </>
  );
}
