import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TaskView from '../TaskView.jsx';
import * as api from '../api.js';
import { __resetSeenAgentsCacheForTests } from '../utils.js';

vi.mock('../api.js', () => ({
  getChat: vi.fn(),
  postMessage: vi.fn(),
  interruptMessage: vi.fn(),
  cancelPendingSteer: vi.fn(),
  deliverPendingSteers: vi.fn(),
  cancelChat: vi.fn(),
  streamChatEvents: vi.fn(),
  listProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  getProjectGitDiff: vi.fn(),
  updateChat: vi.fn(),
  createChat: vi.fn(),
  getGitInfo: vi.fn(),
  updateProject: vi.fn(),
  answerGoal: vi.fn(),
  updateGoalCriteria: vi.fn(),
  signoffGoal: vi.fn(),
}));

const agentsMap = {
  'agent-1': { id: 'agent-1', name: 'Aria', kind: 'agent', initial: 'A', color: '#C4644A' },
};

const baseChat = {
  id: 'chat-1',
  title: 'Fix flaky onboarding tests',
  created_at: '2026-06-10T10:00:00Z',
  main_agent_id: 'agent-1',
  current_agent_id: 'agent-1',
  participant_agent_ids: ['agent-1'],
  status: 'active',
  stream: { status: 'idle' },
};

const runningGoal = {
  phase: 'running',
  statement: 'Onboarding suite verifiably stable',
  criteria: [
    { id: 'c1', text: 'Green on 20 consecutive runs', verify: 'run_tests x20', status: 'verified', detail: '20/20' },
    { id: 'c2', text: 'No .only left behind', verify: 'grep gate', status: 'pending' },
  ],
  attempt: 1,
  attempt_cap: 5,
};

function goalChat(goal) {
  return { ...baseChat, goal };
}

beforeEach(() => {
  __resetSeenAgentsCacheForTests();
  window.localStorage.clear();
  vi.clearAllMocks();
  api.getChat.mockResolvedValue(baseChat);
  api.postMessage.mockResolvedValue({ ...baseChat, stream: { status: 'streaming' } });
  api.streamChatEvents.mockImplementation(() => vi.fn());
  api.listProjectFiles.mockResolvedValue([]);
  api.readProjectFile.mockResolvedValue({ path: '', content: '', size: 0, truncated: false, binary: false });
  api.getProjectGitDiff.mockResolvedValue([]);
  api.updateChat.mockImplementation(async (id, data) => ({ ...baseChat, ...data, id }));
  api.getGitInfo.mockResolvedValue({ is_git_repo: false });
  api.updateProject.mockResolvedValue({});
  api.updateGoalCriteria.mockResolvedValue(goalChat(runningGoal));
  api.signoffGoal.mockResolvedValue(goalChat({ ...runningGoal, phase: 'done' }));
});

function emitEvent(stream, event) {
  return act(async () => {
    stream[2](event);
  });
}

