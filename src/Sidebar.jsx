import React from 'react';
import { Icon } from './components.jsx';

function TrafficLights() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', height: 14 }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ED6A5E', border: '0.5px solid rgba(0,0,0,0.08)' }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#F5BF4F', border: '0.5px solid rgba(0,0,0,0.08)' }} />
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#61C554', border: '0.5px solid rgba(0,0,0,0.08)' }} />
    </div>
  );
}

function WindowChromeButtons() {
  const btn = {
    width: 22, height: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 5, color: '#807972', cursor: 'pointer',
    WebkitAppRegion: 'no-drag',
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto', WebkitAppRegion: 'no-drag' }}>
      <div style={btn} title="Toggle sidebar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1"/>
          <line x1="5.5" y1="2.5" x2="5.5" y2="11.5" stroke="currentColor" strokeWidth="1"/>
        </svg>
      </div>
      <div style={btn} title="Back">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div style={btn} title="Forward">
        <svg width="14" height="14" viewBox="0 0 14 14"><path d="M5.5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, testId }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', margin: '1px 8px',
        borderRadius: 7, fontSize: 14.5, color: '#1C1A17', fontWeight: 400,
        background: active ? '#EBE5D6' : hover ? '#EFE9DB' : 'transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{ color: '#5C544B', display: 'flex' }}><Icon name={icon} /></span>
      <span>{label}</span>
    </div>
  );
}

// Shared fixed-position tooltip (plain, no text-transform)
function FixedTooltip({ text, anchorRect }) {
  if (!anchorRect) return null;
  return (
    <div style={{
      position: 'fixed',
      top: anchorRect.top - 34,
      left: anchorRect.left + anchorRect.width / 2,
      transform: 'translateX(-50%)',
      background: 'rgba(28,26,23,0.88)', color: '#FCFBF7',
      fontSize: 12, fontWeight: 400, whiteSpace: 'nowrap',
      textTransform: 'none', letterSpacing: 0,
      padding: '5px 9px', borderRadius: 7,
      pointerEvents: 'none', zIndex: 9999,
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    }}>{text}</div>
  );
}

// Project row context menu
function ProjectMenu({ rect, onClose, onRename, onShowInFinder, onRemove }) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);

  const items = [
    {
      label: 'Rename',
      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 10.5l.8-3 6-6a1.2 1.2 0 0 1 1.7 1.7l-6 6-2.5.3z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      action: () => { onClose(); onRename?.(); },
    },
    {
      label: 'Show in Finder',
      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 3a1 1 0 0 1 1-1h2.8l1 1.5H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/><path d="M4.5 8l1.5-1.5 1.5 1.5 1.5-2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      action: () => { onClose(); onShowInFinder?.(); },
    },
    {
      label: 'Archive',
      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="2" width="10" height="2.5" rx="0.8" stroke="currentColor" strokeWidth="1"/><path d="M2.5 4.5v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5" stroke="currentColor" strokeWidth="1"/><path d="M5 7.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>,
      action: onClose,
    },
    { divider: true },
    {
      label: 'Remove',
      icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 3.5h9M5 3.5V2h3v1.5M3.5 3.5l.5 7h5l.5-7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      danger: true,
      action: () => { onClose(); onRemove?.(); },
    },
  ];

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      zIndex: 9999,
      background: '#FFFFFF', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.07)',
      padding: '4px', minWidth: 172,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    }}>
      {items.map((item, i) => item.divider ? (
        <div key={i} style={{ height: 1, background: '#ECE6D5', margin: '3px 0' }} />
      ) : (
        <MenuRow key={i} icon={item.icon} label={item.label} danger={item.danger} onClick={item.action} />
      ))}
    </div>
  );
}

function MenuRow({ icon, label, danger, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 7, cursor: 'default',
        background: hover ? (danger ? '#FEF3EE' : '#F4F0E8') : 'transparent',
        fontSize: 13, color: danger ? '#C4644A' : '#1C1A17',
        userSelect: 'none',
      }}
    >
      <span style={{ display: 'flex', flexShrink: 0, color: danger ? '#C4644A' : '#5C544B' }}>{icon}</span>
      {label}
    </div>
  );
}

