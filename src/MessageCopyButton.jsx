import React from 'react';
import { Icon, UI_FONT } from './components.jsx';

export function messageCopyText(text) {
  return String(text || '')
    .replace(/\{\{ref:([^}]+)\}\}/g, '@$1')
    .replace(/\{\{file:([^}]+)\}\}/g, '$1');
}

export function MessageCopyButton({ text, align = 'left', visible = true, compactSpace = false }) {
  const [copied, setCopied] = React.useState(false);
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
        marginBottom: compactSpace ? -28 : 0,
      }}
    >
      <button
        type="button"
        data-testid="message-copy-action"
        aria-label="Copy message"
        title={copied ? 'Copied' : 'Copy message'}
        onClick={copy}
        style={{
          width: 22,
          height: 22,
          padding: 0,
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: copied ? '#47773B' : '#807972',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: UI_FONT,
          opacity: visible || copied ? 1 : 0,
          pointerEvents: visible || copied ? 'auto' : 'none',
          transition: 'opacity .12s ease',
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </div>
  );
}