describe('TaskView goal mode gap coverage', () => {
  it('renders the goal-lock divider on a goal_lock event', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 6, type: 'goal_lock', ts: '2026-06-10T10:02:00Z', actor_agent_id: 'agent-1',
      goal_lock: {
        statement: 'Onboarding suite verifiably stable',
        criteria: [
          { id: 'c1', text: 'Green on 20 consecutive runs', status: 'pending' },
          { id: 'c2', text: 'No .only left behind', status: 'pending' },
        ],
      },
    });

    const divider = await screen.findByTestId('goal-lock-divider');
    expect(divider).toHaveTextContent('Goal locked');
    expect(divider).toHaveTextContent('2 criteria');
  });

  it('renders the sent-back divider for send_back and nothing for accept', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 13, type: 'goal_signoff', ts: '2026-06-10T14:01:00Z', actor_agent_id: '',
      goal_signoff: { action: 'send_back', notes: 'spinner still flashes on slow networks' },
    });

    const divider = await screen.findByTestId('goal-sendback-divider');
    expect(divider).toHaveTextContent('Sent back');
    expect(divider).toHaveTextContent('spinner still flashes on slow networks');

    await emitEvent(stream, {
      seq: 14, type: 'goal_signoff', ts: '2026-06-10T15:00:00Z', actor_agent_id: '',
      goal_signoff: { action: 'accept' },
    });
    // accept renders no standalone divider — the done banner carries it.
    expect(screen.getAllByTestId('goal-sendback-divider')).toHaveLength(1);
  });

  it('renders a superseded clarify round collapsed and read-only', async () => {
    // chat.goal points at a newer round (clarify_seq 9), so the seq-5 event
    // is no longer interactive even with no stored answers.
    api.getChat.mockResolvedValue(goalChat({ phase: 'scoping', clarify_seq: 9, attempt: 0, attempt_cap: 5 }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 5, type: 'goal_clarify', ts: '2026-06-10T10:01:00Z', actor_agent_id: 'agent-1',
      goal_clarify: {
        questions: [{ id: 'q1', q: 'Which tests?', type: 'chips', options: ['onboarding/** only', 'Whole suite'] }],
      },
    });

    const collapsed = await screen.findByTestId('goal-clarify-collapsed');
    expect(collapsed).toHaveTextContent('Scoped the goal');
    expect(screen.queryByTestId('goal-clarify-lock')).not.toBeInTheDocument();
  });

  it('shows the all-verified card and pill state awaiting sign-off', async () => {
    api.getChat.mockResolvedValue(goalChat({
      ...runningGoal,
      phase: 'awaiting_signoff',
      criteria: runningGoal.criteria.map(c => ({ ...c, status: 'verified' })),
    }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    expect(screen.getByTestId('goal-card-progress')).toHaveTextContent('2/2 verified');
    expect(screen.getByTestId('goal-header-pill')).toHaveTextContent('goal · 2/2');

    // Expand the card: the footer carries the awaiting-sign-off line.
    fireEvent.click(screen.getByTestId('goal-card-bar'));
    expect(screen.getByTestId('goal-card')).toHaveTextContent('Every criterion verified');
  });

  it('cancels a criterion edit with Escape without saving', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    fireEvent.click(screen.getAllByTestId('goal-criterion-edit')[0]);
    const input = screen.getByTestId('goal-criterion-input');
    fireEvent.change(input, { target: { value: 'something else entirely' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(api.updateGoalCriteria).not.toHaveBeenCalled();
    expect(screen.queryByTestId('goal-criterion-input')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('goal-criterion-row')[0]).toHaveTextContent('Green on 20 consecutive runs');
  });

  it('formats sub-minute elapsed time in the done banner', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 1, elapsed_seconds: 45 },
    });

    const banner = await screen.findByTestId('goal-done');
    expect(banner).toHaveTextContent('45s');
  });
});

