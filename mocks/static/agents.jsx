// Agents route — three minimal stacked sections (Runtimes, Skills, Agents)
// plus an agent-detail view. Same warm-parchment palette as the rest of the app.

const AGENTS_UI_FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
const AGENTS_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

// ─────────────────── Data ───────────────────
const RUNTIMES = [
  { id: 'claude-mbp', engine: 'Claude', host: 'mbp',          online: true,  agents: 3, workload: 'idle', cost: '$0.42', costTrend: '↓100%', cli: 'desktop v0.2.29' },
  { id: 'codex-mbp',  engine: 'Codex',  host: 'mbp',          online: true,  agents: 1, workload: 'idle', cost: null,    costTrend: null,    cli: 'desktop v0.2.29' },
  { id: 'claude-srv', engine: 'Claude', host: 'work-laptop',  online: false, agents: 0, workload: null,   cost: null,    costTrend: null,    cli: 'desktop v0.2.21' },
];

const SKILLS = [
  { id: 'doubao-tts',    name: 'doubao-tts',         desc: 'Synthesize voiceover via bash tts.sh wrapper.',           usedBy: ['milo'],                       source: 'manual', creator: 'jordan', updated: '16d' },
  { id: 'locale-video',  name: 'locale-videos',      desc: 'How to choose and prep assets for a locale promo video.', usedBy: ['milo', 'aria'],               source: 'manual', creator: 'jordan', updated: '13d' },
  { id: 'video-edit',    name: 'video-edit-compose', desc: 'Required reading for any video-editing task.',            usedBy: ['nico', 'milo', 'aria'],       source: 'manual', creator: 'jordan', updated: '13d' },
  { id: 'cron-fuzz',     name: 'cron-roundtrip',     desc: 'Property-based test scaffold for cron schedules.',        usedBy: ['rae'],                        source: 'imported', creator: 'ox', updated: '4d' },
  { id: 'test-skill',    name: 'test-skill',         desc: 'No description.',                                          usedBy: [],                             source: 'manual', creator: 'jordan', updated: '18d' },
];

// Extended agent config — derived from window.AGENTS
function getAgentConfigs() {
  const A = window.AGENTS;
  return [
    { ...A.aria, runtime: 'claude-mbp', model: 'claude-sonnet-4-5', visibility: 'Workspace', concurrency: 6, skills: ['locale-video', 'video-edit', 'doubao-tts'], owner: 'jordan', created: '34d', updated: '2h', active: 4, status: 'busy' },
    { ...A.nico, runtime: 'claude-mbp', model: 'claude-sonnet-4-5', visibility: 'Workspace', concurrency: 4, skills: ['video-edit'], owner: 'jordan', created: '34d', updated: '5m', active: 2, status: 'busy' },
    { ...A.milo, runtime: 'codex-mbp',  model: 'gpt-5-codex',       visibility: 'Workspace', concurrency: 2, skills: ['doubao-tts', 'locale-video', 'video-edit'], owner: 'jordan', created: '28d', updated: '4h', active: 1, status: 'busy' },
    { ...A.rae,  runtime: 'claude-mbp', model: 'claude-sonnet-4-5', visibility: 'Private',   concurrency: 4, skills: ['cron-fuzz'], owner: 'jordan', created: '21d', updated: '1d', active: 0, status: 'idle' },
    { ...A.ox,   runtime: 'claude-mbp', model: 'claude-sonnet-4-5', visibility: 'Workspace', concurrency: 2, skills: ['cron-fuzz', 'video-edit', 'doubao-tts', 'locale-video'], owner: 'jordan', created: '21d', updated: '3d', active: 0, status: 'idle' },
  ];
}

// ─────────────────── Atoms ───────────────────
function StatusDot({ on }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: on ? '#3E7A4A' : '#A89F92' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#5B9C5F' : '#C9BFA8' }} />
      {on ? 'online' : 'offline'}
    </span>
  );
}

function MiniAvatar({ agent, size = 18 }) {
  return (
    <div title={agent.name} style={{
      width: size, height: size, borderRadius: '50%',
      background: agent.color, color: '#FCFBF7',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.5, fontWeight: 600, flexShrink: 0,
    }}>{agent.initial}</div>
  );
}

