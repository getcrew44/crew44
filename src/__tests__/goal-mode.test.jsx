import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TaskView from '../TaskView.jsx';
import NewTaskRoute from '../NewTaskRoute.jsx';
import * as api from '../api.js';
import { mapBackendEvent, __resetSeenAgentsCacheForTests } from '../utils.js';

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
  api.createChat.mockResolvedValue({ id: 'chat-1', main_agent_id: 'a1' });
  api.getGitInfo.mockResolvedValue({ is_git_repo: false });
  api.updateProject.mockResolvedValue({});
  api.answerGoal.mockResolvedValue(goalChat({ ...runningGoal, phase: 'scoping' }));
  api.updateGoalCriteria.mockImplementation(async (id, { criteria }) => goalChat({
    ...runningGoal,
    criteria: criteria.map((c, i) => ({ ...c, id: c.id || `c-new-${i}`, status: 'pending' })),
  }));
  api.signoffGoal.mockResolvedValue(goalChat({ ...runningGoal, phase: 'done' }));
});

function emitEvent(stream, event) {
  return act(async () => {
    stream[2](event);
  });
}

describe('mapBackendEvent goal kinds', () => {
  it('maps all five goal event types', () => {
    const clarify = mapBackendEvent({
      seq: 5, type: 'goal_clarify', ts: '2026-06-10T10:01:00Z', actor_agent_id: 'agent-1',
      goal_clarify: { intro: 'Three ambiguities.', questions: [{ id: 'q1', q: 'Which tests?', type: 'chips', options: ['a', 'b'] }] },
    });
    expect(clarify).toMatchObject({ kind: 'goal_clarify', author: 'agent-1', intro: 'Three ambiguities.', _seq: 5 });
    expect(clarify.questions).toHaveLength(1);

    const lock = mapBackendEvent({
      seq: 6, type: 'goal_lock', ts: '2026-06-10T10:02:00Z', actor_agent_id: 'agent-1',
      goal_lock: { statement: 'Stable', criteria: [{ id: 'c1', text: 'Green', status: 'pending' }] },
    });
    expect(lock).toMatchObject({ kind: 'goal_lock', statement: 'Stable' });
    expect(lock.criteria).toHaveLength(1);

    const verify = mapBackendEvent({
      seq: 7, type: 'goal_verify', ts: '2026-06-10T10:03:00Z', actor_agent_id: 'agent-1',
      goal_verify: { attempt: 2, overall: 'failed', rows: [{ id: 'c1', text: 'Green', status: 'fail', detail: 'run 13' }], outcome: 'Gate held.' },
    });
    expect(verify).toMatchObject({ kind: 'goal_verify', attempt: 2, overall: 'failed', outcome: 'Gate held.' });

    const done = mapBackendEvent({
      seq: 8, type: 'goal_done', ts: '2026-06-10T10:04:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 5, attempts: 3, elapsed_seconds: 15240 },
    });
    expect(done).toMatchObject({ kind: 'goal_done', criteriaTotal: 5, attempts: 3, elapsedSeconds: 15240 });

    const signoff = mapBackendEvent({
      seq: 9, type: 'goal_signoff', ts: '2026-06-10T10:05:00Z', actor_agent_id: '',
      goal_signoff: { action: 'send_back', notes: 'spinner flashes' },
    });
    expect(signoff).toMatchObject({ kind: 'goal_signoff', action: 'send_back', notes: 'spinner flashes' });
  });
});