describe('TaskView goal RPC failures', () => {
  it('surfaces a rejected criteria save without claiming the gate re-armed', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    api.updateGoalCriteria.mockRejectedValue(new Error('conflict'));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    fireEvent.click(screen.getAllByTestId('goal-criterion-remove')[0]);

    const error = await screen.findByTestId('goal-card-error');
    expect(error).toHaveTextContent("Couldn't save the checklist");
    expect(screen.getByTestId('goal-card')).not.toHaveTextContent('gate re-arms');
    // The optimistic removal is reverted to the server state.
    await waitFor(() => {
      expect(screen.getAllByTestId('goal-criterion-row')).toHaveLength(2);
    });
  });

  it('re-enables the clarify card and shows an error when answers are rejected', async () => {
    api.getChat.mockResolvedValue(goalChat({ phase: 'scoping', clarify_seq: 5, attempt: 0, attempt_cap: 5 }));
    api.answerGoal.mockRejectedValue(new Error('clarify round superseded'));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 5, type: 'goal_clarify', ts: '2026-06-10T10:01:00Z', actor_agent_id: 'agent-1',
      goal_clarify: {
        questions: [{ id: 'q1', q: 'Which tests?', type: 'chips', options: ['onboarding/** only', 'Whole suite'] }],
      },
    });

    await screen.findByTestId('goal-clarify');
    fireEvent.click(screen.getAllByTestId('goal-clarify-chip')[0]);
    fireEvent.click(screen.getByTestId('goal-clarify-lock'));

    const error = await screen.findByTestId('goal-clarify-error');
    expect(error).toHaveTextContent("Couldn't lock the goal");
    // The round is still interactive: selection kept, lock re-enabled.
    const lock = screen.getByTestId('goal-clarify-lock');
    expect(lock).not.toBeDisabled();
    expect(lock).toHaveTextContent('Lock in goal →');
    expect(screen.getAllByTestId('goal-clarify-chip')[0]).not.toBeDisabled();
    // No reconnect was attempted for the failed answer.
    expect(api.streamChatEvents).toHaveBeenCalledTimes(1);
  });

  it('re-enables accept with busy treatment cleared when the sign-off is rejected', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    let rejectSignoff;
    api.signoffGoal.mockImplementation(() => new Promise((_, reject) => { rejectSignoff = reject; }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 3, elapsed_seconds: 60 },
    });

    await screen.findByTestId('goal-done');
    fireEvent.click(screen.getByTestId('goal-accept'));

    // Busy treatment while the RPC is in flight.
    expect(screen.getByTestId('goal-accept')).toBeDisabled();
    expect(screen.getByTestId('goal-accept')).toHaveTextContent('Accepting…');

    await act(async () => { rejectSignoff(new Error('verifier turn still streaming')); });

    const error = await screen.findByTestId('goal-signoff-error');
    expect(error).toHaveTextContent("Couldn't record the sign-off");
    const accept = screen.getByTestId('goal-accept');
    expect(accept).not.toBeDisabled();
    expect(accept).toHaveTextContent('Accept & close task');
  });

  it('clears the waiting state and shows an error when send-back is rejected', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    api.signoffGoal.mockRejectedValue(new Error('conflict'));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 3, elapsed_seconds: 60 },
    });

    await screen.findByTestId('goal-done');
    fireEvent.click(screen.getByTestId('goal-sendback'));
    fireEvent.change(screen.getByTestId('goal-sendback-notes'), { target: { value: 'needs another pass' } });
    fireEvent.click(screen.getByTestId('goal-sendback-confirm'));

    const error = await screen.findByTestId('goal-signoff-error');
    expect(error).toHaveTextContent("Couldn't record the sign-off");
    // No phantom "agent working" reconnect for the failed send-back, and
    // the notes form is still live for a retry.
    expect(api.streamChatEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('goal-sendback-confirm')).not.toBeDisabled();
    expect(screen.getByTestId('goal-sendback-notes')).toHaveValue('needs another pass');
  });
});

