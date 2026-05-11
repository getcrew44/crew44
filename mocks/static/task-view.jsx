// Task view — header, conversation timeline, subtasks, composer.

const UI_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

function Avatar({ agent, size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: agent.color, color: '#FCFBF7',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.45, fontWeight: 600, flexShrink: 0,
      letterSpacing: 0.2,
    }}>{agent.initial}</div>
  );
}

function MetaPill({ children, dot, dotColor }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px', borderRadius: 999,
      border: '1px solid #E6DFCC', background: '#FCFAF1',
      fontSize: 12, color: '#5C544B',
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor || '#C4644A' }} />}
      {children}
    </span>
  );
}

function TaskHeader({ task }) {
  return (
    <div style={{
      padding: '20px 36px 16px', borderBottom: '1px solid #ECE6D5',
      background: '#FAF5E8',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontSize: 12.5, color: '#A89F92', marginBottom: 6 }}>
        <span style={{ fontFamily: MONO_FONT, color: '#5C544B' }}>{task.id}</span>
        <span>·</span>
        <span>opened {task.openedAt} ago by {window.AGENTS[task.openedBy].name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <h1 style={{
          flex: 1, margin: 0, fontSize: 22, fontWeight: 600,
          color: '#1C1A17', letterSpacing: -0.2, lineHeight: 1.2,
        }}>{task.title}</h1>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button style={headerBtn} onClick={() => window.setTaskStatus(task.id, task.status === 'paused' ? 'running' : 'paused')}>
            {task.status === 'paused' ? 'Resume crew' : 'Pause crew'}
          </button>
          <button style={headerBtn}>Share…</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <MetaPill dot dotColor={task.status === 'running' ? '#C4644A' : '#9C8F77'}>
          <span style={{ color: '#1C1A17', fontWeight: 500 }}>{task.status}</span>
        </MetaPill>
        {task.meta.map((m, i) => {
          if (m.startsWith('lead · ')) {
            const a = window.AGENTS.aria;
            return <MetaPill key={i}><Avatar agent={a} size={14}/> {m}</MetaPill>;
          }
          return <MetaPill key={i}>{m}</MetaPill>;
        })}
      </div>
    </div>
  );
}

const headerBtn = {
  padding: '5px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #DCD3BC', background: '#FCFAF1', color: '#1C1A17',
  cursor: 'pointer', fontFamily: UI_FONT,
};

// Render inline markup tokens: {{file:path}} and {{ref:agentId}}
function RichText({ text }) {
  const parts = [];
  let last = 0;
  const re = /\{\{(file|ref):([^}]+)\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) });
    parts.push({ kind: m[1], value: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'file') return <code key={i} style={{
          fontFamily: MONO_FONT, fontSize: 12.5, color: '#C4644A',
          background: '#F7EFDD', padding: '1px 5px', borderRadius: 4,
        }}>{p.value}</code>;
        if (p.kind === 'ref') {
          const a = window.AGENTS[p.value]; if (!a) return p.value;
          return <span key={i} style={{ color: '#C4644A', fontWeight: 500 }}>@{a.name}</span>;
        }
        return <React.Fragment key={i}>{p.value}</React.Fragment>;
      })}
    </>
  );
}

function MessageEvent({ event, dim }) {
  const a = window.AGENTS[event.author];
  return (
    <div style={{ display: 'flex', gap: 14, padding: '14px 0', opacity: dim ? 0.85 : 1 }}>
      <Avatar agent={a} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{a.name}</span>
          <span style={{ color: '#A89F92', marginLeft: 8 }}>· {event.time}</span>
        </div>
        <div style={{ fontSize: 14, color: '#1C1A17', lineHeight: 1.55, textWrap: 'pretty' }}>
          <RichText text={event.body} />
        </div>
      </div>
    </div>
  );
}

