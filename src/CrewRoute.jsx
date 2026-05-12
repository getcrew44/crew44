import React from 'react';
import { Avatar, Icon, Toggle, ghostBtn, primaryBtn, card, MONO_FONT, UI_FONT } from './components.jsx';
import { relativeTime } from './utils.js';
import * as api from './api.js';

// ─── Atoms ────────────────────────────────────────────────────────────────────

function StatusDot({ on }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: on ? '#3E7A4A' : '#A89F92' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#5B9C5F' : '#C9BFA8' }} />
      {on ? 'online' : 'offline'}
    </span>
  );
}

function RuntimeBadge({ engine }) {
  const ch = (engine || '?')[0].toUpperCase();
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 6,
      background: '#F0EAD8', border: '1px solid #E6DFCC',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: MONO_FONT, fontSize: 11, fontWeight: 600, color: '#5C544B',
    }}>{ch}</span>
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

function SectionHeader({ icon, title, count, hint, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ color: '#807972', display: 'flex' }}><Icon name={icon} size={15} /></span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1C1A17' }}>{title}</span>
      {count != null && <span style={{ fontSize: 12.5, color: '#A89F92' }}>{count}</span>}
      {hint && <span style={{ fontSize: 12.5, color: '#807972' }}>{hint}</span>}
      <div style={{ flex: 1 }} />
      {action}
    </div>
  );
}

const tableHead = {
  display: 'grid', alignItems: 'center', padding: '8px 16px',
  fontSize: 11.5, fontWeight: 500, color: '#A89F92',
  textTransform: 'uppercase', letterSpacing: 0.4,
  borderBottom: '1px solid #ECE6D5',
};

const tableRow = {
  display: 'grid', alignItems: 'center', padding: '12px 16px',
  borderBottom: '1px solid #ECE6D5', fontSize: 13, color: '#1C1A17',
};

// ─── Runtimes ─────────────────────────────────────────────────────────────────

