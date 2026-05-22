import React from 'react';
import { Icon, UI_FONT } from './components.jsx';

export function messageCopyText(text) {
  return String(text || '')
    .replace(/\{\{ref:([^}]+)\}\}/g, '@$1')
    .replace(/\{\{file:([^}]+)\}\}/g, '$1');
}

export function MessageCopyButton({ text, align = 'left' }) {
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
      }}
    >
      <button
        type="button"
        data-testid="message-copy-action"
        aria-label="Copy message"
        title={copied ? 'Copied' : 'Copy message'}
        onClick={copy}
        style={{
          width: 26,
          height: 26,
          padding: 0,
          borderRadius: 6,
          border: '1px solid ' + (copied ? '#6E9E5B' : '#E6DFCC'),
          background: copied ? '#EEF6E9' : 'transparent',
          color: copied ? '#47773B' : '#807972',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: UI_FONT,
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </div>
  );
}
