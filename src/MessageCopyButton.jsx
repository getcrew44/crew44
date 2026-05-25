import React from 'react';
import { UI_FONT } from './components.jsx';

export function messageCopyText(text) {
  return String(text || '')
    .replace(/\{\{ref:([^}]+)\}\}/g, '@$1')
    .replace(/\{\{file:([^}]+)\}\}/g, '$1');
}

export function MessageCopyButton({ text, align = 'left', visible = true, compactSpace = false }) {
  const [copied, setCopied] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const timeoutRef = React.useRef(null);
  const copyText = messageCopyText(text);

  React.useEffect(() => () => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  }, []);

  const copy = React.useCallback(() => {
    const clipboard = window.navigator?.clipboard;
    if (!copyText.trim() || !clipboard) return;
    clipboard.writeText(copyText).then(() => {
      setCopied(true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [copyText]);

  if (!copyText.trim()) return null;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        marginTop: 6,
        marginBottom: compactSpace ? -25 : 0,
      }}
    >
      <button
        type="button"
        data-testid="message-copy-action"
        aria-label={copied ? 'Copied' : 'Copy message'}
        onClick={copy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 8px',
          borderRadius: 5,
          border: '1px solid #ECE6D5',
          background: hovered ? '#FCFAF1' : 'transparent',
          color: '#807972',
          fontFamily: UI_FONT,
          fontSize: 11,
          lineHeight: 1,
          cursor: 'pointer',
          opacity: visible || copied ? 1 : 0,
          pointerEvents: visible || copied ? 'auto' : 'none',
          transition: 'opacity .12s ease, background .12s ease',
        }}
      >
        {copied ? (
          <>
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Copied</span>
          </>
        ) : (
          <>
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
              <path d="M2 7.5V2.5a.8.8 0 0 1 .8-.8H7.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="round" />
            </svg>
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}