function RuntimesSection({ runtimes }) {
  const grid = '1.4fr 0.8fr 0.6fr 1fr 24px';
  const display = runtimes.length > 0 ? runtimes : [];

  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="auto" title="Runtimes" count={display.length}
        hint="· environments your agents run in"
        action={<button style={ghostBtn}>+ Add runtime</button>}
      />
      <div style={card}>
        <div style={{ ...tableHead, gridTemplateColumns: grid }}>
          <span>Runtime</span><span>Health</span><span>Agents</span><span>CLI version</span><span />
        </div>
        {display.length === 0 && (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            No runtimes detected. Make sure a runtime manifest is in the scan directory.
          </div>
        )}
        {display.map(r => (
          <div key={r.id} style={{ ...tableRow, gridTemplateColumns: grid }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <RuntimeBadge engine={r.provider || r.name} />
              <span style={{ fontWeight: 500 }}>{r.name || r.id}</span>
            </span>
            <StatusDot on={r.status === 'available'} />
            <span style={{ color: '#A89F92' }}>—</span>
            <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: '#5C544B' }}>{r.version || '—'}</span>
            <span style={{ color: '#A89F92', cursor: 'pointer', textAlign: 'right' }}>···</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Skills ───────────────────────────────────────────────────────────────────

function SkillsSection({ skills, agentsMap }) {
  const [filter, setFilter] = React.useState('all');
  const grid = '1.8fr 1fr 0.6fr 24px';

  const agentsArray = Object.values(agentsMap).filter(a => a.kind === 'agent');

  // Build usedBy for each skill from agent data
  const skillUsedBy = React.useMemo(() => {
    const map = {};
    agentsArray.forEach(agent => {
      (agent.skill_ids || []).forEach(sid => {
        if (!map[sid]) map[sid] = [];
        map[sid].push(agent);
      });
    });
    return map;
  }, [agentsArray]);

  const filtered = skills.filter(s => {
    const used = (skillUsedBy[s.id] || []).length > 0;
    if (filter === 'used') return used;
    if (filter === 'unused') return !used;
    return true;
  });

  return (
    <section style={{ marginBottom: 28 }}>
      <SectionHeader
        icon="new" title="Skills" count={skills.length}
        hint="· instructions any agent can pick up"
        action={
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'All'], ['used', 'In use'], ['unused', 'Unused']].map(([k, l]) => (
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
        <div style={{ ...tableHead, gridTemplateColumns: grid }}>
          <span>Name</span><span>Used by</span><span>Updated</span><span />
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
            No skills found.
          </div>
        )}
        {filtered.map(s => {
          const usedBy = skillUsedBy[s.id] || [];
          return (
            <div key={s.id} style={{ ...tableRow, gridTemplateColumns: grid, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAF5E8'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{s.name}</div>
              </span>
              <span>
                {usedBy.length === 0
                  ? <span style={{ color: '#A89F92', fontSize: 12.5 }}>— Unused</span>
                  : <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      {usedBy.map(a => (
                        <div key={a.id} title={a.name} style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: a.color, color: '#FCFBF7',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, fontWeight: 600,
                        }}>{a.initial}</div>
                      ))}
                      <span style={{ color: '#807972', fontSize: 12, marginLeft: 4 }}>{usedBy.length}</span>
                    </span>}
              </span>
              <span style={{ color: '#807972', fontSize: 12.5 }}>{relativeTime(s.updated_at)}</span>
              <span style={{ color: '#A89F92', textAlign: 'right' }}>›</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Agents grid ──────────────────────────────────────────────────────────────

function AgentsSection({ agents, runtimes, onPickAgent }) {
  const runtimeMap = Object.fromEntries(runtimes.map(r => [r.id, r]));

  return (
    <section>
      <SectionHeader
        icon="agents" title="Agents" count={agents.length}
        hint="· the crew"
        action={<button style={primaryBtn}>+ New agent</button>}
      />
      {agents.length === 0 && (
        <div style={{ fontSize: 13, color: '#A89F92', fontStyle: 'italic', padding: '8px 0' }}>
          No agents yet. Create one to get started.
        </div>
      )}
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
      }}>
        {agents.map(a => {
          const rt = runtimeMap[a.runtime_id];
          return (
            <div key={a.id}
              onClick={() => onPickAgent(a.id)}
              style={{ ...card, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#FAF5E8'}
              onMouseLeave={e => e.currentTarget.style.background = '#FCFAF1'}
            >
              <Avatar agent={a} size={36} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#1C1A17' }}>{a.name}</div>
                <div style={{ fontSize: 12.5, color: '#807972' }}>{a.model || 'No model set'}</div>
              </div>
              {rt && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: '#5C544B', padding: '3px 8px',
                  borderRadius: 6, background: '#F0EAD8', border: '1px solid #E6DFCC',
                }} title={rt.name}>
                  <RuntimeBadge engine={rt.provider || rt.name} />
                  <span style={{ fontFamily: MONO_FONT, fontSize: 11 }}>{(rt.name || rt.id).slice(0, 12)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Agent detail ─────────────────────────────────────────────────────────────

function AgentDetail({ agent, skills, agentsMap, onBack, onSave }) {
  const [tab, setTab] = React.useState('instructions');
  const [instruction, setInstruction] = React.useState(agent.instruction || '');
  const [saving, setSaving] = React.useState(false);

  const agentSkills = skills.filter(s => (agent.skill_ids || []).includes(s.id));
  const nonAgentSkills = skills.filter(s => !(agent.skill_ids || []).includes(s.id));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgent(agent.id, { ...agent, instruction });
      onSave?.();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSkill = async (skillId, on) => {
    const current = agent.skill_ids || [];
    const next = on ? [...current, skillId] : current.filter(id => id !== skillId);
    try {
      await api.replaceAgentSkills(agent.id, next);
      onSave?.();
    } catch (err) {
      console.error('Skill toggle failed:', err);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#FAF5E8' }}>
      {/* Breadcrumb */}
      <div style={{
        padding: '16px 36px 12px', borderBottom: '1px solid #ECE6D5',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
        WebkitAppRegion: 'drag',
      }}>
        <span onClick={onBack} style={{ color: '#807972', cursor: 'pointer', WebkitAppRegion: 'no-drag' }}>Agents</span>
        <span style={{ color: '#C9BFA8' }}>›</span>
        <span style={{ color: '#1C1A17', fontWeight: 500 }}>{agent.name}</span>
        <div style={{ flex: 1 }} />
        <button style={ghostBtn}>Archive</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px 36px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24, maxWidth: 1100 }}>
          {/* Left: identity */}
          <aside>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: agent.color, color: '#FCFBF7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, fontWeight: 600, marginBottom: 14,
            }}>{agent.initial}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: '#1C1A17' }}>{agent.name}</div>
            <div style={{ fontSize: 13, color: '#807972', marginBottom: 16 }}>{agent.model || 'No model'}</div>

            <div style={{ fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>Properties</div>
            <PropRow label="Model" value={<code style={{ fontFamily: MONO_FONT, fontSize: 12 }}>{agent.model || '—'}</code>} />
            <PropRow label="Runtime" value={agent.runtime_id || '—'} />
            <PropRow label="Created" value={relativeTime(agent.created_at) + ' ago'} />
            <PropRow label="Updated" value={relativeTime(agent.updated_at) + ' ago'} />

            <div style={{ marginTop: 20, fontSize: 11.5, color: '#A89F92', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 500, marginBottom: 8 }}>
              Skills <span style={{ color: '#807972' }}>{agentSkills.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {agentSkills.map(s => (
                <div key={s.id} style={{
                  padding: '6px 10px', borderRadius: 6, background: '#FCFAF1',
                  border: '1px solid #ECE6D5', fontSize: 12.5,
                }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 11, color: '#5C544B' }}>{s.name}</span>
                </div>
              ))}
              {agentSkills.length === 0 && (
                <div style={{ fontSize: 12.5, color: '#A89F92', fontStyle: 'italic' }}>No skills attached</div>
              )}
            </div>
          </aside>

          {/* Right: tabs */}
          <main>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ECE6D5', marginBottom: 18 }}>
              {[['instructions', 'Instructions'], ['skills', 'Skills']].map(([k, l]) => (
                <div key={k} onClick={() => setTab(k)} style={{
                  padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                  color: tab === k ? '#1C1A17' : '#807972',
                  fontWeight: tab === k ? 500 : 400,
                  borderBottom: '2px solid ' + (tab === k ? '#1C1A17' : 'transparent'),
                  marginBottom: -1,
                }}>{l}</div>
              ))}
            </div>

            {tab === 'instructions' && (
              <div style={{ ...card, padding: 0 }}>
                <div style={{ padding: '10px 16px', borderBottom: '1px solid #ECE6D5', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: '#807972' }}>system prompt</span>
                  <div style={{ flex: 1 }} />
                  <button style={ghostBtn} onClick={() => setInstruction(agent.instruction || '')}>Revert</button>
                  <button style={primaryBtn} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <textarea
                  value={instruction}
                  onChange={e => setInstruction(e.target.value)}
                  style={{
                    width: '100%', minHeight: 280, border: 'none', outline: 'none', resize: 'vertical',
                    padding: 16, background: 'transparent', fontFamily: MONO_FONT, fontSize: 12.5,
                    color: '#1C1A17', lineHeight: 1.6,
                  }}
                />
              </div>
            )}

            {tab === 'skills' && (
              <div style={card}>
                {skills.length === 0 && (
                  <div style={{ padding: '20px 16px', fontSize: 13, color: '#A89F92', fontStyle: 'italic' }}>
                    No skills available. Create some in the Skills tab.
                  </div>
                )}
                {skills.map(s => {
                  const on = (agent.skill_ids || []).includes(s.id);
                  return (
                    <div key={s.id} style={{
                      padding: '12px 16px', borderBottom: '1px solid #ECE6D5',
                      display: 'flex', alignItems: 'center', gap: 14,
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17' }}>{s.name}</div>
                      </div>
                      <Toggle on={on} onChange={(v) => handleToggleSkill(s.id, v)} />
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ─── Crew tabs ────────────────────────────────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

export default function CrewRoute({ agents, agentsMap, skills, runtimes, initialTab, onDataRefresh }) {
  const [tab, setTab] = React.useState(initialTab || 'agents');
  const [openAgentId, setOpenAgentId] = React.useState(null);

  React.useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const detail = openAgentId ? agents.find(a => a.id === openAgentId) : null;
  if (detail) return (
    <AgentDetail
      agent={detail}
      skills={skills}
      agentsMap={agentsMap}
      onBack={() => setOpenAgentId(null)}
      onSave={() => { setOpenAgentId(null); onDataRefresh?.(); }}
    />
  );

  const meta = CREW_TABS.find(t => t.key === tab);
  return (
    <div style={{ height: '100%', background: '#FAF5E8', overflow: 'auto', position: 'relative' }}>
      <div aria-hidden="true" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 38,
        WebkitAppRegion: 'drag',
      }} />
      <div style={{ padding: '28px 36px 40px', maxWidth: 1080 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px', color: '#1C1A17', letterSpacing: -0.2 }}>Crew</h1>
        <div style={{ fontSize: 13, color: '#807972', marginBottom: 18 }}>{meta?.subtitle}</div>
        <CrewTabs tab={tab} setTab={setTab} />
        {tab === 'agents'   && <AgentsSection agents={agents} runtimes={runtimes} onPickAgent={setOpenAgentId} />}
        {tab === 'skills'   && <SkillsSection skills={skills} agentsMap={agentsMap} />}
        {tab === 'runtimes' && <RuntimesSection runtimes={runtimes} />}
      </div>
    </div>
  );
}
