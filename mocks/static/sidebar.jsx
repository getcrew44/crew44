// Sidebar — left rail with traffic lights, function nav, project tree, settings bar.

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
  // Sidebar toggle + back/forward arrows from the reference
  const btn = { width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, color: '#807972', cursor: 'pointer' };
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
      <div style={btn} title="Toggle sidebar">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1"/><line x1="5.5" y1="2.5" x2="5.5" y2="11.5" stroke="currentColor" strokeWidth="1"/></svg>
      </div>
      <div style={btn} title="Back"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M8.5 3L4.5 7l4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
      <div style={btn} title="Forward"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M5.5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
    </div>
  );
}

// Tiny line icons — handmade simple geometry only
function Icon({ name, size = 16 }) {
  const s = { width: size, height: size, style: { flexShrink: 0, display: 'block' } };
  const p = { stroke: 'currentColor', strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'new':
      return <svg {...s} viewBox="0 0 16 16"><path d="M3 12.5L4 8.5l7-7a1.4 1.4 0 0 1 2 2l-7 7-4 1z" {...p}/><path d="M10 2.5l2.5 2.5" {...p}/></svg>;
    case 'agents':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="4.5" cy="5" r="1.8" {...p}/><circle cx="11.5" cy="5" r="1.8" {...p}/><circle cx="4.5" cy="11" r="1.8" {...p}/><circle cx="11.5" cy="11" r="1.8" {...p}/></svg>;
    case 'auto':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" {...p}/><path d="M8 4v4l2.5 1.5" {...p}/></svg>;
    case 'search':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" {...p}/><path d="M10.5 10.5l3 3" {...p}/></svg>;
    case 'folder':
      return <svg {...s} viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.2 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z" {...p}/></svg>;
    case 'folder-open':
      return <svg {...s} viewBox="0 0 16 16"><path d="M2 4.5a1 1 0 0 1 1-1h3l1.2 1.5H13a1 1 0 0 1 1 1v.5M2 5v7a1 1 0 0 0 1 1h10l1.5-5.5a.5.5 0 0 0-.5-.6H3.5a.5.5 0 0 0-.5.4L2 12" {...p}/></svg>;
    case 'gear':
      return <svg {...s} viewBox="0 0 16 16"><circle cx="8" cy="8" r="2" {...p}/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" {...p}/></svg>;
    case 'phone':
      return <svg {...s} viewBox="0 0 16 16"><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" {...p}/><line x1="7" y1="12.5" x2="9" y2="12.5" {...p}/></svg>;
    case 'chev':
      return <svg {...s} viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" {...p}/></svg>;
    default: return null;
  }
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 10px', margin: '1px 8px',
      borderRadius: 7, fontSize: 13, color: '#1C1A17',
      background: active ? '#EBE5D6' : 'transparent',
      cursor: 'pointer', userSelect: 'none',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = '#EFE9DB'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ color: '#5C544B', display: 'flex' }}><Icon name={icon} /></span>
      <span style={{ fontWeight: active ? 500 : 400 }}>{label}</span>
    </div>
  );
}

function ProjectGroup({ project, openIds, currentId, onToggle, onPick }) {
  const open = openIds.has(project.id);
  return (
    <div style={{ marginBottom: 2 }}>
      <div onClick={() => onToggle(project.id)} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 10px', margin: '1px 8px',
        borderRadius: 7, cursor: 'pointer', userSelect: 'none',
        fontSize: 12.5, color: '#3A352E', fontWeight: 500,
      }}>
        <span style={{ color: '#807972', display: 'flex', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <Icon name="chev" size={11} />
        </span>
        <span style={{ color: '#807972', display: 'flex' }}><Icon name={open ? 'folder-open' : 'folder'} size={14} /></span>
        <span>{project.name}</span>
      </div>
      {open && (
        <div>
          {project.sessions.map(s => (
            <div key={s.id} onClick={() => onPick(s.id)} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 10px 5px 32px', margin: '1px 8px',
              borderRadius: 7, cursor: 'pointer', userSelect: 'none',
              fontSize: 12.5,
              background: currentId === s.id ? '#EBE5D6' : 'transparent',
              color: currentId === s.id ? '#1C1A17' : '#3A352E',
              fontWeight: currentId === s.id ? 500 : 400,
            }}
            onMouseEnter={(e) => { if (currentId !== s.id) e.currentTarget.style.background = '#EFE9DB'; }}
            onMouseLeave={(e) => { if (currentId !== s.id) e.currentTarget.style.background = 'transparent'; }}>
              <span style={{
                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{s.title}</span>
              <span style={{ color: '#A89F92', fontSize: 11, flexShrink: 0 }}>{s.age}</span>
              {s.status === 'running' && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C4644A', flexShrink: 0, boxShadow: '0 0 0 2px #FAF5E8' }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ currentId, onPick, route, setRoute, deskName }) {
  const [openIds, setOpenIds] = React.useState(() => new Set(['crewai-desktop', 'research-portal', 'prodlead-skills']));
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
    }}>
      {/* Window chrome row */}
      <div style={{
        height: 38, display: 'flex', alignItems: 'center',
        padding: '0 14px', flexShrink: 0,
      }}>
        <TrafficLights />
        <WindowChromeButtons />
      </div>

      {/* Function nav */}
      <div style={{ padding: '2px 0' }}>
        <NavItem icon="new"    label="New Task"          active={route === 'new'}    onClick={() => setRoute('new')} />
        <NavItem icon="search" label="Search"            active={route === 'search'} onClick={() => setRoute('search')} />
        <NavItem icon="agents" label="Agents"            active={route === 'agents' || route === 'skills' || route === 'runtimes'} onClick={() => setRoute('agents')} />
        <NavItem icon="auto"   label="Auto optimization" active={route === 'auto'}   onClick={() => setRoute('auto')} />
      </div>

      {/* Section heading */}
      <div style={{
        padding: '14px 18px 4px', fontSize: 11, fontWeight: 500,
        color: '#A89F92', letterSpacing: 0.3, textTransform: 'uppercase',
      }}>Projects</div>

      {/* Project list (scrolls) */}
      <div style={{ flex: 1, overflow: 'auto', paddingBottom: 8 }}>
        {window.PROJECTS.map(p => (
          <ProjectGroup
            key={p.id}
            project={p}
            openIds={openIds}
            currentId={currentId}
            onToggle={toggle}
            onPick={(sid) => { onPick(sid); setRoute('task'); }}
          />
        ))}
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
        }}>{deskName}</span>
        <button style={iconBtnStyle} title="Mobile app"><Icon name="phone" /></button>
      </div>
    </div>
  );
}

const iconBtnStyle = {
  width: 28, height: 28, border: 'none', background: 'transparent',
  borderRadius: 6, color: '#5C544B', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

Object.assign(window, { Sidebar, Icon });
