import React from 'react';
import { UI_FONT } from './components.jsx';
import { CustomPicker, PickerRow } from './CustomPicker.jsx';
import * as api from './api.js';
import { mentionBounds, MentionHighlightText } from './composerMentions.jsx';
import {
  clearComposerDraft,
  readComposerDraft,
  readLastNewChatProjectId,
  writeComposerDraft,
  writeLastNewChatProjectId,
} from './draftStore.js';

const chip = {
  padding: '4px 10px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid #E6DFCC', background: '#FCFAF1', color: '#5C544B',
  cursor: 'pointer', fontFamily: UI_FONT,
};

function FolderIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 3.5a1 1 0 0 1 1-1h2.8l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
        stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
    </svg>
  );
}

function FolderAddIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <path d="M1.5 3.5a1 1 0 0 1 1-1h2.8l1 1.5H12a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
        stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
      <path d="M7 6.5v3M5.5 8h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

function AgentIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M2 12c0-2.2 2.2-4 5-4s5 1.8 5 4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

const SUGGESTIONS = [
  {
    t: 'Audit a flow',
    b: 'Have an agent run a heuristic review and write up findings.',
    fill: 'Audit our main onboarding flow. Run a heuristic review and surface the top drop-off points with clear recommendations.',
  },
  {
    t: 'Refactor a component',
    b: 'Hand an agent a file and a constraint, get a PR back.',
    fill: 'Refactor the TaskHeader component. Reduce prop drilling while keeping the same external API. One PR please.',
  },
  {
    t: 'Plan a release',
    b: 'Agent sequences subtasks, no code touched.',
    fill: 'Plan the next release. Sequence all remaining work, identify blockers, and produce a clear timeline. No code changes yet.',
  },
  {
    t: 'Reproduce a bug',
    b: 'Write a failing test before fixing anything.',
    fill: 'The composer sometimes submits twice on mobile. Reproduce it and write a failing test before we touch the fix.',
  },
];