function SectionHeader({ icon, title, count, hint, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ color: '#807972', display: 'flex' }}><window.Icon name={icon} size={15}/></span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17' }}>{title}</span>
      {count != null && <span style={{ fontSize: 12.5, color: '#A89F92' }}>{count}</span>}
      <span style={{ fontSize: 12.5, color: '#807972' }}>{hint}</span>
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

const tableHeadStyle = {
  display: 'grid', alignItems: 'center', padding: '8px 16px',
  fontSize: 11.5, fontWeight: 500, color: '#A89F92',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '1px solid #ECE6D5',
};

const tableRowStyle = {
  display: 'grid', alignItems: 'center', padding: '12px 16px',
  borderBottom: '1px solid #ECE6D5', fontSize: 13, color: '#1C1A17',
};

const card = {
  background: '#FCFAF1', border: '1px solid #ECE6D5',
  borderRadius: 10, overflow: 'hidden',
};

// ─────────────────── Runtimes section ───────────────────
function RuntimesSection() {
  const grid = '1.4fr 0.8fr 0.6fr 0.6fr 0.9fr 1fr 24px';
  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="auto" title="Runtimes" count={RUNTIMES.length}
        hint="· environments your agents run in"
        action={<button style={ghostBtn}>+ Add runtime</button>}
      />
      <div style={card}>
        <div style={{ ...tableHeadStyle, gridTemplateColumns: grid }}>
          <span>Runtime</span><span>Health</span><span>Agents</span><span>Workload</span><span>Cost · 7d</span><span>CLI</span><span/>
        </div>
        {RUNTIMES.map(r => (
          <div key={r.id} style={{ ...tableRowStyle, gridTemplateColumns: grid }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <RuntimeBadge engine={r.engine}/>
              <span style={{ fontWeight: 500 }}>{r.engine}</span>
              <span style={{ color: '#A89F92' }}>({r.host})</span>
            </span>
            <StatusDot on={r.online}/>
            <span style={{ color: r.agents > 0 ? '#1C1A17' : '#A89F92' }}>{r.agents > 0 ? r.agents : '—'}</span>
            <span style={{ color: r.workload ? '#5C544B' : '#A89F92' }}>{r.workload || '—'}</span>
            <span>
              {r.cost ? (
                <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.2 }}>
                  <span style={{ fontFamily: AGENTS_MONO, fontWeight: 500 }}>{r.cost}</span>
                  {r.costTrend && <span style={{ fontSize: 11, color: '#5B9C5F', fontFamily: AGENTS_MONO }}>{r.costTrend}</span>}
                </span>
              ) : <span style={{ color: '#A89F92' }}>—</span>}
            </span>
            <span style={{ fontFamily: AGENTS_MONO, fontSize: 12, color: '#5C544B' }}>{r.cli}</span>
            <span style={{ color: '#A89F92', cursor: 'pointer', textAlign: 'right' }}>···</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RuntimeBadge({ engine }) {
  // Tiny abstract glyph instead of a brand mark
  const ch = engine[0];
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 6,
      background: '#F0EAD8', border: '1px solid #E6DFCC',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: AGENTS_MONO, fontSize: 11, fontWeight: 600, color: '#5C544B',
    }}>{ch}</span>
  );
}