function ThinkingEvent({ event }) {
  const a = window.AGENTS[event.author];
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={a} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{a.name}</span>
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 999,
            background: '#F7EFDD', color: '#C4644A', fontSize: 11.5, fontWeight: 500,
          }}>
            <svg width="11" height="11" viewBox="0 0 11 11"><circle cx="3" cy="5.5" r="1" fill="currentColor"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/><circle cx="8" cy="5.5" r="1" fill="currentColor"/></svg>
            thought {event.seconds}s
          </span>
        </div>
        <div onClick={() => setOpen(!open)} style={{
          fontSize: 13, color: '#807972', cursor: 'pointer', userSelect: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>›</span>
          {open ? 'Hide reasoning' : 'Show reasoning'}
        </div>
        {open && (
          <div style={{
            marginTop: 8, padding: '10px 14px', borderRadius: 8,
            background: '#FAF5E8', border: '1px solid #ECE6D5',
            fontSize: 13, color: '#5C544B', lineHeight: 1.55, fontStyle: 'italic',
          }}>{event.reasoning}</div>
        )}
      </div>
    </div>
  );
}

function ToolEvent({ event }) {
  const a = window.AGENTS[event.author];
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={a} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{a.name}</span>
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
          <span style={ToolBadge}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginRight: 3 }}><path d="M3 7l-1.5 1.5M6.5 3.5l1-1a1.4 1.4 0 0 1 2 2l-1 1M3 7l3.5-3.5 2 2L5 9 2 9.5 3 7z" stroke="currentColor" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {event.tool}
          </span>
        </div>
        <div style={{
          border: '1px solid #ECE6D5', borderRadius: 8, background: '#FCFAF1',
          padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: '#807972', display: 'flex' }}>
            <svg width="13" height="13" viewBox="0 0 13 13"><path d="M2.5 2h5l3 3v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M7.5 2v3h3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round"/></svg>
          </span>
          <code style={{ fontFamily: MONO_FONT, fontSize: 12.5, color: '#1C1A17', flex: 1 }}>{event.path}</code>
          <span style={{ fontSize: 12, color: '#6E9E5B', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {event.result}
          </span>
        </div>
        {event.detail && <div style={{
          padding: '4px 14px 0', fontSize: 12, color: '#807972',
          fontFamily: MONO_FONT,
        }}>{event.detail}</div>}
      </div>
    </div>
  );
}

const ToolBadge = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 999,
  background: '#F0EAD8', color: '#5C544B',
  fontSize: 11.5, fontWeight: 500, fontFamily: MONO_FONT,
};

