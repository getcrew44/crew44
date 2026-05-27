import React from 'react';
import { UI_FONT } from './components.jsx';
import { CustomPicker, PickerRow } from './CustomPicker.jsx';
import * as api from './api.js';
import { suggestionBounds, MentionHighlightText } from './composerMentions.jsx';
import { AttachmentTray } from './AttachmentChips.jsx';
import { attachmentsSupported, dedupeAttachments, droppedAttachments, pickAttachments } from './attachments.js';
import { dataTransferHasFiles } from './dragDrop.js';
import { primeAudioContext } from './audio.js';
import { textareaCaretPoint } from './textareaCaret.js';
import { SendShortcutMenu, shouldSendFromEnterKey, useSendShortcutMode } from './sendShortcut.jsx';
import {
  clearComposerDraft,
  newTaskDraftChatId,
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

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// deriveBranchSlug mirrors the daemon's branchSlug: first line, lowercased,
// alphanumerics only, up to four words joined by hyphens. Used to preview the
// branch the crew will eventually rename its worktree to.
function deriveBranchSlug(text) {
  const line = (text || '').trim().split('\n')[0].toLowerCase();
  const words = line.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 4).join('-');
}

function BranchGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style={{ color: '#C2B89F', flexShrink: 0 }}>
      <circle cx="4" cy="3.5" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="4" cy="12.5" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="11.5" cy="7" r="1.4" fill="none" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M4 5v6" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
      <path d="M4 8.5c0-2.5 7.5-1 7.5-3.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

function WorktreeChip({ enabled, onToggle }) {
  return (
    <button
      type="button"
      data-testid="worktree-toggle"
      onClick={onToggle}
      title={enabled
        ? 'Disable worktree — the crew will edit your working tree directly'
        : "Run this task in an isolated git worktree so the crew can't dirty your working tree"}
      style={{
        ...chip, display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '4px 9px 4px 7px',
        color: enabled ? '#1C1A17' : '#5C544B', fontWeight: enabled ? 500 : 400,
      }}
    >
      <span aria-hidden="true" style={{
        position: 'relative', display: 'inline-block', width: 22, height: 13,
        borderRadius: 999, background: enabled ? '#7A6420' : '#D6CDB6',
        transition: 'background 120ms ease', flexShrink: 0,
      }}>
        <span style={{
          position: 'absolute', top: 1.5, left: enabled ? 10.5 : 1.5, width: 10, height: 10,
          borderRadius: '50%', background: '#FCFBF7', boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
          transition: 'left 120ms ease',
        }} />
      </span>
      {enabled ? 'Worktree' : 'Git worktree'}
    </button>
  );
}