describe('TaskView goal mode', () => {
  it('renders no goal card or pill for a non-goal chat', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');
    expect(screen.queryByTestId('goal-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-header-pill')).not.toBeInTheDocument();
  });

  it('renders the drafting card and scoping pill during scoping', async () => {
    api.getChat.mockResolvedValue(goalChat({ phase: 'scoping', attempt: 0, attempt_cap: 5 }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');
    expect(screen.getByTestId('goal-card')).toHaveTextContent('Drafting');
    expect(screen.getByTestId('goal-header-pill')).toHaveTextContent('goal · scoping');
  });

  it('renders the criteria checklist with live statuses', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');
    expect(screen.getByTestId('goal-card-progress')).toHaveTextContent('1/2 verified');
    expect(screen.getByTestId('goal-header-pill')).toHaveTextContent('goal · 1/2');
    const rows = screen.getAllByTestId('goal-criterion-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Green on 20 consecutive runs');
    expect(screen.getByTestId('goal-card')).toHaveTextContent('attempt 1');
  });

  it('answers the active clarify round and locks the goal', async () => {
    api.getChat.mockResolvedValue(goalChat({ phase: 'scoping', clarify_seq: 5, attempt: 0, attempt_cap: 5 }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 5, type: 'goal_clarify', ts: '2026-06-10T10:01:00Z', actor_agent_id: 'agent-1',
      goal_clarify: {
        intro: 'Three ambiguities.',
        questions: [
          { id: 'q1', q: 'Which tests define green?', type: 'chips', options: ['onboarding/** only', 'Whole suite'], rec: 0 },
          { id: 'q2', q: 'Anything off-limits?', type: 'text', placeholder: 'e.g. CI config' },
        ],
      },
    });

    const clarify = await screen.findByTestId('goal-clarify');
    expect(clarify).toHaveTextContent('Three ambiguities.');
    const lockButton = screen.getByTestId('goal-clarify-lock');
    expect(lockButton).toBeDisabled();

    fireEvent.click(screen.getAllByTestId('goal-clarify-chip')[0]);
    fireEvent.change(screen.getByTestId('goal-clarify-text'), { target: { value: 'leave CI config alone' } });
    expect(lockButton).not.toBeDisabled();
    fireEvent.click(lockButton);

    await waitFor(() => {
      // The third arg is the clarify round's seq (chat.goal.clarify_seq) —
      // the daemon requires it to bind answers to the round they answer.
      expect(api.answerGoal).toHaveBeenCalledWith('chat-1', [
        { question_id: 'q1', option: 0 },
        { question_id: 'q2', text: 'leave CI config alone' },
      ], 5);
    });
  });

  it('renders an answered clarify round collapsed', async () => {
    api.getChat.mockResolvedValue(goalChat({
      phase: 'scoping', clarify_seq: 5, answers: { q1: 'onboarding/** only' }, attempt: 0, attempt_cap: 5,
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

    const collapsed = await screen.findByTestId('goal-clarify-collapsed');
    expect(collapsed).toHaveTextContent('Scoped the goal');
    expect(collapsed).toHaveTextContent('onboarding/** only');
  });

  it('renders the verification gate with held state and rows', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 9, type: 'goal_verify', ts: '2026-06-10T11:00:00Z', actor_agent_id: 'agent-1',
      goal_verify: {
        attempt: 1, overall: 'failed',
        rows: [
          { id: 'c1', text: 'Green on 20 consecutive runs', verify: 'run_tests x20', status: 'fail', detail: 'flaked on run 13' },
          { id: 'c2', text: 'No .only left behind', verify: 'grep gate', status: 'pass', detail: 'clean' },
        ],
        outcome: 'Gate held — 1 of 2 criteria failed or unverified.',
      },
    });

    const gate = await screen.findByTestId('goal-verify');
    expect(gate).toHaveTextContent('attempt 1');
    expect(screen.getByTestId('goal-verify-held')).toHaveTextContent('gate held');
    expect(gate).toHaveTextContent('flaked on run 13');
    expect(gate).toHaveTextContent('Gate held — 1 of 2 criteria failed or unverified.');
  });

  it('renders nothing for a passed verification gate — the banner and done card carry it', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 9, type: 'goal_verify', ts: '2026-06-10T11:00:00Z', actor_agent_id: 'goal-verifier',
      goal_verify: {
        attempt: 1, overall: 'passed',
        rows: [
          { id: 'c1', text: 'Green on 20 consecutive runs', verify: 'run_tests x20', status: 'pass', detail: '20/20' },
          { id: 'c2', text: 'No .only left behind', verify: 'grep gate', status: 'pass', detail: 'clean' },
        ],
        outcome: 'All 2 criteria verified. Goal gate is open.',
      },
    });
    await emitEvent(stream, {
      seq: 10, type: 'goal_done', ts: '2026-06-10T11:00:05Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 1, elapsed_seconds: 60 },
    });

    await screen.findByTestId('goal-done');
    expect(screen.queryByTestId('goal-verify')).toBeNull();
  });

  it('signs off from the goal-done banner', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Onboarding suite verifiably stable', criteria_total: 2, attempts: 3, elapsed_seconds: 15240 },
    });

    const banner = await screen.findByTestId('goal-done');
    expect(banner).toHaveTextContent('Goal reached');
    expect(banner).toHaveTextContent('4h 14m');
    fireEvent.click(screen.getByTestId('goal-accept'));
    await waitFor(() => expect(api.signoffGoal).toHaveBeenCalledWith('chat-1', 'accept', ''));
  });

  it('sends the goal back with notes', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'awaiting_signoff' }));
    api.signoffGoal.mockResolvedValue(goalChat({ ...runningGoal, phase: 'running' }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 3, elapsed_seconds: 60 },
    });

    await screen.findByTestId('goal-done');
    fireEvent.click(screen.getByTestId('goal-sendback'));
    fireEvent.change(screen.getByTestId('goal-sendback-notes'), { target: { value: 'spinner still flashes' } });
    fireEvent.click(screen.getByTestId('goal-sendback-confirm'));
    await waitFor(() => expect(api.signoffGoal).toHaveBeenCalledWith('chat-1', 'send_back', 'spinner still flashes'));
  });

  it('hides sign-off buttons once the goal is done', async () => {
    api.getChat.mockResolvedValue(goalChat({ ...runningGoal, phase: 'done' }));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 12, type: 'goal_done', ts: '2026-06-10T14:00:00Z', actor_agent_id: '',
      goal_done: { statement: 'Stable', criteria_total: 2, attempts: 3, elapsed_seconds: 60 },
    });

    const banner = await screen.findByTestId('goal-done');
    expect(banner).toHaveTextContent('Accepted');
    expect(screen.queryByTestId('goal-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-sendback')).not.toBeInTheDocument();
  });

  it('commits criterion edits as a whole-list replacement', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    fireEvent.click(screen.getAllByTestId('goal-criterion-edit')[1]);
    const input = screen.getByTestId('goal-criterion-input');
    fireEvent.change(input, { target: { value: 'No .only or .skip left anywhere' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(api.updateGoalCriteria).toHaveBeenCalledWith('chat-1', {
        statement: undefined,
        criteria: [
          { id: 'c1', text: 'Green on 20 consecutive runs', verify: 'run_tests x20' },
          { id: 'c2', text: 'No .only or .skip left anywhere', verify: 'grep gate' },
        ],
      });
    });
    // The footer now flips only once the save resolves (a rejected save no
    // longer claims the gate re-armed), so wait for it.
    await waitFor(() => {
      expect(screen.getByTestId('goal-card')).toHaveTextContent('gate re-arms');
    });
  });

  it('removes and adds criteria through the card', async () => {
    api.getChat.mockResolvedValue(goalChat(runningGoal));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('goal-card');

    fireEvent.click(screen.getAllByTestId('goal-criterion-remove')[0]);
    await waitFor(() => {
      expect(api.updateGoalCriteria).toHaveBeenLastCalledWith('chat-1', expect.objectContaining({
        criteria: [{ id: 'c2', text: 'No .only left behind', verify: 'grep gate' }],
      }));
    });

    fireEvent.click(screen.getByTestId('goal-criterion-add'));
    const addInput = screen.getByTestId('goal-criterion-add-input');
    fireEvent.change(addInput, { target: { value: 'Document the fix' } });
    fireEvent.keyDown(addInput, { key: 'Enter' });
    await waitFor(() => {
      expect(api.updateGoalCriteria).toHaveBeenLastCalledWith('chat-1', expect.objectContaining({
        criteria: expect.arrayContaining([expect.objectContaining({ text: 'Document the fix' })]),
      }));
    });
  });
});