describe('GoalCard rapid edits', () => {
  it('two quick removals do not resurrect the first-removed criterion', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    // Remove both criteria before the first save resolves: the second
    // removal must compute from the optimistic working copy, not the
    // props snapshot that still contains c1.
    fireEvent.click(screen.getAllByTestId('goal-criterion-remove')[0]);
    fireEvent.click(screen.getAllByTestId('goal-criterion-remove')[0]);

    await waitFor(() => expect(api.updateGoalCriteria).toHaveBeenCalledTimes(2));
    const finalList = api.updateGoalCriteria.mock.calls[1][1].criteria;
    expect(finalList).toEqual([]);
  });

  // Daemon-faithful echo for the unsaved-row tests: whole-list replacement
  // in input order, minting ids for id-less rows (the add flow sends none).
  function mockDaemonEcho() {
    api.updateGoalCriteria.mockImplementation(async (id, { criteria }) => goalChat({
      ...runningGoal,
      criteria: criteria.map((c, i) => ({ ...c, id: c.id || `srv-${i}`, status: 'pending' })),
    }));
  }

  function addCriterion(text) {
    fireEvent.click(screen.getByTestId('goal-criterion-add'));
    const input = screen.getByTestId('goal-criterion-add-input');
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('removing the first of two quickly-added criteria removes only that row', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    mockDaemonEcho();
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    // Both adds land before any save resolves, so neither row has a server
    // id yet — matching by id alone would treat them as the same row.
    addCriterion('first new check');
    addCriterion('second new check');

    // Remove the FIRST added row (after the two server rows) while the
    // adds' saves are still in flight.
    fireEvent.click(screen.getAllByTestId('goal-criterion-remove')[2]);

    await waitFor(() => expect(api.updateGoalCriteria).toHaveBeenCalledTimes(3));
    const finalTexts = api.updateGoalCriteria.mock.calls[2][1].criteria.map(c => c.text);
    expect(finalTexts).toContain('second new check');
    expect(finalTexts).not.toContain('first new check');

    // The reconciled visible list keeps exactly one new row.
    await waitFor(() => {
      expect(screen.getAllByTestId('goal-criterion-row')).toHaveLength(3);
    });
    const card = screen.getByTestId('goal-card');
    expect(card).toHaveTextContent('second new check');
    expect(card).not.toHaveTextContent('first new check');
  });

  it('editing one of two unsaved rows changes only that row', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    mockDaemonEcho();
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    addCriterion('alpha check');
    addCriterion('beta check');

    // Edit the first unsaved row before any save echo reconciles.
    fireEvent.click(screen.getAllByTestId('goal-criterion-edit')[2]);
    const input = screen.getByTestId('goal-criterion-input');
    fireEvent.change(input, { target: { value: 'alpha check v2' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(api.updateGoalCriteria).toHaveBeenCalledTimes(3));
    expect(api.updateGoalCriteria.mock.calls[2][1].criteria.map(c => c.text)).toEqual([
      'Green on 20 consecutive runs',
      'No .only left behind',
      'alpha check v2',
      'beta check',
    ]);

    // The sibling unsaved row is untouched in the reconciled list too.
    await waitFor(() => {
      expect(screen.getAllByTestId('goal-criterion-row')).toHaveLength(4);
    });
    const rows = screen.getAllByTestId('goal-criterion-row').map(r => r.textContent);
    expect(rows[2]).toContain('alpha check v2');
    expect(rows[3]).toContain('beta check');
    expect(rows[3]).not.toContain('alpha check v2');
  });
});

describe('superseded clarify rounds with colliding question ids', () => {
  it('does not show the current round answers on an old round card', async () => {
    // Both rounds use the id "q1"; chat.goal.answers belongs to the seq-9
    // round only.
    api.getChat.mockResolvedValue(goalChat({
      phase: 'scoping', clarify_seq: 9, answers: { q1: 'Whole suite' }, attempt: 0, attempt_cap: 5,
    }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 5, type: 'goal_clarify', ts: '2026-06-10T10:01:00Z', actor_agent_id: 'agent-1',
      goal_clarify: {
        questions: [{ id: 'q1', q: 'Which tests?', type: 'chips', options: ['onboarding/** only', 'Whole suite'] }],
      },
    });
    await emitEvent(stream, {
      seq: 9, type: 'goal_clarify', ts: '2026-06-10T10:05:00Z', actor_agent_id: 'agent-1',
      goal_clarify: {
        questions: [{ id: 'q1', q: 'Scope of green?', type: 'chips', options: ['Whole suite', 'Changed files'] }],
      },
    });

    const collapsed = await screen.findAllByTestId('goal-clarify-collapsed');
    expect(collapsed).toHaveLength(2);
    // The superseded seq-5 card renders answered-without-answer-detail.
    expect(collapsed[0]).not.toHaveTextContent('Whole suite');
    // The current seq-9 card keeps its own answer summary.
    expect(collapsed[1]).toHaveTextContent('Whole suite');
  });
});
