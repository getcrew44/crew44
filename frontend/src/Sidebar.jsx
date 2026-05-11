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
  };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
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

function NavItem({ icon, label, active, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', margin: '1px 8px',
        borderRadius: 7, fontSize: 13, color: '#1C1A17',
        background: active ? '#EBE5D6' : hover ? '#EFE9DB' : 'transparent',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{ color: '#5C544B', display: 'flex' }}><Icon name={icon} /></span>
      <span style={{ fontWeight: active ? 500 : 400 }}>{label}</span>
    </div>
  );
}

function ProjectGroup({ project, openIds, currentChatId, onToggle, onPick }) {
  const open = openIds.has(project.id);
  return (
    <div style={{ marginBottom: 2 }}>
      <div
        onClick={() => onToggle(project.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px', margin: '1px 8px',
          borderRadius: 7, cursor: 'pointer', userSelect: 'none',
          fontSize: 12.5, color: '#3A352E', fontWeight: 500,
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
        <span>{project.name}</span>
      </div>
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
            <div style={{ padding: '4px 10px 4px 32px', fontSize: 12, color: '#A89F92', fontStyle: 'italic', margin: '1px 8px' }}>
              No chats yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionItem({ session, active, onPick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onPick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px 5px 32px', margin: '1px 8px',
        borderRadius: 7, cursor: 'pointer', userSelect: 'none',
        fontSize: 12.5,
        background: active ? '#EBE5D6' : hover ? '#EFE9DB' : 'transparent',
        color: active ? '#1C1A17' : '#3A352E',
        fontWeight: active ? 500 : 400,
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {session.title}
      </span>
      {session.age && (
        <span style={{ color: '#A89F92', fontSize: 11, flexShrink: 0 }}>{session.age}</span>
      )}
      {session.status === 'running' && (
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#C4644A', flexShrink: 0,
          boxShadow: '0 0 0 2px #FAF5E8',
        }} />
      )}
    </div>
  );
}

const iconBtnStyle = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  borderRadius: 6, color: '#5C544B', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function ProjectsHeading({ onNewBlank, onExistingFolder }) {
  const [hover, setHover] = React.useState(false);
  const [dropOpen, setDropOpen] = React.useState(false);
  const btnRef = React.useRef(null);

  // Close dropdown on outside click
  React.useEffect(() => {
    if (!dropOpen) return;
    const close = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setDropOpen(false);
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
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '14px 10px 4px 18px', display: 'flex', alignItems: 'center',
        fontSize: 11, fontWeight: 500, color: '#A89F92',
        letterSpacing: 0.3, textTransform: 'uppercase',
      }}
    >
      <span>Projects</span>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, marginLeft: 'auto',
        opacity: hover || dropOpen ? 1 : 0, transition: 'opacity 0.1s',
      }}>
        {/* Expand all */}
        <button style={iconBtn} title="Expand all">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 4.5L6 1.5l4.5 3M1.5 7.5L6 10.5l4.5-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {/* Sort */}
        <button style={iconBtn} title="Sort">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 3.5h9M3 6h6M4.5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
        {/* New project — with dropdown */}
        <div ref={btnRef} style={{ position: 'relative' }}>
          <button
            style={{ ...iconBtn, color: dropOpen ? '#1C1A17' : '#A89F92' }}
            title="New project"
            onClick={() => setDropOpen(v => !v)}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M1.5 3a1 1 0 0 1 1-1h2.5l1 1.5H11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
              <path d="M6.5 5.5v3M5 7h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
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

export default function Sidebar({ projects, currentChatId, route, setRoute, onPick, deskName, backendOnline, onNewProject }) {
  const [openIds, setOpenIds] = React.useState(() => {
    const s = new Set();
    if (projects.length > 0) s.add(projects[0].id);
    return s;
  });

  // Auto-open first project when projects load
  React.useEffect(() => {
    if (projects.length > 0) {
      setOpenIds(prev => {
        if (prev.size === 0) return new Set([projects[0].id]);
        return prev;
      });
    }
  }, [projects]);

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
      <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 14px', flexShrink: 0 }}>
        <TrafficLights />
        <WindowChromeButtons />
      </div>

      {/* Function nav */}
      <div style={{ padding: '2px 0' }}>
        <NavItem icon="new"    label="New Task"          active={route === 'new'}    onClick={() => setRoute('new')} />
        <NavItem icon="search" label="Search"            active={route === 'search'} onClick={() => setRoute('search')} />
        <NavItem icon="agents" label="Agents"
          active={route === 'agents' || route === 'skills' || route === 'runtimes'}
          onClick={() => setRoute('agents')}
        />
        <NavItem icon="auto"   label="Auto optimization" active={route === 'auto'}   onClick={() => setRoute('auto')} />
      </div>

      {/* Projects heading */}
      <ProjectsHeading
        onNewBlank={() => onNewProject?.('blank')}
        onExistingFolder={() => onNewProject?.('folder')}
      />

      {/* Project list */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 8 }}>
        {projects.length === 0 ? (
          <div style={{ padding: '8px 18px', fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>
            {backendOnline ? 'No projects yet' : 'Backend offline'}
          </div>
        ) : (
          projects.map(p => (
            <ProjectGroup
              key={p.id}
              project={p}
              openIds={openIds}
              currentChatId={currentChatId}
              onToggle={toggle}
              onPick={(sid) => { onPick(sid); setRoute('task'); }}
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
          flex: 1, fontSize: 12.5, color: '#5C544B', fontWeight: 500,
          textAlign: 'center', letterSpacing: 0.1,
        }}>{deskName || 'CrewAI Desktop'}</span>
        <button style={iconBtnStyle} title="Mobile app"><Icon name="phone" /></button>
      </div>
    </div>
  );
}
