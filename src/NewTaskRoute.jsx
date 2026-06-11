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
import { GoalModeChip, GoalModeDetail } from './GoalMode.jsx';
import { isPartnerAgent } from './utils.js';
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

const ghostChip = {
  padding: '4px 9px', borderRadius: 6, fontSize: 12.5,
  border: '1px solid transparent', background: 'transparent', color: '#807972',
  cursor: 'pointer', fontFamily: UI_FONT,
  display: 'inline-flex', alignItems: 'center', gap: 5,
  transition: 'background 100ms ease',
};

const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

// newChatId mints a UUID the client pre-allocates for a worktree chat, so the
// new-task screen can preview the exact branch the daemon will check out
// (crew/<id8>). crypto.randomUUID is universal in browsers; the fallback keeps
// jsdom-based tests working.
function newChatId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

// branchPreview shows the placeholder branch the daemon creates the worktree
// on: crew/<first 8 chars of the chat ID>. It is renamed to a slug of the
// task's title once the chat earns one — the ID just guarantees a unique,
// git-safe starting point that never depends on what the user typed.
function branchPreview(chatId) {
  return 'crew/' + String(chatId || '').slice(0, 8);
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
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      data-testid="worktree-toggle"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={enabled
        ? 'Disable worktree — the crew will edit your working tree directly'
        : "Run this task in an isolated git worktree so the crew can't dirty your working tree"}
      style={{
        ...ghostChip, gap: 7,
        padding: '4px 9px 4px 7px',
        background: hover ? '#F0EAD8' : 'transparent',
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
      <span style={enabled ? { color: '#1C1A17', fontWeight: 500 } : undefined}>
        {enabled ? 'Worktree' : 'Git worktree'}
      </span>
    </button>
  );
}

// WorktreeDetail surfaces the branch the worktree will be created on and the
// base-branch picker. branchName is the crew/<chatID8> placeholder the daemon
// checks out; it is renamed to a slug of the task's title once one is earned.
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
  // Pre-allocated chat ID so the worktree branch preview matches what the
  // daemon actually checks out. Stable for the life of this compose session.
  const [draftChatId] = React.useState(newChatId);
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
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [fileMatches, setFileMatches] = React.useState([]);
  // gitInfo is null while unknown/loading; the worktree controls only appear
  // once we know the selected project's workdir is a git repo.
  const [gitInfo, setGitInfo] = React.useState(null);
  const [useWorktree, setUseWorktree] = React.useState(false);
  const [baseRef, setBaseRef] = React.useState('');
  // Goal mode: the lead scopes the goal with clarifying questions, locks
  // verifiable criteria, and the crew iterates until every check passes.
  const [goalMode, setGoalMode] = React.useState(false);
  // The user's standing worktree choice, carried across project switches.
  // null until seeded from the first project's saved default; after that it
  // follows explicit toggles rather than resetting to each project's default.
  const worktreePref = React.useRef(null);
  // Holds the chat once createChat succeeds, so a retry after a failed
  // postMessage re-posts to the existing chat instead of calling createChat
  // again — a second create reuses draftChatId and collides on the already
  // provisioned crew/<id8> worktree branch, wedging the task permanently.
  const createdChatRef = React.useRef(null);
  const [sendShortcutMode, setSendShortcutMode] = useSendShortcutMode();
  const inputRef = React.useRef(null);
  const listboxRef = React.useRef(null);
  const selectedProjectExists = projects.some(project => project.id === selectedProjectId);
  const canAttach = attachmentsSupported();
  const selectedProject = projects.find(project => project.id === selectedProjectId);
  const hasWorkdir = Boolean(selectedProject?.workdir);
  // The lead is always the Partner agent (the default-crew strategic
  // partner); there is no lead picker. Falls back to the first agent for
  // setups without the default crew.
  const leadAgent = React.useMemo(
    () => agents.find(isPartnerAgent) || agents[0] || null,
    [agents],
  );
  const agentSkills = React.useMemo(() => {
    if (!leadAgent?.skill_ids?.length) return [];
    const allowed = new Set(leadAgent.skill_ids);
    return (skills || []).filter(skill => allowed.has(skill.id));
  }, [leadAgent, skills]);

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

  // Probe the selected project's git state to drive the worktree controls.
  // The toggle reflects the user's standing choice (seeded once from the first
  // project's saved default) and carries across switches — git probing only
  // forces it off when the new project turns out not to be a repo.
  React.useEffect(() => {
    let cancelled = false;
    setGitInfo(null);
    if (!selectedProjectExists) {
      setUseWorktree(false);
      return;
    }
    if (worktreePref.current === null) {
      worktreePref.current = Boolean(selectedProject?.use_worktree_default);
    }
    // Reflect the standing choice immediately so a send issued while the git
    // probe is still in flight never falls back to a stale or default value.
    setUseWorktree(worktreePref.current);
    api.getGitInfo(selectedProjectId)
      .then((info) => {
        if (cancelled) return;
        setGitInfo(info);
        setBaseRef(info.current_branch || '');
        if (!info.is_git_repo) setUseWorktree(false);
      })
      .catch(() => { if (!cancelled) { setGitInfo({ is_git_repo: false }); setUseWorktree(false); } });
    return () => { cancelled = true; };
  }, [selectedProjectId, selectedProjectExists]); // eslint-disable-line react-hooks/exhaustive-deps

  const onToggleWorktree = () => {
    const next = !useWorktree;
    setUseWorktree(next);
    worktreePref.current = next;
    // Persist the choice as the project default so it sticks next time.
    if (selectedProjectExists) {
      api.updateProject(selectedProjectId, { use_worktree_default: next }).catch(() => {});
    }
  };

  React.useEffect(() => {
    writeComposerDraft('', draftStorageChatId, { text: val });
  }, [draftStorageChatId, val]);

  const projectItems = projects.map(p => ({ id: p.id, label: p.name }));
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
    const agentId = leadAgent?.id;

    if (!projectId || !agentId) {
      setError('Select a project and ensure at least one agent exists.');
      return;
    }

    primeAudioContext();
    setSubmitting(true);
    setError(null);

    try {
      const titleSource = text || attachments[0]?.display_name || 'Attachments';
      // The git probe may still be in flight if the project was just switched.
      // Resolve it now so the worktree decision is never dropped to a default
      // just because gitInfo hasn't loaded yet.
      let info = gitInfo;
      let base = baseRef;
      if (info === null) {
        info = await api.getGitInfo(projectId).catch(() => ({ is_git_repo: false }));
        base = info?.current_branch || '';
      }
      // Reuse the chat from a prior attempt whose postMessage failed — a fresh
      // createChat would reuse draftChatId and collide on the worktree branch
      // it already provisioned, leaving the task unstartable.
      let chat = createdChatRef.current;
      if (!chat) {
        const wantsWorktree = Boolean(info?.is_git_repo) && useWorktree;
        const createOpts = info?.is_git_repo ? { useWorktree, baseRef: base } : {};
        if (goalMode) createOpts.goalMode = true;
        // Hand the daemon the pre-allocated ID so the created worktree lands on
        // the exact crew/<id8> branch we previewed above.
        if (wantsWorktree) createOpts.id = draftChatId;
        chat = await api.createChat(projectId, titleSource, agentId, createOpts);
        createdChatRef.current = chat;
      }
      await api.postMessage(chat.id, text, chat.main_agent_id, attachments);
      createdChatRef.current = null;
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

  const canStart = (val.trim() || attachments.length > 0) && !submitting && selectedProjectExists && Boolean(leadAgent);
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
              placeholder={goalMode
                ? 'Describe the goal. The lead agent will scope it with you, then the crew iterates until it verifies.'
                : 'Describe a task. The lead agent will plan it and assign subtasks.'}
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
          {/* Two flex groups: the left chips wrap among themselves when the
              view is narrow, while the send controls stay pinned to the right
              instead of dropping to a stray second line. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            paddingTop: 12, borderTop: '1px solid #ECE6D5',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
              flex: 1, minWidth: 0,
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
              label="Project"
              placeholder="Pick a project"
              value={selectedProjectId}
              items={projectItems}
              onChange={setSelectedProjectId}
              variant="ghost"
              footer={(close) => (
                <PickerRow
                  icon={<FolderAddIcon size={14} />}
                  label="Use existing folder"
                  onClick={() => { close(); onExistingFolder?.(); }}
                />
              )}
            />

            {gitInfo?.is_git_repo && (
              <WorktreeChip enabled={useWorktree} onToggle={onToggleWorktree} />
            )}

            <GoalModeChip enabled={goalMode} onToggle={() => setGoalMode(v => !v)} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
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
                  whiteSpace: 'nowrap',
                }}
              >
                {submitting ? 'Starting…' : goalMode ? 'Set goal →' : 'Start →'}
              </button>
            </div>
          </div>
          {gitInfo?.is_git_repo && useWorktree && (
            <WorktreeDetail
              branchName={branchPreview(draftChatId)}
              base={baseRef}
              branches={gitInfo.branches}
              onChangeBase={setBaseRef}
            />
          )}
          {goalMode && <GoalModeDetail />}
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