describe('NewTaskRoute goal mode', () => {
  const projects = [{ id: 'p1', name: 'First Project', workdir: '/tmp/p1' }];
  const agents = [{ id: 'a1', name: 'Aria' }];

  it('passes goal_mode to createChat when the chip is toggled', async () => {
    render(
      <NewTaskRoute projects={projects} agents={agents} onNewTask={() => {}} initialProjectId="p1" />
    );

    const startButton = screen.getByTestId('start-crew-button');
    expect(startButton).toHaveTextContent('Start →');

    fireEvent.click(screen.getByTestId('goal-mode-chip'));
    expect(startButton).toHaveTextContent('Set goal →');
    expect(screen.getByTestId('goal-mode-detail')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'Fix the flaky onboarding tests for good' },
    });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(api.createChat).toHaveBeenCalledWith(
        'p1',
        'Fix the flaky onboarding tests for good',
        'a1',
        expect.objectContaining({ goalMode: true }),
      );
    });
  });

  it('omits goal_mode when the chip is off', async () => {
    render(
      <NewTaskRoute projects={projects} agents={agents} onNewTask={() => {}} initialProjectId="p1" />
    );
    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'Just a normal task' },
    });
    fireEvent.click(screen.getByTestId('start-crew-button'));
    await waitFor(() => expect(api.createChat).toHaveBeenCalled());
    const opts = api.createChat.mock.calls[0][3];
    expect(opts.goalMode).toBeUndefined();
  });
});