export default function NewTaskRoute({ projects, agents, onNewTask, onExistingFolder, initialProjectId }) {
  const initialStoredProjectId = React.useMemo(() => initialProjectId || readLastNewChatProjectId(), [initialProjectId]);
  const initialDraft = React.useMemo(() => readComposerDraft(initialStoredProjectId, ''), [initialStoredProjectId]);
  const [val, setVal] = React.useState(initialDraft.text || '');
  const [cursor, setCursor] = React.useState(0);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const [selectedProjectId, setSelectedProjectId] = React.useState(initialStoredProjectId || '');
  const [selectedAgentId, setSelectedAgentId] = React.useState(initialDraft.targetAgentId || '');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const inputRef = React.useRef(null);
  const selectedProjectExists = projects.some(project => project.id === selectedProjectId);

  // Apply initialProjectId when it changes (e.g. clicking new chat on a project)
  React.useEffect(() => {
    if (initialProjectId) setSelectedProjectId(initialProjectId);
  }, [initialProjectId]);

  React.useEffect(() => {
    if (!selectedProjectId || projects.length === 0 || selectedProjectExists) return;
    setSelectedProjectId('');
    writeLastNewChatProjectId('');
  }, [projects.length, selectedProjectExists, selectedProjectId]);

  React.useEffect(() => {
    const draft = readComposerDraft(selectedProjectId, '');
    setVal(current => draft.text || current);
    setSelectedAgentId(draft.targetAgentId || '');
    if (selectedProjectExists) writeLastNewChatProjectId(selectedProjectId);
    else if (!selectedProjectId) writeLastNewChatProjectId('');
  }, [selectedProjectExists, selectedProjectId]);

  React.useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  React.useEffect(() => {
    writeComposerDraft(selectedProjectId, '', {
      text: val,
      targetAgentId: selectedAgentId,
      targetProjectId: selectedProjectId,
    });
  }, [selectedProjectId, selectedAgentId, val]);

  const projectItems = projects.map(p => ({ id: p.id, label: p.name }));
  const agentItems = agents.map(a => ({ id: a.id, label: a.name }));
  const activeMention = React.useMemo(() => mentionBounds(val, cursor), [val, cursor]);
  const mentionOptions = React.useMemo(() => {
    if (!activeMention) return [];
    const q = activeMention.query.toLowerCase();
    return agents.filter(agent => agent.name.toLowerCase().includes(q)).slice(0, 6);
  }, [activeMention, agents]);

  React.useEffect(() => {
    setActiveSuggestion(0);
  }, [activeMention?.query]);

  const updateCursor = (node) => {
    setCursor(node?.selectionStart ?? val.length);
  };

  const selectMention = (agent) => {
    if (!activeMention) return;
    const next = `${val.slice(0, activeMention.start)}@${agent.name} ${val.slice(activeMention.end)}`;
    const nextCursor = activeMention.start + agent.name.length + 2;
    setVal(next);
    setCursor(nextCursor);
    window.requestAnimationFrame?.(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const startCrew = async () => {
    const text = val.trim();
    if (!text || submitting) return;

    const projectId = selectedProjectExists ? selectedProjectId : '';
    const agentId = selectedAgentId || agents[0]?.id;

    if (!projectId || !agentId) {
      setError('Select a project and ensure at least one agent exists.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const title = text.length > 55 ? text.slice(0, 52) + '…' : text;
      const chat = await api.createChat(projectId, title, agentId);
      await api.postMessage(chat.id, text, chat.main_agent_id);
      clearComposerDraft(projectId, '');
      onNewTask(chat.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const onKeyDown = (e) => {
    if (mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion(i => (i + 1) % mentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion(i => (i - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(mentionOptions[activeSuggestion] || mentionOptions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCursor(-1);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); startCrew(); }
  };

  const canStart = val.trim() && !submitting && selectedProjectExists && selectedAgentId;

  return (
    <div style={{ height: '100%', background: '#FAF5E8', padding: '60px 36px', overflow: 'auto', position: 'relative' }}>
      <div aria-hidden="true" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 38,
        WebkitAppRegion: 'drag',
      }} />
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ fontSize: 12.5, color: '#A89F92', marginBottom: 6 }}>New task</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: '0 0 24px', color: '#1C1A17', letterSpacing: -0.3 }}>
          What should the crew tackle?
        </h1>

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: '#FEF3EE', border: '1px solid #F5DDD4', fontSize: 13, color: '#C4644A' }}>
            {error}
          </div>
        )}

        <div style={{
          border: '1px solid #DCD3BC', borderRadius: 14, background: '#FFFEF8',
          padding: 16, boxShadow: '0 1px 0 rgba(0,0,0,0.02)',
        }}>
          <div style={{ position: 'relative' }}>
            {mentionOptions.length > 0 && (
              <div
                role="listbox"
                aria-label="Agent suggestions"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 'calc(100% + 8px)',
                  zIndex: 5,
                  background: '#FFFEF8',
                  border: '1px solid #DCD3BC',
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(28,26,23,0.14)',
                  padding: 4,
                }}
              >
                {mentionOptions.map((agent, index) => (
                  <div
                    key={agent.id}
                    role="option"
                    aria-selected={index === activeSuggestion}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectMention(agent)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 9px', borderRadius: 7,
                      cursor: 'pointer',
                      background: index === activeSuggestion ? '#EFE9DB' : 'transparent',
                      color: '#1C1A17', fontSize: 13,
                    }}
                  >
                    <AgentIcon size={14} />
                    <span style={{ fontWeight: 500 }}>{agent.name}</span>
                  </div>
                ))}
              </div>
            )}
            {val && (
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  fontFamily: UI_FONT,
                  fontSize: 15,
                  lineHeight: 1.55,
                  minHeight: 100,
                  color: '#1C1A17',
                }}
              >
                <MentionHighlightText text={val} agents={agents} />
              </div>
            )}
            <textarea
              data-testid="new-task-input"
              ref={inputRef}
              value={val}
              onChange={(e) => { setVal(e.target.value); updateCursor(e.target); }}
              onSelect={(e) => updateCursor(e.target)}
              onClick={(e) => updateCursor(e.target)}
              onKeyUp={(e) => updateCursor(e.target)}
              onKeyDown={onKeyDown}
              disabled={submitting}
              placeholder="Describe a task. The lead agent will plan it and assign subtasks."
              rows={5}
              style={{
                position: 'relative', zIndex: 1,
                width: '100%', border: 'none', outline: 'none', resize: 'vertical',
                background: 'transparent', fontFamily: UI_FONT, fontSize: 15,
                color: val ? 'transparent' : '#1C1A17', caretColor: '#1C1A17',
                lineHeight: 1.55, minHeight: 100,
              }}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            paddingTop: 12, borderTop: '1px solid #ECE6D5', flexWrap: 'wrap',
          }}>
            <CustomPicker
              icon={<FolderAddIcon size={13} />}
              placeholder="Pick a project"
              value={selectedProjectId}
              items={projectItems}
              onChange={setSelectedProjectId}
              footer={(close) => (
                <PickerRow
                  icon={<FolderAddIcon size={14} />}
                  label="Use existing folder"
                  onClick={() => { close(); onExistingFolder?.(); }}
                />
              )}
            />

            <CustomPicker
              icon={<AgentIcon size={13} />}
              placeholder="Pick a lead"
              value={selectedAgentId}
              items={agentItems}
              onChange={setSelectedAgentId}
            />

            <div style={{ flex: 1 }} />
            <button
              data-testid="start-crew-button"
              onClick={startCrew}
              disabled={!canStart}
              style={{
                ...chip,
                background: canStart ? '#1C1A17' : '#F0EAD8',
                color: canStart ? '#FCFBF7' : '#A89F92',
                border: '1px solid ' + (canStart ? '#1C1A17' : '#E6DFCC'),
                fontWeight: 500, padding: '6px 14px',
              }}
            >
              {submitting ? 'Starting…' : 'Start →'}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {SUGGESTIONS.map((s, i) => (
            <div
              key={i}
              onClick={() => setVal(s.fill)}
              style={{ padding: 14, borderRadius: 10, border: '1px solid #ECE6D5', background: '#FCFAF1', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#EBE5D6'}
              onMouseLeave={e => e.currentTarget.style.background = '#FCFAF1'}
            >
              <div style={{ fontSize: 13.5, fontWeight: 500, color: '#1C1A17', marginBottom: 4 }}>{s.t}</div>
              <div style={{ fontSize: 12.5, color: '#807972', lineHeight: 1.5 }}>{s.b}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
