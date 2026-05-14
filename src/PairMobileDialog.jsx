import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createRemotePairing } from './api.js';
import { ghostBtn, primaryBtn, UI_FONT, MONO_FONT, Icon } from './components.jsx';

const LAST_RELAY_URL_KEY = 'crewai.lastRelayUrl';
export const DEFAULT_RELAY_URL = 'wss://relay.mindivelabs.com/relay';

function readLastRelayUrl() {
  try {
    return window.localStorage?.getItem(LAST_RELAY_URL_KEY) || DEFAULT_RELAY_URL;
  } catch {
    return DEFAULT_RELAY_URL;
  }
}

function writeLastRelayUrl(value) {
  try {
    window.localStorage?.setItem(LAST_RELAY_URL_KEY, value);
  } catch {
    // Local storage is only a convenience for the pair dialog.
  }
}

export default function PairMobileDialog({ onClose }) {
  const [relayUrl, setRelayUrl] = React.useState(readLastRelayUrl);
  const [pairing, setPairing] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const createPairing = React.useCallback(async () => {
    const trimmed = relayUrl.trim();
    if (!trimmed) {
      setError('Relay URL is required.');
      return;
    }
    setBusy(true);
    setError('');
    setPairing(null);
    try {
      const result = await createRemotePairing(trimmed);
      writeLastRelayUrl(trimmed);
      setPairing(result);
    } catch (err) {
      setError(err.message || 'Failed to create pairing.');
    } finally {
      setBusy(false);
    }
  }, [relayUrl]);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(28,26,23,0.28)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: UI_FONT,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pair-mobile-title"
        style={{
          width: 'min(420px, 100%)',
          background: '#FCFBF7',
          border: '1px solid #E6DFCC',
          borderRadius: 8,
          boxShadow: '0 20px 60px rgba(28,26,23,0.22)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: '#F0EAD8',
            color: '#5C544B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon name="phone" size={17} />
          </span>
          <div>
            <div id="pair-mobile-title" style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17' }}>
              Pair mobile device
            </div>
            <div style={{ fontSize: 12.5, color: '#807972', marginTop: 2 }}>
              Create a QR code for the Expo mobile app.
            </div>
          </div>
        </div>

        <label htmlFor="relay-url" style={{ display: 'block', fontSize: 12.5, color: '#5C544B', marginBottom: 6 }}>
          Relay WebSocket URL
        </label>
        <input
          id="relay-url"
          value={relayUrl}
          onChange={event => setRelayUrl(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') createPairing();
          }}
          placeholder={DEFAULT_RELAY_URL}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: '1px solid #D8CFB8',
            borderRadius: 6,
            background: '#FFFDF7',
            color: '#1C1A17',
            fontSize: 13,
            padding: '10px 11px',
            outline: 'none',
            marginBottom: 12,
          }}
        />

        {error && (
          <div role="alert" style={{ fontSize: 12.5, color: '#B8553E', marginBottom: 12 }}>
            {error}
          </div>
        )}

        {pairing?.qr_text && (
          <div data-testid="mobile-pair-qr" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            border: '1px solid #ECE6D5',
            borderRadius: 8,
            background: '#FFFEF8',
            marginBottom: 14,
          }}>
            <QRCodeSVG value={pairing.qr_text} size={216} level="M" includeMargin />
            <div style={{ fontFamily: MONO_FONT, color: '#807972', fontSize: 11.5 }}>
              Expires {pairing.offer?.expires_at ? new Date(pairing.offer.expires_at).toLocaleTimeString() : 'soon'}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
          <button
            type="button"
            data-testid="create-mobile-pairing"
            onClick={createPairing}
            disabled={busy}
            style={{
              ...primaryBtn,
              opacity: busy ? 0.65 : 1,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {busy ? 'Creating...' : pairing ? 'Refresh QR' : 'Create QR'}
          </button>
        </div>
      </div>
    </div>
  );
}