function EditEvent({ event }) {
  const a = window.AGENTS[event.author];
  return (
    <div style={{ display: 'flex', gap: 14, padding: '10px 0' }}>
      <Avatar agent={a} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, color: '#1C1A17' }}>{a.name}</span>
          <span style={{ color: '#A89F92' }}>· {event.time}</span>
          <span style={ToolBadge}>
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginRight: 3 }}><path d="M5 2v6M2 5l3 3 3-3" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
            edit
          </span>
          <span style={{ ...DiffPill, color: '#3E7A4A', background: '#E8F1DE' }}>+ {event.added}</span>
          <span style={{ ...DiffPill, color: '#A33F2B', background: '#F5DDD4' }}>− {event.removed}</span>
        </div>
        <div style={{
          border: '1px solid #ECE6D5', borderRadius: 8, background: '#FCFAF1',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '8px 14px', fontFamily: MONO_FONT, fontSize: 12.5,
            color: '#5C544B', borderBottom: '1px solid #ECE6D5',
          }}>{event.path}</div>
          <div style={{ fontFamily: MONO_FONT, fontSize: 12.5, lineHeight: 1.6 }}>
            {event.diff.map((line, i) => (
              <div key={i} style={{
                padding: '1px 14px 1px 28px', position: 'relative',
                background: line.kind === 'add' ? '#E8F1DE' : line.kind === 'del' ? '#F5DDD4' : 'transparent',
                color: line.kind === 'add' ? '#1C1A17' : line.kind === 'del' ? '#1C1A17' : '#5C544B',
                whiteSpace: 'pre',
              }}>
                <span style={{
                  position: 'absolute', left: 12, color: line.kind === 'add' ? '#3E7A4A' : line.kind === 'del' ? '#A33F2B' : '#A89F92',
                }}>{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
                {line.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
const DiffPill = {
  display: 'inline-flex', alignItems: 'center',
  padding: '1px 8px', borderRadius: 999,
  fontSize: 11.5, fontWeight: 500, fontFamily: MONO_FONT,
};

function SubtaskBlock({ subtask }) {
  const [open, setOpen] = React.useState(true);
  const owner = window.AGENTS[subtask.owner];
  const statusDot = {
    running: '#C4644A',
    done: '#7A9C5F',
    queued: '#C9BFA8',
  }[subtask.status];
  return (
    <div style={{
      margin: '14px 0 4px',
      borderRadius: 10,
      background: '#FAF5E8',
      border: '1px solid #ECE6D5',
      overflow: 'hidden',
    }}>
      <div onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
      }}>
        <span style={{
          color: '#807972', transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s', display: 'flex',
        }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2L7 5 3.5 8" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
        <span style={{
          width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${statusDot}`,
          background: subtask.status === 'done' ? statusDot : 'transparent',
          position: 'relative', flexShrink: 0,
        }}>
          {subtask.status === 'running' && <span style={{
            position: 'absolute', inset: 3, borderRadius: '50%', background: statusDot,
          }}/>}
          {subtask.status === 'done' && (
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ position: 'absolute', inset: 1.5 }}>
              <path d="M2 5l2 2 4-4" stroke="#FCFBF7" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>
          <span style={{ color: '#A89F92', marginRight: 6, fontFamily: MONO_FONT, fontSize: 12.5 }}>
            {subtask.id.replace('st-', '')} ·
          </span>
          {subtask.title}
        </span>
        <div style={{ flex: 1 }} />
        <Avatar agent={owner} size={20} />
        <span style={{ fontSize: 12.5, color: '#5C544B' }}>{owner.name}</span>
      </div>
      {open && subtask.events.length > 0 && (
        <div style={{
          padding: '0 16px 12px', borderTop: '1px solid #ECE6D5',
          background: '#FCFAF1',
        }}>
          {subtask.events.map((e, i) => <EventRouter key={i} event={e} />)}
        </div>
      )}
      {open && subtask.events.length === 0 && (
        <div style={{
          padding: '14px 16px', borderTop: '1px solid #ECE6D5',
          background: '#FCFAF1', fontSize: 13, color: '#A89F92', fontStyle: 'italic',
        }}>Queued — will start when {owner.name} is free.</div>
      )}
    </div>
  );
}

function EventRouter({ event }) {
  if (event.kind === 'message')  return <MessageEvent event={event} />;
  if (event.kind === 'thinking') return <ThinkingEvent event={event} />;
  if (event.kind === 'tool')     return <ToolEvent event={event} />;
  if (event.kind === 'edit')     return <EditEvent event={event} />;
  if (event.kind === 'subtask')  return <SubtaskBlock subtask={event} />;
  return null;
}

function Composer({ taskId }) {
  const [val, setVal] = React.useState('');
  const ta = React.useRef(null);
  React.useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(160, ta.current.scrollHeight) + 'px';
  }, [val]);

  const send = () => {
    const text = val.trim();
    if (!text || !taskId) return;
    setVal('');
    const now = new Date();
    const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0');
    window.addEventToTask(taskId, { kind: 'message', author: 'jordan', time: timeStr, body: text });
    setTimeout(() => {
      const t2 = new Date();
      const ts2 = t2.getHours() + ':' + String(t2.getMinutes()).padStart(2, '0');
      window.addEventToTask(taskId, {
        kind: 'thinking', author: 'aria', time: ts2,
        seconds: Math.floor(Math.random() * 12) + 6,
        reasoning: 'Reviewing the latest direction from Jordan. Assessing which active subtask this touches and whether I need to re-route.',
      });
      setTimeout(() => {
        const t3 = new Date();
        const ts3 = t3.getHours() + ':' + String(t3.getMinutes()).padStart(2, '0');
        window.addEventToTask(taskId, {
          kind: 'message', author: 'aria', time: ts3,
          body: 'Got it — routing to the right agent and updating the subtask queue.',
        });
      }, 800);
    }, 1100);
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{
      borderTop: '1px solid #ECE6D5', background: '#FCFAF1',
      padding: '14px 36px 16px',
    }}>
      <div style={{
        border: '1px solid #DCD3BC', borderRadius: 12, background: '#FFFEF8',
        padding: '10px 12px 8px', boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
      }}>
        <textarea
          ref={ta}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Steer the crew — @agent to direct, ⌘↵ to send"
          rows={1}
          style={{
            width: '100%', border: 'none', outline: 'none', resize: 'none',
            background: 'transparent', fontFamily: UI_FONT, fontSize: 14,
            color: '#1C1A17', lineHeight: 1.5, padding: 4,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button style={chip}>@ @agent</button>
          <button style={chip}>Plan ▾</button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: '#A89F92' }}>⌘↵ send · ⇧⌘↵ plan only</span>
          <button onClick={send} style={{
            ...chip,
            background: val.trim() ? '#1C1A17' : '#F0EAD8',
            color: val.trim() ? '#FCFBF7' : '#A89F92',
            border: '1px solid ' + (val.trim() ? '#1C1A17' : '#E6DFCC'),
            fontWeight: 500,
          }}>↑ Send</button>
        </div>
      </div>
    </div>
  );
}
const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function TaskView({ task }) {
  const timelineRef = React.useRef(null);
  React.useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [task.events.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#FAF5E8' }}>
      <TaskHeader task={task} />
      <div ref={timelineRef} style={{ flex: 1, overflow: 'auto', padding: '8px 36px 16px' }}>
        <div style={{ maxWidth: 880 }}>
          {task.events.map((e, i) => <EventRouter key={i} event={e} />)}
        </div>
      </div>
      <Composer taskId={task.id} />
    </div>
  );
}

// Other route placeholders
function EmptyRoute({ icon, title, body }) {
  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#FAF5E8',
      color: '#5C544B', textAlign: 'center', padding: 40,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: '#F0EAD8', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#807972', marginBottom: 18,
      }}><window.Icon name={icon} size={26} /></div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: '#807972', maxWidth: 420, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

function NewTaskRoute({ onNewTask }) {
  const [val, setVal] = React.useState('');

  const startCrew = () => {
    const text = val.trim();
    if (!text || !onNewTask) return;
    const title = text.length > 55 ? text.slice(0, 52) + '…' : text;
    const id = window.createTask('crewai-desktop', title, text);
    setTimeout(() => {
      const t = new Date();
      const ts = t.getHours() + ':' + String(t.getMinutes()).padStart(2, '0');
      window.addEventToTask(id, {
        kind: 'thinking', author: 'aria', time: ts, seconds: 21,
        reasoning: "New task from Jordan. Reading the brief, identifying scope, decomposing into parallel subtasks, and choosing owners. I'll write the task card first.",
      });
      setTimeout(() => {
        const t2 = new Date();
        const ts2 = t2.getHours() + ':' + String(t2.getMinutes()).padStart(2, '0');
        window.addEventToTask(id, {
          kind: 'message', author: 'aria', time: ts2,
          body: "Task card written. I'm decomposing this into subtasks and routing them to the crew now.",
        });
      }, 1400);
    }, 900);
    onNewTask(id);
  };

  const suggestions = [
    { t: 'Audit a flow', b: 'Have Milo run a heuristic review and write up findings.',
      fill: 'Audit our main onboarding flow. Have Milo run a heuristic review and surface the top drop-off points with clear recommendations.' },
    { t: 'Refactor a component', b: 'Hand Nico a file and a constraint, get a PR back.',
      fill: 'Refactor the TaskHeader component. Nico should reduce prop drilling while keeping the same external API. One PR please.' },
    { t: 'Plan a release', b: 'Aria sequences subtasks, no code touched.',
      fill: 'Plan the next release. Aria should sequence all remaining work, identify blockers, and produce a clear timeline. No code changes yet.' },
    { t: 'Reproduce a bug', b: 'Rae writes a failing test before anyone fixes it.',
      fill: 'The composer sometimes submits twice on mobile. Rae should reproduce it and write a failing test before we touch the fix.' },
  ];

  return (
    <div style={{ height: '100%', background: '#FAF5E8', padding: '60px 36px', overflow: 'auto' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 12.5, color: '#A89F92', marginBottom: 6 }}>New task</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 24px', color: '#1C1A17', letterSpacing: -0.3 }}>
          What should the crew tackle?
        </h1>
        <div style={{
          border: '1px solid #DCD3BC', borderRadius: 14, background: '#FFFEF8',
          padding: 16, boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
        }}>
          <textarea
            value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startCrew(); } }}
            placeholder="Describe a task. The lead agent will plan it and assign subtasks."
            rows={5}
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'vertical',
              background: 'transparent', fontFamily: UI_FONT, fontSize: 15,
              color: '#1C1A17', lineHeight: 1.55, minHeight: 100,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingTop: 12, borderTop: '1px solid #ECE6D5' }}>
            <button style={chip}>Project ▾ crewai-desktop</button>
            <button style={chip}>Lead ▾ Aria</button>
            <button style={chip}>Plan only</button>
            <div style={{ flex: 1 }} />
            <button onClick={startCrew} style={{
              ...chip,
              background: val.trim() ? '#1C1A17' : '#F0EAD8',
              color: val.trim() ? '#FCFBF7' : '#A89F92',
              border: '1px solid ' + (val.trim() ? '#1C1A17' : '#E6DFCC'),
              fontWeight: 500, padding: '6px 14px',
            }}>Start crew →</button>
          </div>
        </div>
        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {suggestions.map((s, i) => (
            <div key={i} onClick={() => setVal(s.fill)} style={{
              padding: 14, borderRadius: 10, border: '1px solid #ECE6D5',
              background: '#FCFAF1', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#EBE5D6'}
            onMouseLeave={e => e.currentTarget.style.background = '#FCFAF1'}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17', marginBottom: 4 }}>{s.t}</div>
              <div style={{ fontSize: 12.5, color: '#807972', lineHeight: 1.5 }}>{s.b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentsRoute() {
  const agents = [
    { ...window.AGENTS.aria,  tasks: 4, idle: false },
    { ...window.AGENTS.nico,  tasks: 2, idle: false },
    { ...window.AGENTS.milo,  tasks: 1, idle: false },
    { ...window.AGENTS.rae,   tasks: 0, idle: true },
    { ...window.AGENTS.ox,    tasks: 0, idle: true },
  ];
  return (
    <div style={{ height: '100%', background: '#FAF5E8', padding: '32px 36px', overflow: 'auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17' }}>Agents</h1>
      <div style={{ fontSize: 13, color: '#807972', marginBottom: 24 }}>Your crew. Edit prompts, swap models, retire roles.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, maxWidth: 1000 }}>
        {agents.map(a => (
          <div key={a.id} style={{
            padding: 16, borderRadius: 12, border: '1px solid #ECE6D5', background: '#FCFAF1',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar agent={a} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: '#1C1A17' }}>{a.name}</div>
                <div style={{ fontSize: 12.5, color: '#807972' }}>{a.role}</div>
              </div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 999,
                background: a.idle ? '#F0EAD8' : '#F7EFDD',
                color: a.idle ? '#807972' : '#C4644A', fontWeight: 500,
              }}>{a.idle ? 'idle' : `${a.tasks} active`}</span>
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #ECE6D5', fontSize: 12.5, color: '#5C544B' }}>
              claude-sonnet-4-5 · 14 tools
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TaskView, EmptyRoute, NewTaskRoute, AgentsRoute });
