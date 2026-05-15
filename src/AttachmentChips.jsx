import React from 'react';
import { UI_FONT, MONO_FONT } from './components.jsx';
import { extensionForName } from './attachments.js';

const chipWrap = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 8,
};

const chipStyle = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  maxWidth: 190,
  minHeight: 52,
  padding: '7px 28px 7px 8px',
  border: '1px solid #E6DFCC',
  borderRadius: 10,
  background: '#FCFAF1',
  fontFamily: UI_FONT,
};

function FileGlyph({ failed = false }) {
  return (
    <span style={{
      width: 34, height: 34, borderRadius: 9,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: failed ? '#F9E8E2' : '#F1EBDC',
      color: failed ? '#C43D32' : '#807972',
      flexShrink: 0,
    }}>
      {failed ? (
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
          <path d="M4.5 2.5h5l3 3v9h-8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          <path d="M9.5 2.7v3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      )}
    </span>
  );
}

function AttachmentThumb({ attachment }) {
  if (attachment.kind === 'image' && attachment.thumbnail_jpeg_base64) {
    return (
      <img
        data-testid="attachment-thumbnail"
        src={`data:image/jpeg;base64,${attachment.thumbnail_jpeg_base64}`}
        alt=""
        style={{
          width: 34, height: 34, borderRadius: 9, objectFit: 'cover',
          background: '#F1EBDC', border: '1px solid #E6DFCC', flexShrink: 0,
        }}
      />
    );
  }
  return <FileGlyph failed={attachment.kind === 'image' && attachment.thumbnail_failed} />;
}

function AttachmentChip({ attachment, onRemove }) {
  const ext = extensionForName(attachment.display_name);
  return (
    <span data-testid="attachment-chip" style={chipStyle} title={attachment.path}>
      <AttachmentThumb attachment={attachment} />
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 13, color: '#1C1A17', fontWeight: 500,
        }}>
          {attachment.display_name}
        </span>
        <span style={{
          display: 'block', marginTop: 1, fontFamily: MONO_FONT,
          fontSize: 10.5, color: '#807972', textTransform: 'uppercase',
        }}>
          {ext || attachment.kind}
        </span>
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${attachment.display_name}`}
          onClick={onRemove}
          style={{
            position: 'absolute', top: -6, right: -6,
            width: 18, height: 18, borderRadius: 999, border: 'none',
            background: '#1C1A17', color: '#FCFBF7', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, fontSize: 12, lineHeight: 1,
          }}
        >
          x
        </button>
      )}
    </span>
  );
}

export function AttachmentTray({ attachments, onRemove }) {
  if (!attachments?.length) return null;
  return (
    <div data-testid="attachment-tray" style={chipWrap}>
      {attachments.map(attachment => (
        <AttachmentChip
          key={attachment.path}
          attachment={attachment}
          onRemove={onRemove ? () => onRemove(attachment.path) : null}
        />
      ))}
    </div>
  );
}
