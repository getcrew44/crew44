import React from 'react';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionBounds(value, cursor) {
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor, query: match[2] || '' };
}

export function mentionDeleteBounds(value, cursor, agents) {
  const names = agents.map(a => a.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0 || cursor <= 0) return null;

  const before = value.slice(0, cursor);
  const mentionRe = new RegExp(`(^|\\s)@(${names.map(escapeRegExp).join('|')})\\s?$`);
  const match = before.match(mentionRe);
  if (!match) return null;

  const start = before.length - match[0].length + match[1].length;
  return { start, end: cursor };
}

export function MentionHighlightText({ text, agents }) {
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
