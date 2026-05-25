import React from 'react';
import { UI_FONT } from './components.jsx';
import { ChevronDown } from './CustomPicker.jsx';

export const SEND_SHORTCUT_MODES = {
  MOD_ENTER: 'mod-enter',
  ENTER: 'enter',
};

const STORAGE_KEY = 'crew44:send-shortcut-mode';

function isAppleKeyboardPlatform() {
  if (typeof window === 'undefined') return false;
  const platform = window.navigator?.userAgentData?.platform || window.navigator?.platform || '';
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform);
}

function shortcutCopy(isMac) {
  const modEnterLabel = isMac ? '⌘+Enter' : 'Ctrl+Enter';
  return {
    placeholderHint: `${modEnterLabel} to send`,
    options: [{
      id: SEND_SHORTCUT_MODES.MOD_ENTER,
      label: modEnterLabel,
      hint: 'Enter inserts a newline',
      indicator: `${modEnterLabel} send`,
    }, {
      id: SEND_SHORTCUT_MODES.ENTER,
      label: 'Enter',
      hint: 'Shift or Option Enter inserts a newline',
      indicator: 'Enter send',
    }],
  };
}

function normalizeMode(mode) {
  return mode === SEND_SHORTCUT_MODES.ENTER ? mode : SEND_SHORTCUT_MODES.MOD_ENTER;
}

function readStoredMode() {
  if (typeof window === 'undefined') return SEND_SHORTCUT_MODES.MOD_ENTER;
  return normalizeMode(window.localStorage?.getItem(STORAGE_KEY));
}

function writeStoredMode(mode) {
  if (typeof window === 'undefined') return;
  window.localStorage?.setItem(STORAGE_KEY, normalizeMode(mode));
}

export function useSendShortcutMode() {
  const [mode, setModeState] = React.useState(readStoredMode);

  const setMode = React.useCallback((nextMode) => {
    const normalized = normalizeMode(nextMode);
    writeStoredMode(normalized);
    setModeState(normalized);
  }, []);

  return [mode, setMode];
}

export function shouldSendFromEnterKey(event, mode) {
  if (event.key !== 'Enter') return false;
  if (event.isComposing || event.nativeEvent?.isComposing) return false;
  if (mode === SEND_SHORTCUT_MODES.ENTER) {
    return !event.shiftKey && !event.altKey;
  }
  return event.metaKey || event.ctrlKey;
}

export function shortcutPlaceholderHint(mode) {
  if (mode === SEND_SHORTCUT_MODES.ENTER) return 'Enter to send';
  return shortcutCopy(isAppleKeyboardPlatform()).placeholderHint;
}

const menuStyle = {
  position: 'absolute',
  right: 0,
  bottom: 'calc(100% + 6px)',
  zIndex: 210,
  width: 248,
  background: '#FFFFFF',
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
  padding: 6,
  fontFamily: UI_FONT,
};

function ShortcutOption({ option, selected, onSelect }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        border: 'none',
        background: hovered ? '#F4F0E8' : 'transparent',
        borderRadius: 8,
        padding: '8px 9px',
        color: '#1C1A17',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: UI_FONT,
        textAlign: 'left',
      }}
    >
      <span aria-hidden="true" style={{
        width: 14,
        color: selected ? '#1C1A17' : 'transparent',
        fontSize: 12,
        flexShrink: 0,
      }}>{selected ? '✓' : ''}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500 }}>{option.label}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 11.5, color: '#807972' }}>{option.hint}</span>
      </span>
    </button>
  );
}

export function SendShortcutMenu({ mode, onChange, align = 'right' }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const { options } = shortcutCopy(isAppleKeyboardPlatform());
  const selected = options.find(option => option.id === normalizeMode(mode)) || options[0];

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="send-shortcut-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose send shortcut"
        onClick={() => setOpen(value => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          border: '1px solid ' + (open ? '#DCD3BC' : '#E6DFCC'),
          background: open ? '#EBE5D6' : '#FCFAF1',
          color: '#807972',
          borderRadius: 6,
          padding: '4px 7px 4px 9px',
          fontSize: 11.5,
          fontFamily: UI_FONT,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{selected.indicator}</span>
        <ChevronDown />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Send shortcut"
          style={{
            ...menuStyle,
            ...(align === 'left' ? { left: 0, right: 'auto' } : { right: 0 }),
          }}
        >
          {options.map(option => (
            <ShortcutOption
              key={option.id}
              option={option}
              selected={option.id === selected.id}
              onSelect={() => {
                onChange(option.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
