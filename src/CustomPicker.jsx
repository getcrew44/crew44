import React from 'react';
import { UI_FONT } from './components.jsx';

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

export function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
      <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function PickerRow({ icon, label, selected, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 8, cursor: 'default',
        background: selected ? '#EBE5D6' : hover ? '#F4F0E8' : 'transparent',
        fontSize: 13, color: '#1C1A17', userSelect: 'none',
      }}
    >
      {icon && <span style={{ color: '#807972', display: 'flex', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6l3 3 5-5" stroke="#1C1A17" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </div>
  );
}

export function CustomPicker({ icon, placeholder, value, items, onChange, footer, width = 240 }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const ref = React.useRef(null);
  const searchRef = React.useRef(null);

  const selected = items.find(i => i.id === value);

  React.useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  React.useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 30);
    else setSearch('');
  }, [open]);

  const filtered = items.filter(i =>
    !search || i.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          ...chip,
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: open ? '#EBE5D6' : '#FCFAF1',
          border: open ? '1px solid #DCD3BC' : '1px solid #E6DFCC',
          padding: '4px 8px 4px 9px',
          color: '#807972',
        }}
      >
        {icon}
        <span style={{ color: selected ? '#1C1A17' : '#5C544B' }}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: '#FFFFFF', borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
          width, fontFamily: UI_FONT, overflow: 'hidden',
        }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#F4F0E8', borderRadius: 8, padding: '6px 10px',
            }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="5.5" cy="5.5" r="4" stroke="#A89F92" strokeWidth="1.2"/>
                <path d="M9 9l2.5 2.5" stroke="#A89F92" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search"
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 13, color: '#1C1A17', width: '100%', fontFamily: UI_FONT,
                }}
              />
            </div>
          </div>

          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 6px' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '10px 10px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
                No results
              </div>
            )}
            {filtered.map(item => (
              <PickerRow
                key={item.id}
                icon={icon}
                label={item.label}
                selected={item.id === value}
                onClick={() => { onChange(item.id); setOpen(false); }}
              />
            ))}
          </div>

          {footer && (
            <div style={{ borderTop: '1px solid #ECE6D5', padding: '4px 6px 6px' }}>
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