// WorktreeDetail surfaces the intended branch name and the base-branch picker.
// The branch is a preview — the daemon starts at crew/<chatID8> and renames to
// this slug once the task earns a title.
function WorktreeDetail({ branchName, base, branches, onChangeBase }) {
  return (
    <div style={{
      marginTop: 8, paddingLeft: 2, display: 'flex', alignItems: 'center',
      gap: 10, flexWrap: 'wrap', fontFamily: UI_FONT, fontSize: 11.5, color: '#A89F92',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <BranchGlyph />
        <span data-testid="worktree-branch" style={{ fontFamily: MONO_FONT, color: '#807972' }}>{branchName}</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span>from</span>
        <CustomPicker
          icon={<BranchGlyph />}
          placeholder="base branch"
          value={base}
          items={(branches || []).map(b => ({ id: b, label: b }))}
          onChange={onChangeBase}
        />
      </span>
    </div>
  );
}

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

function FileGlyph({ isDir }) {
  return isDir ? (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 5.5a1 1 0 0 1 1-1h3.2l1.4 1.5h6.4a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-7.5z"
        stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="#F4F0E8"/>
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M5 2.5h5.2L13.5 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"
        stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="#FCFBF7"/>
      <path d="M10.2 2.5V6h3.3" stroke="#807972" strokeWidth="1.1" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}

function SkillGlyph() {
  return (
    <div aria-hidden="true" style={{
      width: 22, height: 22, borderRadius: 5,
      background: '#EEE6D2', color: '#5C544B',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, fontWeight: 600,
    }}>/</div>
  );
}

function NewTaskSuggestionRow({ option, active, onSelect }) {
  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 9px', borderRadius: 7,
    cursor: 'pointer',
    background: active ? '#EFE9DB' : 'transparent',
    color: '#1C1A17', fontSize: 13,
  };
  if (option.kind === 'agent') {
    return (
      <div
        role="option"
        aria-selected={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        style={rowStyle}
      >
        <AgentIcon size={14} />
        <span style={{ fontWeight: 500 }}>{option.agent.name}</span>
      </div>
    );
  }
  if (option.kind === 'file') {
    const segments = option.file.path.split('/');
    const name = segments.pop();
    const dir = segments.join('/');
    return (
      <div
        role="option"
        aria-selected={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        style={rowStyle}
      >
        <FileGlyph isDir={option.file.is_dir} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}{option.file.is_dir ? '/' : ''}
          </div>
          {dir && (
            <div style={{ fontSize: 11.5, color: '#807972', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dir}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (option.kind === 'skill') {
    return (
      <div
        role="option"
        aria-selected={active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        style={rowStyle}
      >
        <SkillGlyph />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>{option.skill.name}</div>
          <div style={{ fontSize: 11.5, color: '#807972' }}>Skill</div>
        </div>
      </div>
    );
  }
  return null;
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

const MENTION_MENU_WIDTH = 260;
const NEW_TASK_INPUT_MIN_HEIGHT = 100;
const NEW_TASK_INPUT_TEXT_STYLE = {
  fontFamily: UI_FONT,
  fontSize: 15,
  lineHeight: 1.55,
  padding: 0,
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  minHeight: NEW_TASK_INPUT_MIN_HEIGHT,
};

export default function NewTaskRoute({ projects, agents, skills = [], onNewTask, onExistingFolder, initialProjectId }) {
  const draftStorageChatId = React.useMemo(() => newTaskDraftChatId(), []);
  const initialDraft = React.useMemo(() => readComposerDraft('', draftStorageChatId), [draftStorageChatId]);
  const initialStoredProjectId = React.useMemo(
    () => initialProjectId || readLastNewChatProjectId(),
    [initialProjectId]
  );
  const [val, setVal] = React.useState(initialDraft.text || '');
  const [attachments, setAttachments] = React.useState([]);
  const [cursor, setCursor] = React.useState(0);
  const [activeSuggestion, setActiveSuggestion] = React.useState(0);
  const [mentionPoint, setMentionPoint] = React.useState(null);
  const [selectedProjectId, setSelectedProjectId] = React.useState(initialStoredProjectId || '');
  const [selectedAgentId, setSelectedAgentId] = React.useState(initialDraft.targetAgentId || '');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [fileMatches, setFileMatches] = React.useState([]);
  // gitInfo is null while unknown/loading; the worktree controls only appear
  // once we know the selected project's workdir is a git repo.
  const [gitInfo, setGitInfo] = React.useState(null);
  const [useWorktree, setUseWorktree] = React.useState(false);
  const [baseRef, setBaseRef] = React.useState('');
  const [sendShortcutMode, setSendShortcutMode] = useSendShortcutMode();
  const inputRef = React.useRef(null);
  const listboxRef = React.useRef(null);
  const selectedProjectExists = projects.some(project => project.id === selectedProjectId);
  const canAttach = attachmentsSupported();
  const defaultAgentId = agents[0]?.id || '';
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const hasWorkdir = Boolean(selectedProject?.workdir);
  const selectedAgent = agents.find(agent => agent.id === selectedAgentId);
  const agentSkills = React.useMemo(() => {
    if (!selectedAgent?.skill_ids?.length) return [];
    const allowed = new Set(selectedAgent.skill_ids);
    return (skills || []).filter(skill => allowed.has(skill.id));
  }, [selectedAgent, skills]);

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
    setAttachments([]);
    if (selectedProjectExists) writeLastNewChatProjectId(selectedProjectId);
    else if (!selectedProjectId) writeLastNewChatProjectId('');
  }, [selectedProjectExists, selectedProjectId]);

  React.useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  // Probe the selected project's git state to drive the worktree controls.
  // Default the toggle from the project's saved preference, but only for repos.
  React.useEffect(() => {
    let cancelled = false;
    setGitInfo(null);
    if (!selectedProjectExists) {
      setUseWorktree(false);
      return;
    }
    const wantDefault = Boolean(selectedProject?.use_worktree_default);
    api.getGitInfo(selectedProjectId)
      .then((info) => {
        if (cancelled) return;
        setGitInfo(info);
        setBaseRef(info.current_branch || '');
        setUseWorktree(Boolean(info.is_git_repo) && wantDefault);
      })
      .catch(() => { if (!cancelled) setGitInfo({ is_git_repo: false }); });
    return () => { cancelled = true; };
  }, [selectedProjectId, selectedProjectExists]); // eslint-disable-line react-hooks/exhaustive-deps

  const onToggleWorktree = () => {
    const next = !useWorktree;
    setUseWorktree(next);
    // Persist the choice as the project default so it sticks next time.
    if (selectedProjectExists) {
      api.updateProject(selectedProjectId, { use_worktree_default: next }).catch(() => {});
    }
  };

  React.useEffect(() => {
    writeComposerDraft('', draftStorageChatId, {
      text: val,
      targetAgentId: selectedAgentId && selectedAgentId !== defaultAgentId ? selectedAgentId : '',
    });
  }, [defaultAgentId, draftStorageChatId, selectedAgentId, val]);

  const projectItems = projects.map(p => ({ id: p.id, label: p.name }));
  const agentItems = agents.map(a => ({ id: a.id, label: a.name }));
  const activeToken = React.useMemo(() => suggestionBounds(val, cursor), [val, cursor]);

  React.useEffect(() => {
    if (!activeToken || activeToken.kind !== 'mention' || !hasWorkdir || !selectedProjectId) {
      setFileMatches([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.listProjectFiles(selectedProjectId, activeToken.query, 12)
        .then(items => { if (!cancelled) setFileMatches(items || []); })
        .catch(() => { if (!cancelled) setFileMatches([]); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeToken?.kind, activeToken?.query, selectedProjectId, hasWorkdir]);

  const suggestionOptions = React.useMemo(() => {
    if (!activeToken) return [];
    const q = activeToken.query.toLowerCase();
    if (activeToken.kind === 'mention') {
      const agentItems = agents
        .filter(agent => agent.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map(agent => ({ kind: 'agent', key: `agent:${agent.id}`, agent }));
      const fileItems = (fileMatches || []).map(file => ({
        kind: 'file',
        key: `file:${file.path}`,
        file,
      }));
      return [...agentItems, ...fileItems].slice(0, 12);
    }
    if (activeToken.kind === 'slash') {
      return agentSkills
        .filter(skill => skill.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map(skill => ({ kind: 'skill', key: `skill:${skill.id}`, skill }));
    }
    return [];
  }, [activeToken, agents, fileMatches, agentSkills]);

  React.useEffect(() => {
    setActiveSuggestion(0);
  }, [activeToken?.kind, activeToken?.query, suggestionOptions.length]);

  React.useEffect(() => {
    const el = listboxRef.current?.children[activeSuggestion];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestion]);

  React.useEffect(() => {
    if (!inputRef.current) return;
    const prevScrollTop = inputRef.current.scrollTop;
    inputRef.current.style.height = 'auto';
    inputRef.current.style.height = Math.min(360, inputRef.current.scrollHeight) + 'px';
    inputRef.current.scrollTop = prevScrollTop;
    setScrollTop(inputRef.current.scrollTop);
  }, [val]);

  React.useLayoutEffect(() => {
    if (!activeToken || !inputRef.current) {
      setMentionPoint(null);
      return;
    }
    setMentionPoint(textareaCaretPoint(inputRef.current, activeToken.start));
  }, [activeToken, val]);

  const updateCursor = (node) => {
    setCursor(node?.selectionStart ?? val.length);
  };

  const applySuggestion = (option) => {
    if (!activeToken || !option) return;
    let inserted;
    if (option.kind === 'agent') inserted = `@${option.agent.name}`;
    else if (option.kind === 'file') inserted = `@${option.file.path}`;
    else if (option.kind === 'skill') inserted = `/${option.skill.name}`;
    else return;
    const next = `${val.slice(0, activeToken.start)}${inserted} ${val.slice(activeToken.end)}`;
    const nextCursor = activeToken.start + inserted.length + 1;
    setVal(next);
    setCursor(nextCursor);
    window.requestAnimationFrame?.(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const addAttachments = React.useCallback((nextAttachments) => {
    if (!nextAttachments?.length) return;
    setAttachments(current => dedupeAttachments(current, nextAttachments));
  }, []);

  const chooseAttachments = React.useCallback(async () => {
    if (!canAttach || submitting) return;
    addAttachments(await pickAttachments());
  }, [addAttachments, canAttach, submitting]);

  const removeAttachment = React.useCallback((path) => {
    setAttachments(current => current.filter(attachment => attachment.path !== path));
  }, []);

  const handleDrop = React.useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canAttach || submitting || !dataTransferHasFiles(e.dataTransfer)) return;
    addAttachments(await droppedAttachments(e.dataTransfer));
  }, [addAttachments, canAttach, submitting]);

  const startCrew = async () => {
    const text = val.trim();
    if ((!text && attachments.length === 0) || submitting) return;

    const projectId = selectedProjectExists ? selectedProjectId : '';
    const agentId = selectedAgentId || agents[0]?.id;

    if (!projectId || !agentId) {
      setError('Select a project and ensure at least one agent exists.');
      return;
    }

    primeAudioContext();
    setSubmitting(true);
    setError(null);

    try {
      const titleSource = text || attachments[0]?.display_name || 'Attachments';
      const worktreeOpts = gitInfo?.is_git_repo ? { useWorktree, baseRef } : {};
      const chat = await api.createChat(projectId, titleSource, agentId, worktreeOpts);
      await api.postMessage(chat.id, text, chat.main_agent_id, attachments);
      clearComposerDraft('', draftStorageChatId);
      onNewTask(chat.id);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const onKeyDown = (e) => {
    if (suggestionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion(i => Math.min(i + 1, suggestionOptions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestionOptions[activeSuggestion] || suggestionOptions[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setCursor(-1);
        return;
      }
    }
    if (shouldSendFromEnterKey(e, sendShortcutMode)) {
      e.preventDefault();
      startCrew();
    }
  };

  const canStart = (val.trim() || attachments.length > 0) && !submitting && selectedProjectExists && selectedAgentId;
  const mentionMenuLeft = mentionPoint && inputRef.current
    ? Math.min(Math.max(0, mentionPoint.left - 8), Math.max(0, inputRef.current.clientWidth - MENTION_MENU_WIDTH))
    : 0;

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
        }}
          onDragOver={(e) => {
            if (!dataTransferHasFiles(e.dataTransfer)) return;
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={handleDrop}
        >
          <AttachmentTray attachments={attachments} onRemove={removeAttachment} />
          <div style={{ position: 'relative' }}>
            {suggestionOptions.length > 0 && (
              <div
                ref={listboxRef}
                data-testid="new-task-mention-list"
                role="listbox"
                aria-label={activeToken?.kind === 'slash' ? 'Skill suggestions' : 'Mention suggestions'}
                style={{
                  position: 'absolute',
                  left: mentionMenuLeft,
                  top: mentionPoint ? mentionPoint.top : 0,
                  width: MENTION_MENU_WIDTH,
                  zIndex: 5,
                  background: '#FFFEF8',
                  border: '1px solid #DCD3BC',
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(28,26,23,0.14)',
                  padding: 4,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {suggestionOptions.map((option, index) => (
                  <NewTaskSuggestionRow
                    key={option.key}
                    option={option}
                    active={index === activeSuggestion}
                    onSelect={() => applySuggestion(option)}
                  />
                ))}
              </div>
            )}
            <div style={{ position: 'relative', overflow: 'hidden' }}>
            {val && (
              <div
                aria-hidden="true"
                data-testid="new-task-input-overlay"
                style={{
                  ...NEW_TASK_INPUT_TEXT_STYLE,
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  color: '#1C1A17',
                  transform: `translateY(${-scrollTop}px)`,
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
              onScroll={(e) => setScrollTop(e.target.scrollTop)}
              onKeyDown={onKeyDown}
              onDragOver={(e) => {
                if (!dataTransferHasFiles(e.dataTransfer)) return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={handleDrop}
              disabled={submitting}
              placeholder="Describe a task. The lead agent will plan it and assign subtasks."
              rows={1}
              style={{
                ...NEW_TASK_INPUT_TEXT_STYLE,
                position: 'relative', zIndex: 1,
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                background: 'transparent',
                color: val ? 'transparent' : '#1C1A17', caretColor: '#1C1A17',
                display: 'block',
              }}
            />
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            paddingTop: 12, borderTop: '1px solid #ECE6D5', flexWrap: 'wrap',
          }}>
            {canAttach && (
              <button
                type="button"
                data-testid="new-task-attach"
                onClick={chooseAttachments}
                disabled={submitting}
                title="Attach files"
                style={{
                  width: 28, height: 28, borderRadius: 999, border: 'none',
                  background: 'transparent', color: '#A89F92', cursor: submitting ? 'default' : 'pointer',
                  fontFamily: UI_FONT, fontSize: 20, lineHeight: '24px',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  opacity: submitting ? 0.45 : 1,
                }}
              >
                +
              </button>
            )}
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

            {gitInfo?.is_git_repo && (
              <WorktreeChip enabled={useWorktree} onToggle={onToggleWorktree} />
            )}

            <div style={{ flex: 1 }} />
            <SendShortcutMenu mode={sendShortcutMode} onChange={setSendShortcutMode} direction="down" />
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
          {gitInfo?.is_git_repo && useWorktree && (
            <WorktreeDetail
              branchName={'crew/' + (deriveBranchSlug(val) || 'task')}
              base={baseRef}
              branches={gitInfo.branches}
              onChangeBase={setBaseRef}
            />
          )}
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