// ─────────────────── Skills section ───────────────────
function SkillsSection({ onPickSkill }) {
  const [filter, setFilter] = React.useState('all');
  const filtered = SKILLS.filter(s => {
    if (filter === 'used') return s.usedBy.length > 0;
    if (filter === 'unused') return s.usedBy.length === 0;
    return true;
  });
  const grid = '1.8fr 1fr 1fr 0.6fr 24px';
  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="new" title="Skills" count={SKILLS.length}
        hint="· instructions any agent can pick up"
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all','All'],['used','In use'],['unused','Unused']].map(([k,l]) => (
              <button key={k} onClick={() => setFilter(k)} style={{
                ...ghostBtn,
                background: filter === k ? '#EBE5D6' : '#FCFAF1',
                fontWeight: filter === k ? 500 : 400,
              }}>{l}</button>
            ))}
            <button style={primaryBtn}>+ New skill</button>
          </div>
        }
      />
      <div style={card}>
        <div style={{ ...tableHeadStyle, gridTemplateColumns: grid }}>
          <span>Name</span><span>Used by</span><span>Created by</span><span>Updated</span><span/>
        </div>
        {filtered.map(s => (
          <div key={s.id} onClick={() => onPickSkill && onPickSkill(s)} style={{
            ...tableRowStyle, gridTemplateColumns: grid, cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#FAF5E8'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: '#807972', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>{s.desc}</div>
            </span>
            <span>
              {s.usedBy.length === 0
                ? <span style={{ color: '#A89F92', fontSize: 12.5 }}>— Unused</span>
                : <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {s.usedBy.map(id => <MiniAvatar key={id} agent={window.AGENTS[id]} size={18}/>)}
                    <span style={{ color: '#807972', fontSize: 12, marginLeft: 4 }}>{s.usedBy.length}</span>
                  </span>}
            </span>
            <span style={{ color: '#5C544B', fontSize: 12.5 }}>
              <span style={{ fontFamily: AGENTS_MONO, fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#F0EAD8', marginRight: 6 }}>
                {s.source}
              </span>
              by {window.AGENTS[s.creator]?.name || s.creator}
            </span>
            <span style={{ color: '#807972', fontSize: 12.5 }}>{s.updated} ago</span>
            <span style={{ color: '#A89F92', textAlign: 'right' }}>›</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────── Agents section ───────────────────
function AgentsSection({ onPickAgent }) {
  const agents = getAgentConfigs();
  return (
    <section>
      <SectionHeader
        icon="agents" title="Agents" count={agents.length}
        hint="· the crew"
        action={<button style={primaryBtn}>+ New agent</button>}
      />
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      }}>
        {agents.map(a => {
          const rt = RUNTIMES.find(r => r.id === a.runtime);
          return (
            <div key={a.id} onClick={() => onPickAgent(a.id)} style={{
              ...card, padding: '14px 16px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#FAF5E8'}
            onMouseLeave={e => e.currentTarget.style.background = '#FCFAF1'}>
              <MiniAvatar agent={a} size={36}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1C1A17' }}>{a.name}</div>
                <div style={{ fontSize: 12.5, color: '#807972' }}>{a.role}</div>
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: '#5C544B',
                padding: '3px 8px', borderRadius: 6,
                background: '#F0EAD8', border: '1px solid #E6DFCC',
              }} title={`${rt.engine} (${rt.host})`}>
                <RuntimeBadge engine={rt.engine}/>
                <span style={{ fontFamily: AGENTS_MONO, fontSize: 11 }}>{rt.host}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────── Detail view ───────────────────
function AgentDetail({ agent, onBack }) {
  const [tab, setTab] = React.useState('activity');
  const rt = RUNTIMES.find(r => r.id === agent.runtime);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FAF5E8' }}>
      {/* Breadcrumb */}
      <div style={{
        padding: '16px 36px 12px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
      }}>
        <span onClick={onBack} style={{ color: '#807972', cursor: 'pointer' }}>Agents</span>
        <span style={{ color: '#C9BFA8' }}>›</span>
        <span style={{ color: '#1C1A17', fontWeight: 500 }}>{agent.name}</span>
        <div style={{ flex: 1 }}/>
        <button style={ghostBtn}>Duplicate</button>
        <button style={ghostBtn}>Retire</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 36px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, maxWidth: 1100 }}>

          {/* Left: identity + properties */}
          <aside>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: agent.color, color: '#FCFBF7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 600, marginBottom: 14,
            }}>{agent.initial}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17' }}>{agent.name}</div>
            <div style={{ fontSize: 13, color: '#807972', marginBottom: 10 }}>{agent.role}</div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500,
              background: agent.status === 'busy' ? '#F7EFDD' : '#F0EAD8',
              color: agent.status === 'busy' ? '#C4644A' : '#807972',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: agent.status === 'busy' ? '#C4644A' : '#A89F92' }}/>
              {agent.status === 'busy' ? `${agent.active} active task${agent.active === 1 ? '' : 's'}` : 'idle'}
            </span>

            <div style={{ marginTop: 22, fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>Properties</div>
            <PropRow label="Runtime" value={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <RuntimeBadge engine={rt.engine}/> {rt.engine} <span style={{ color: '#A89F92' }}>({rt.host})</span>
              </span>
            }/>
            <PropRow label="Model"        value={<code style={{ fontFamily: AGENTS_MONO, fontSize: 12 }}>{agent.model}</code>}/>
            <PropRow label="Visibility"   value={agent.visibility}/>
            <PropRow label="Concurrency"  value={`${agent.concurrency} parallel tasks`}/>
            <PropRow label="Owner"        value={window.AGENTS[agent.owner]?.name || agent.owner}/>
            <PropRow label="Created"      value={`${agent.created} ago`}/>
            <PropRow label="Updated"      value={`${agent.updated} ago`}/>

            <div style={{ marginTop: 22, fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>
              Skills <span style={{ color: '#807972' }}>{agent.skills.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {agent.skills.map(sid => {
                const s = SKILLS.find(x => x.id === sid);
                return (
                  <div key={sid} style={{
                    padding: '6px 10px', borderRadius: 6, background: '#FCFAF1',
                    border: '1px solid #ECE6D5', fontSize: 12.5,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <span style={{ fontFamily: AGENTS_MONO, fontSize: 11, color: '#5C544B' }}>{s.name}</span>
                  </div>
                );
              })}
              <button style={{
                padding: '5px 10px', borderRadius: 6, background: 'transparent',
                border: '1px dashed #DCD3BC', color: '#807972',
                fontSize: 12.5, cursor: 'pointer', textAlign: 'left',
              }}>+ Attach skill</button>
            </div>
          </aside>

          {/* Right: tabs */}
          <main>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ECE6D5', marginBottom: 18 }}>
              {[
                ['activity',  'Activity'],
                ['instr',     'Instructions'],
                ['skills',    'Skills'],
                ['env',       'Env vars'],
                ['params',    'Custom params'],
              ].map(([k,l]) => (
                <div key={k} onClick={() => setTab(k)} style={{
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                  color: tab === k ? '#1C1A17' : '#807972',
                  fontWeight: tab === k ? 500 : 400,
                  borderBottom: '2px solid ' + (tab === k ? '#1C1A17' : 'transparent'),
                  marginBottom: -1,
                }}>{l}</div>
              ))}
            </div>

            {tab === 'activity' && <ActivityTab agent={agent}/>}
            {tab === 'instr'    && <InstrTab agent={agent}/>}
            {tab === 'skills'   && <SkillsTab agent={agent}/>}
            {tab === 'env'      && <EnvTab/>}
            {tab === 'params'   && <ParamsTab/>}
          </main>
        </div>
      </div>
    </div>
  );
}

function PropRow({ label, value }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 8, padding: '5px 0', fontSize: 13 }}>
      <span style={{ color: '#807972' }}>{label}</span>
      <span style={{ color: '#1C1A17' }}>{value}</span>
    </div>
  );
}

function ActivityTab({ agent }) {
  return (
    <>
      <div style={{ ...card, padding: '14px 16px', marginBottom: 12 }}>
        <div style={{ fontSize: 12.5, color: '#A89F92', marginBottom: 4 }}>Current</div>
        {agent.active > 0 ? (
          <div style={{ fontSize: 13.5, color: '#1C1A17' }}>
            Running <strong>{agent.active}</strong> task{agent.active === 1 ? '' : 's'} — see the Projects rail to follow along.
          </div>
        ) : (
          <div style={{ fontSize: 13.5, color: '#807972', fontStyle: 'italic' }}>No task in flight.</div>
        )}
      </div>

      <div style={{ ...card, padding: '16px 18px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, color: '#A89F92' }}>Last 30 days</span>
          <span style={{ fontSize: 11.5, color: '#807972' }}>performance</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 600, color: '#1C1A17', lineHeight: 1 }}>14</div>
            <div style={{ fontSize: 12, color: '#807972' }}>runs</div>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#1C1A17' }}>92% success</div>
            <div style={{ fontSize: 12, color: '#807972', fontFamily: AGENTS_MONO }}>avg 1m 42s</div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 3, height: 38 }}>
            {[3,5,2,7,4,6,9,3,5,8,4,11,7,5,9,6,4,8,12,7,5,9,6,4,8,11,7,9,6,8].map((v, i) => (
              <div key={i} style={{
                flex: 1, height: `${v * 8}%`, background: '#C4644A', opacity: 0.6, borderRadius: 1,
              }}/>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...card }}>
        <div style={{ padding: '12px 16px', fontSize: 12.5, color: '#A89F92', borderBottom: '1px solid #ECE6D5' }}>Recent runs</div>
        {[
          { id: 't-114', title: 'Rework onboarding composer',    when: '2h',  dur: '1m 42s', ok: false, running: true },
          { id: 't-112', title: 'Redo autopilot scheduler page', when: '1d',  dur: '47s',    ok: true },
          { id: 't-109', title: 'Mobile-side implementation plan', when: '2d', dur: '3m 14s', ok: true },
        ].map(r => (
          <div key={r.id} style={{
            padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%',
              background: r.running ? 'transparent' : r.ok ? '#5B9C5F' : '#C4644A',
              border: r.running ? '1.5px solid #C4644A' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {!r.running && <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2 2 4-4" stroke="#FCFBF7" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <span style={{ fontFamily: AGENTS_MONO, fontSize: 12, color: '#5C544B' }}>{r.id}</span>
            <span style={{ flex: 1, color: '#1C1A17' }}>{r.title}</span>
            <span style={{ color: '#807972', fontSize: 12.5 }}>{r.when} ago</span>
            <span style={{ color: '#A89F92', fontSize: 12, fontFamily: AGENTS_MONO, width: 60, textAlign: 'right' }}>{r.dur}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function InstrTab({ agent }) {
  const sample = `You are ${agent.name}, the ${agent.role.toLowerCase()} on this crew.\n\n- Plan before acting. Write a short task card before opening any file.\n- Decompose into subtasks that can run in parallel; hand them off and don't block on yourself.\n- Surface blockers fast. If a sibling agent is closer to the answer, ping them by @name.\n- Touch the smallest possible diff. Leave a paragraph in the task explaining the change.`;
  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #ECE6D5', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: '#807972' }}>system prompt</span>
        <div style={{ flex: 1 }}/>
        <button style={ghostBtn}>Revert</button>
        <button style={primaryBtn}>Save</button>
      </div>
      <textarea defaultValue={sample} style={{
        width: '100%', minHeight: 280, border: 'none', outline: 'none', resize: 'vertical',
        padding: 16, background: 'transparent', fontFamily: AGENTS_MONO, fontSize: 12.5,
        color: '#1C1A17', lineHeight: 1.6, boxSizing: 'border-box',
      }}/>
    </div>
  );
}

function SkillsTab({ agent }) {
  return (
    <div style={{ ...card }}>
      {SKILLS.map(s => {
        const on = agent.skills.includes(s.id);
        return (
          <div key={s.id} style={{
            padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
            display: 'flex', alignItems: 'center', gap: 14,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>{s.name}</div>
              <div style={{ fontSize: 12, color: '#807972' }}>{s.desc}</div>
            </div>
            <Toggle on={on}/>
          </div>
        );
      })}
    </div>
  );
}

function EnvTab() {
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ fontSize: 12.5, color: '#807972', marginBottom: 12 }}>Variables loaded into every run.</div>
      {[
        ['OPENAI_API_KEY', '••••••••••••rk2c'],
        ['PROJECT_ROOT',   '/Users/jordan/code/crewai-desktop'],
        ['TZ',             'America/Los_Angeles'],
      ].map(([k,v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', gap: 8, padding: '6px 0', fontFamily: AGENTS_MONO, fontSize: 12.5 }}>
          <span style={{ color: '#5C544B' }}>{k}</span>
          <span style={{ color: '#1C1A17' }}>{v}</span>
          <button style={{ ...ghostBtn, padding: '2px 8px', fontSize: 11.5 }}>edit</button>
        </div>
      ))}
      <button style={{ ...ghostBtn, marginTop: 10 }}>+ Add variable</button>
    </div>
  );
}

function ParamsTab() {
  return (
    <div style={{ ...card, padding: 16, fontSize: 13, color: '#807972' }}>
      Temperature, top-p, retry policy, and any custom JSON the runtime understands. <span style={{ color: '#C4644A' }}>Defaults are sensible — leave this empty unless you know what you're tuning.</span>
    </div>
  );
}

function Toggle({ on }) {
  const [v, setV] = React.useState(on);
  React.useEffect(() => setV(on), [on]);
  return (
    <button onClick={() => setV(!v)} style={{
      width: 32, height: 18, borderRadius: 999, border: 'none', padding: 0,
      background: v ? '#1C1A17' : '#DCD3BC', cursor: 'pointer', position: 'relative',
      transition: 'background 0.15s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: v ? 16 : 2,
        width: 14, height: 14, borderRadius: '50%', background: '#FCFBF7',
        transition: 'left 0.15s',
      }}/>
    </button>
  );
}

// ─────────────────── Buttons ───────────────────
const ghostBtn = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: AGENTS_UI_FONT,
};
const primaryBtn = {
  padding: '4px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 500,
  border: '1px solid #1C1A17', background: '#1C1A17', color: '#FCFBF7',
  cursor: 'pointer', fontFamily: AGENTS_UI_FONT,
};

// ─────────────────── Routes ───────────────────
const CREW_TABS = [
  { key: 'agents',   label: 'Agents',   subtitle: 'Your crew. Pick one to edit instructions, attach skills, or tune the runtime.' },
  { key: 'skills',   label: 'Skills',   subtitle: 'Shared instructions any agent in this workspace can pick up.' },
  { key: 'runtimes', label: 'Runtimes', subtitle: 'The environments your agents run in. Add hosts, watch their health and spend.' },
];

function CrewTabs({ tab, setTab }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #ECE6D5', marginBottom: 22 }}>
      {CREW_TABS.map(t => (
        <div key={t.key} onClick={() => setTab(t.key)} style={{
          padding: '8px 14px', fontSize: 13, cursor: 'pointer',
          color: tab === t.key ? '#1C1A17' : '#807972',
          fontWeight: tab === t.key ? 500 : 400,
          borderBottom: '2px solid ' + (tab === t.key ? '#1C1A17' : 'transparent'),
          marginBottom: -1,
        }}>{t.label}</div>
      ))}
    </div>
  );
}

function AgentsRoute() {
  const [tab, setTab] = React.useState('agents');
  const [openAgent, setOpenAgent] = React.useState(null);
  const agents = getAgentConfigs();
  const detail = openAgent ? agents.find(a => a.id === openAgent) : null;
  if (detail) return <AgentDetail agent={detail} onBack={() => setOpenAgent(null)}/>;

  const meta = CREW_TABS.find(t => t.key === tab);
  return (
    <div style={{ height: '100%', background: '#FAF5E8', overflow: 'auto' }}>
      <div style={{ padding: '28px 36px 40px', maxWidth: 1080 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17', letterSpacing: -0.2 }}>Crew</h1>
        <div style={{ fontSize: 13, color: '#807972', marginBottom: 18 }}>{meta.subtitle}</div>
        <CrewTabs tab={tab} setTab={setTab}/>
        {tab === 'agents'   && <AgentsSection onPickAgent={setOpenAgent}/>}
        {tab === 'skills'   && <SkillsSection/>}
        {tab === 'runtimes' && <RuntimesSection/>}
      </div>
    </div>
  );
}

// Legacy aliases — sidebar routes agents/skills/runtimes all through AgentsRoute
const SkillsRoute = AgentsRoute;
const RuntimesRoute = AgentsRoute;

Object.assign(window, { AgentsRoute, SkillsRoute, RuntimesRoute });
