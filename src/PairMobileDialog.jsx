import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { createRemotePairing, deleteRemoteDevice } from './api.js';
import { ghostBtn, primaryBtn, UI_FONT, MONO_FONT, Icon } from './components.jsx';

export const DEFAULT_RELAY_URL = 'wss://relay.crew44.io/relay';

const iconButton = {
  width: 28,
  height: 28,
  border: '1px solid #E6DFCC',
  background: '#FCFAF1',
  color: '#5C544B',
  borderRadius: 6,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

function formatDate(value) {
  if (!value || String(value).startsWith('0001-01-01T00:00:00')) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function expiryState(pairing, now) {
  const expiresAt = pairing?.offer?.expires_at ? new Date(pairing.offer.expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
    return { expired: false, label: 'Expires soon' };
  }
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) return { expired: true, label: 'Expired' };
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return {
    expired: false,
    label: `Expires in ${remainingMinutes} min`,
  };
}

function ModalShell({ title, subtitle, onClose, children }) {
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
        aria-labelledby="mobile-dialog-title"
        style={{
          width: 'min(440px, 100%)',
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
            <div id="mobile-dialog-title" style={{ fontSize: 16, fontWeight: 650, color: '#1C1A17' }}>
              {title}
            </div>
            <div style={{ fontSize: 12.5, color: '#807972', marginTop: 2 }}>
              {subtitle}
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ManageMobileDialog({ devices = [], onClose, onChanged }) {
  const [items, setItems] = React.useState(devices);
  const [busyId, setBusyId] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    setItems(devices);
  }, [devices]);

  const unpair = async (deviceId) => {
    setBusyId(deviceId);
    setError('');
    try {
      await deleteRemoteDevice(deviceId);
      const nextItems = items.filter(device => device.device_id !== deviceId);
      setItems(nextItems);
      onChanged?.(nextItems);
    } catch (err) {
      setError(err.message || 'Failed to unpair device.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <ModalShell
      title="Manage mobile"
      subtitle="Paired devices that can connect through the relay."
      onClose={onClose}
    >
      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: '#B8553E', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {items.map(device => {
          const pairedAt = formatDate(device.created_at);
          const lastActive = formatDate(device.last_seen_at);
          return (
            <div
              key={device.device_id}
              data-testid="mobile-device-row"
              style={{
                border: '1px solid #ECE6D5',
                borderRadius: 8,
                background: '#FFFEF8',
                padding: 12,
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: '#1C1A17', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {device.name || 'Mobile device'}
                </div>
                {pairedAt && (
                  <div style={{ fontSize: 12, color: '#807972', marginTop: 4 }}>
                    Paired {pairedAt}
                  </div>
                )}
                {lastActive && (
                  <div style={{ fontSize: 12, color: '#807972', marginTop: 2 }}>
                    Last active {lastActive}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => unpair(device.device_id)}
                disabled={busyId === device.device_id}
                style={{
                  ...ghostBtn,
                  color: '#B8553E',
                  opacity: busyId === device.device_id ? 0.65 : 1,
                  cursor: busyId === device.device_id ? 'default' : 'pointer',
                }}
              >
                Unpair
              </button>
            </div>
          );
        })}
        {items.length === 0 && (
          <div style={{ border: '1px solid #ECE6D5', borderRadius: 8, background: '#FFFEF8', padding: 14, color: '#807972', fontSize: 13 }}>
            No mobile devices are paired.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
      </div>
    </ModalShell>
  );
}

export default function PairMobileDialog({ onClose, onChanged }) {
  const [relayUrl, setRelayUrl] = React.useState(DEFAULT_RELAY_URL);
  const [draftRelayUrl, setDraftRelayUrl] = React.useState(DEFAULT_RELAY_URL);
  const [editingRelay, setEditingRelay] = React.useState(false);
  const [pairing, setPairing] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => new Date());
  const createdRef = React.useRef(false);

  const createPairing = React.useCallback(async (url = relayUrl) => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Relay URL is required.');
      return;
    }
    setBusy(true);
    setError('');
    setPairing(null);
    try {
      const result = await createRemotePairing(trimmed);
      setRelayUrl(trimmed);
      setDraftRelayUrl(trimmed);
      setEditingRelay(false);
      setPairing(result);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Failed to create pairing.');
    } finally {
      setBusy(false);
    }
  }, [onChanged, relayUrl]);

  React.useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    createPairing(DEFAULT_RELAY_URL);
  }, [createPairing]);

  React.useEffect(() => {
    if (!pairing?.offer?.expires_at) return undefined;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [pairing?.offer?.expires_at]);

  const expiry = expiryState(pairing, now);

  return (
    <ModalShell
      title="Pair mobile device"
      subtitle="Scan the QR code from the Crew44 mobile app."
      onClose={onClose}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: '#5C544B', marginBottom: 6 }}>
          Relay URL
        </div>
        {editingRelay ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              aria-label="Relay URL"
              autoFocus
              value={draftRelayUrl}
              onChange={event => setDraftRelayUrl(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') createPairing(draftRelayUrl);
                if (event.key === 'Escape') {
                  setDraftRelayUrl(relayUrl);
                  setEditingRelay(false);
                }
              }}
              placeholder={DEFAULT_RELAY_URL}
              style={{
                flex: 1,
                minWidth: 0,
                border: '1px solid #D8CFB8',
                borderRadius: 6,
                background: '#FFFDF7',
                color: '#1C1A17',
                fontSize: 13,
                padding: '8px 10px',
                outline: 'none',
              }}
            />
            <button
              type="button"
              data-testid="create-mobile-pairing"
              onClick={() => createPairing(draftRelayUrl)}
              disabled={busy}
              style={{ ...primaryBtn, opacity: busy ? 0.65 : 1 }}
            >
              Update QR
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              flex: 1,
              minWidth: 0,
              fontFamily: MONO_FONT,
              fontSize: 12,
              color: '#5C544B',
              background: '#FFFEF8',
              border: '1px solid #ECE6D5',
              borderRadius: 6,
              padding: '8px 10px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {relayUrl}
            </div>
            <button
              type="button"
              aria-label="Edit relay URL"
              onClick={() => setEditingRelay(true)}
              style={iconButton}
            >
              <Icon name="edit" size={14} />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12.5, color: '#B8553E', marginBottom: 12 }}>
          {error}
        </div>
      )}

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
        minHeight: 276,
        justifyContent: 'center',
      }}>
        {pairing?.qr_text ? (
          <>
            <div style={{ position: 'relative', width: 216, height: 216 }}>
              <div style={{
                opacity: expiry.expired ? 0.28 : 1,
                filter: expiry.expired ? 'grayscale(1)' : 'none',
                transition: 'opacity 0.18s ease, filter 0.18s ease',
              }}>
                <QRCodeSVG value={pairing.qr_text} size={216} level="M" includeMargin />
              </div>
              {expiry.expired && (
                <button
                  type="button"
                  aria-label="Refresh expired QR"
                  onClick={() => createPairing(relayUrl)}
                  disabled={busy}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    margin: 'auto',
                    width: 54,
                    height: 54,
                    borderRadius: '50%',
                    border: '1px solid #D8CFB8',
                    background: 'rgba(252,251,247,0.94)',
                    color: '#1C1A17',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: busy ? 'default' : 'pointer',
                    boxShadow: '0 8px 24px rgba(28,26,23,0.16)',
                  }}
                >
                  <Icon name="reset" size={26} />
                </button>
              )}
            </div>
            <div style={{ fontFamily: MONO_FONT, color: '#807972', fontSize: 11.5 }}>
              {expiry.label}
            </div>
          </>
        ) : (
          <div style={{ color: '#807972', fontSize: 13 }}>
            {busy ? 'Creating QR...' : 'QR unavailable'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onClose} style={ghostBtn}>Close</button>
        <button
          type="button"
          onClick={() => createPairing(relayUrl)}
          disabled={busy}
          style={{
            ...primaryBtn,
            opacity: busy ? 0.65 : 1,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Creating...' : 'Refresh QR'}
        </button>
      </div>
    </ModalShell>
  );
}