function ProjectGroup({ project, openIds, currentChatId, onToggle, onPick, onNewChat, onRename, onShowInFinder, onRemove }) {
  const open = openIds.has(project.id);
  const [hover, setHover] = React.useState(false);
  const [newChatTooltipRect, setNewChatTooltipRect] = React.useState(null);
  const [menuRect, setMenuRect] = React.useState(null);
  const [renaming, setRenaming] = React.useState(false);
  const [renameVal, setRenameVal] = React.useState(project.name);
  const newChatBtnRef = React.useRef(null);
  const menuBtnRef = React.useRef(null);
  const renameInputRef = React.useRef(null);

  React.useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const commitRename = () => {
    const name = renameVal.trim();
    setRenaming(false);
    if (name && name !== project.name) onRename?.(project.id, name);
    else setRenameVal(project.name);
  };

  const rowBtn = {
    width: 20, height: 20, border: 'none', background: 'transparent',
    borderRadius: 4, color: '#807972', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, flexShrink: 0,
  };

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => { setHover(false); setNewChatTooltipRect(null); }}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', margin: '1px 8px' }}
      >
        {/* Main clickable row */}
        <div
          onClick={() => onToggle(project.id)}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
            userSelect: 'none', fontSize: 14, color: '#3A352E', fontWeight: 400,
            background: hover || menuRect ? '#EFE9DB' : 'transparent',
            transition: 'background 0.1s',
          }}
        >
          <span style={{
            color: '#807972', display: 'flex',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.15s',
          }}>
            <Icon name="chev" size={11} />
          </span>
          <span style={{ color: '#807972', display: 'flex' }}>
            <Icon name={open ? 'folder-open' : 'folder'} size={14} />
          </span>
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { setRenaming(false); setRenameVal(project.name); }
              }}
              onClick={e => e.stopPropagation()}
              style={{
                flex: 1, border: 'none', outline: '1.5px solid #C4644A',
                borderRadius: 4, background: '#FFFEF8',
                fontFamily: 'inherit', fontSize: 14, color: '#1C1A17',
                fontWeight: 400, padding: '1px 4px', minWidth: 0,
              }}
            />
          ) : (
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {project.name}
            </span>
          )}
        </div>

        {/* Hover action buttons */}
        <div style={{
          position: 'absolute', right: 6,
          display: 'flex', alignItems: 'center', gap: 1,
          opacity: hover || menuRect ? 1 : 0, transition: 'opacity 0.1s',
          pointerEvents: hover || menuRect ? 'auto' : 'none',
        }}>
          {/* More options */}
          <button
            ref={menuBtnRef}
            style={{ ...rowBtn, color: menuRect ? '#1C1A17' : '#807972' }}
            onClick={(e) => {
              e.stopPropagation();
              if (menuRect) { setMenuRect(null); return; }
              const r = menuBtnRef.current?.getBoundingClientRect();
              if (r) setMenuRect(r);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="2.5" cy="6.5" r="1" fill="currentColor"/>
              <circle cx="6.5" cy="6.5" r="1" fill="currentColor"/>
              <circle cx="10.5" cy="6.5" r="1" fill="currentColor"/>
            </svg>
          </button>

          {/* New chat in this project */}
          <button
            ref={newChatBtnRef}
            style={rowBtn}
            onMouseEnter={() => {
              const r = newChatBtnRef.current?.getBoundingClientRect();
              if (r) setNewChatTooltipRect(r);
            }}
            onMouseLeave={() => setNewChatTooltipRect(null)}
            onClick={(e) => { e.stopPropagation(); onNewChat?.(project.id); }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 10.5L2.8 7.5l6-6a1.2 1.2 0 0 1 1.7 1.7l-6 6-2.5.8z"
                stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8.5 2.5l1.7 1.7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Tooltip — centered above button */}
      <FixedTooltip text={`Start new chat in ${project.name}`} anchorRect={newChatTooltipRect} />

      {/* Context menu */}
      {menuRect && (
        <ProjectMenu
          rect={menuRect}
          onClose={() => setMenuRect(null)}
          onRename={() => { setRenameVal(project.name); setRenaming(true); }}
          onShowInFinder={() => onShowInFinder?.(project.workdir)}
          onRemove={() => onRemove?.(project.id)}
        />
      )}


      {open && (
        <div>
          {project.sessions.map(s => (
            <SessionItem
              key={s.id}
              session={s}
              active={currentChatId === s.id}
              onPick={() => onPick(s.id)}
            />
          ))}
          {project.sessions.length === 0 && (
            <div style={{ padding: '4px 10px 4px 32px', fontSize: 13, color: '#A89F92', fontStyle: 'italic', margin: '1px 8px' }}>
              No chats yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionProgress({ title }) {
  return (
    <svg
      role="progressbar"
      aria-label={`${title} is waiting`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      style={{ flexShrink: 0, animation: 'sidebarProgressSpin 0.9s linear infinite' }}
    >
      <circle cx="7" cy="7" r="5" fill="none" stroke="rgba(196,100,74,0.22)" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="#C4644A"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="14 31.4"
      />
    </svg>
  );
}

function SessionItem({ session, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      data-testid={`chat-${session.id}`}
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px 5px 32px', margin: '1px 8px',
        borderRadius: 7, cursor: 'pointer', userSelect: 'none',
        fontSize: 14,
        background: active ? '#EBE5D6' : hover ? '#EFE9DB' : 'transparent',
        color: active ? '#1C1A17' : '#3A352E',
        fontWeight: 400,
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {session.title}
      </span>
      {session.age && (
        <span style={{ color: '#A89F92', fontSize: 12.5, flexShrink: 0 }}>{session.age}</span>
      )}
      {session.status === 'running' && (
        <SessionProgress title={session.title} />
      )}
    </div>
  );
}

const iconBtnStyle = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  borderRadius: 6, color: '#5C544B', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// Reusable fixed-position tooltip for sidebar header buttons
function HeadingTooltip({ text, anchorRef, visible }) {
  const [rect, setRect] = React.useState(null);
  React.useEffect(() => {
    if (visible && anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
    else setRect(null);
  }, [visible, anchorRef]);
  if (!visible || !rect) return null;
  return (
    <FixedTooltip text={text} anchorRect={rect} />
  );
}

function ProjectsHeading({ openIds, setOpenIds, projectIds, onNewBlank, onExistingFolder }) {
  const [hover, setHover] = React.useState(false);
  const [dropOpen, setDropOpen] = React.useState(false);
  const [tooltip, setTooltip] = React.useState(null); // 'toggle' | 'new' | null
  const dropBtnRef = React.useRef(null);
  const toggleBtnRef = React.useRef(null);
  const newBtnRef = React.useRef(null);

  const allOpen = projectIds.length > 0 && projectIds.every(id => openIds.has(id));

  const handleToggle = () => {
    if (allOpen) {
      setOpenIds(new Set());
    } else {
      setOpenIds(new Set(projectIds));
    }
  };

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!dropOpen) return;
    const close = (e) => {
      if (dropBtnRef.current && !dropBtnRef.current.contains(e.target)) setDropOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [dropOpen]);

  const iconBtn = {
    width: 20, height: 20, border: 'none', background: 'transparent',
    borderRadius: 4, color: '#A89F92', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    flexShrink: 0,
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setTooltip(null); }}
      style={{
        padding: '14px 10px 4px 18px', display: 'flex', alignItems: 'center',
        fontSize: 12, fontWeight: 500, color: '#A89F92',
        letterSpacing: 0.3, textTransform: 'uppercase',
      }}
    >
      <span>Projects</span>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto',
        opacity: hover || dropOpen ? 1 : 0, transition: 'opacity 0.1s',
      }}>
        {/* Collapse all / Restore toggle */}
        <button
          ref={toggleBtnRef}
          style={iconBtn}
          aria-label={allOpen ? 'Collapse all projects' : 'Expand all projects'}
          onClick={handleToggle}
          onMouseEnter={() => setTooltip('toggle')}
          onMouseLeave={() => setTooltip(null)}
        >
          {allOpen ? (
            // Compress: arrows pointing inward toward center
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M4.5 1.5v3h-3M7.5 1.5v3h3M4.5 10.5v-3h-3M7.5 10.5v-3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            // Expand: corner bracket arrows pointing outward
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 4.5v-3h3M10.5 4.5v-3h-3M1.5 7.5v3h3M10.5 7.5v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
        <HeadingTooltip
          text={allOpen ? 'Collapse all' : 'Expand all'}
          anchorRef={toggleBtnRef}
          visible={tooltip === 'toggle'}
        />

        {/* New project — with dropdown */}
        <div ref={dropBtnRef} style={{ position: 'relative' }}>
          <button
            ref={newBtnRef}
            style={{ ...iconBtn, color: dropOpen ? '#1C1A17' : '#A89F92' }}
            onClick={() => setDropOpen(v => !v)}
            onMouseEnter={() => setTooltip('new')}
            onMouseLeave={() => setTooltip(null)}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1.5 3a1 1 0 0 1 1-1h2.5l1 1.5H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
              <path d="M6.5 5.5v3M5 7h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
          <HeadingTooltip
            text="New project"
            anchorRef={newBtnRef}
            visible={tooltip === 'new' && !dropOpen}
          />
          {dropOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 100,
              background: '#FFFFFF', borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.14), 0 0 0 0.5px rgba(0,0,0,0.08)',
              padding: '4px', minWidth: 178,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
            }}>
              <DropItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1.5 3.5a1 1 0 0 1 1-1h3l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                    <path d="M7 6v3.5M5.25 7.75h3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                }
                label="New blank project"
                onClick={() => { setDropOpen(false); onNewBlank?.(); }}
              />
              <DropItem
                icon={
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M1.5 3.5a1 1 0 0 1 1-1h3l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V5M1.5 9l2.5-2.5 2 2 3-3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                }
                label="Use existing folder"
                onClick={() => { setDropOpen(false); onExistingFolder?.(); }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DropItem({ icon, label, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 7, cursor: 'default',
        background: hover ? '#F0EAD8' : 'transparent',
        fontSize: 13, color: '#1C1A17', userSelect: 'none',
        textTransform: 'none', letterSpacing: 0, fontWeight: 400,
      }}
    >
      <span style={{ color: '#5C544B', display: 'flex', flexShrink: 0 }}>{icon}</span>
      {label}
    </div>
  );
}

export default function Sidebar({ projects, currentChatId, route, setRoute, onPick, deskName, backendOnline, onNewProject, onNewChat, onRenameProject, onShowInFinder, onCreateProject, onRemoveProject, onResetOnboarding }) {
  const [openIds, setOpenIds] = React.useState(() => new Set(projects.map(p => p.id)));
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [newProjectName, setNewProjectName] = React.useState('');
  const newProjectInputRef = React.useRef(null);
  const knownProjectIds = React.useRef(new Set(projects.map(p => p.id)));
  const activeChatId = route === 'task' ? currentChatId : null;

  // Auto-open newly added projects
  React.useEffect(() => {
    const incoming = projects.filter(p => !knownProjectIds.current.has(p.id));
    if (incoming.length > 0) {
      setOpenIds(prev => new Set([...prev, ...incoming.map(p => p.id)]));
    }
    // Seed on first load if set is empty
    if (knownProjectIds.current.size === 0 && projects.length > 0) {
      setOpenIds(new Set(projects.map(p => p.id)));
    }
    knownProjectIds.current = new Set(projects.map(p => p.id));
  }, [projects]);

  // Focus the new-project input when it appears
  React.useEffect(() => {
    if (creatingProject) newProjectInputRef.current?.focus();
  }, [creatingProject]);

  const commitNewProject = () => {
    const name = newProjectName.trim();
    setCreatingProject(false);
    setNewProjectName('');
    if (name) onCreateProject?.(name);
  };

  const toggle = (id) => setOpenIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div style={{
      width: 264, height: '100%', background: '#F4EFE0',
      borderRight: '1px solid #E6DFCC',
      display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
      flexShrink: 0,
    }}>
      {/* Window chrome */}
      <div style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        padding: '0 14px',
        flexShrink: 0,
        WebkitAppRegion: 'drag',
      }}>
        <TrafficLights />
        <WindowChromeButtons />
      </div>

      {/* Function nav */}
      <div style={{ padding: '2px 0' }}>
        <NavItem icon="new"    label="New Task"          active={route === 'new'}    onClick={() => setRoute('new')} testId="nav-new-task" />
        <NavItem icon="search" label="Search"            active={route === 'search'} onClick={() => setRoute('search')} testId="nav-search" />
        <NavItem icon="agents" label="Agents"
          active={route === 'agents' || route === 'skills' || route === 'runtimes'}
          onClick={() => setRoute('agents')}
          testId="nav-agents"
        />
        <NavItem icon="auto"   label="Auto optimization" active={route === 'auto'}   onClick={() => setRoute('auto')} testId="nav-auto" />
      </div>

      {/* Projects heading */}
      <ProjectsHeading
        openIds={openIds}
        setOpenIds={setOpenIds}
        projectIds={projects.map(p => p.id)}
        onNewBlank={() => setCreatingProject(true)}
        onExistingFolder={() => onNewProject?.('folder')}
      />

      {/* Project list */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 8 }}>
        {/* Inline new-project input */}
        {creatingProject && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '1px 8px', padding: '5px 10px' }}>
            <span style={{ color: '#807972', display: 'flex' }}><Icon name="folder" size={14} /></span>
            <input
              ref={newProjectInputRef}
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onBlur={commitNewProject}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitNewProject(); }
                if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName(''); }
              }}
              placeholder="Project name"
              style={{
                flex: 1, border: 'none', outline: '1.5px solid #C4644A',
                borderRadius: 4, background: '#FFFEF8',
                fontFamily: 'inherit', fontSize: 14, color: '#1C1A17',
                fontWeight: 400, padding: '2px 5px', minWidth: 0,
              }}
            />
          </div>
        )}
        {projects.length === 0 && !creatingProject ? (
          <div style={{ padding: '8px 18px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            {backendOnline ? 'No projects yet' : 'Backend offline'}
          </div>
        ) : (
          projects.map(p => (
            <ProjectGroup
              key={p.id}
              project={p}
              openIds={openIds}
              currentChatId={activeChatId}
              onToggle={toggle}
              onPick={(sid) => { onPick(sid); setRoute('task'); }}
              onNewChat={onNewChat}
              onRename={onRenameProject}
              onShowInFinder={onShowInFinder}
              onRemove={onRemoveProject}
            />
          ))
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        height: 44, borderTop: '1px solid #E6DFCC',
        display: 'flex', alignItems: 'center', padding: '0 14px',
        gap: 4, flexShrink: 0, background: '#F0EAD8',
      }}>
        <button style={iconBtnStyle} title="Settings"><Icon name="gear" /></button>
        <span style={{
          flex: 1, fontSize: 14, color: '#5C544B', fontWeight: 400,
          textAlign: 'center', letterSpacing: 0.1,
        }}>{deskName || 'CrewAI Desktop'}</span>
        <button style={iconBtnStyle} title="Mobile app"><Icon name="phone" /></button>
        <button
          style={iconBtnStyle}
          title="Restart onboarding"
          onClick={onResetOnboarding}
        ><Icon name="reset" /></button>
      </div>
      <style>{`@keyframes sidebarProgressSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
