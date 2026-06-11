import { describe, it, expect, vi, beforeEach } from 'vitest';

// Seam test for the goal-mode RPC params: mocks the rpc layer (the
// api-archive-chat precedent) and asserts the exact wire shape the daemon
// expects, so a refactor of api.js can't silently drop a required param.
vi.mock('../rpc-client.js', () => ({
  rpc: { call: vi.fn() },
}));

import { createChat, answerGoal, updateGoalCriteria, signoffGoal } from '../api.js';
import { rpc } from '../rpc-client.js';

beforeEach(() => {
  vi.clearAllMocks();
  rpc.call.mockResolvedValue({ ok: true });
});

describe('api.createChat goal mode', () => {
  it('sends goal_mode: true when goalMode is set', async () => {
    await createChat('p1', 'Stabilize onboarding', 'a1', { goalMode: true });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    const [method, params] = rpc.call.mock.calls[0];
    expect(method).toBe('chats.create');
    expect(params).toMatchObject({
      project_id: 'p1', title: 'Stabilize onboarding', main_agent_id: 'a1', goal_mode: true,
    });
  });

  it('omits goal_mode entirely when not set', async () => {
    await createChat('p1', 'Normal task', 'a1', {});
    const [, params] = rpc.call.mock.calls[0];
    expect('goal_mode' in params).toBe(false);

    await createChat('p1', 'Also normal', 'a1');
    expect('goal_mode' in rpc.call.mock.calls[1][1]).toBe(false);
  });
});

describe('api.answerGoal', () => {
  it('sends clarify_seq alongside the answers', async () => {
    const answers = [
      { question_id: 'q1', option: 0 },
      { question_id: 'q2', text: 'leave CI config alone' },
    ];
    await answerGoal('chat-1', answers, 5);
    expect(rpc.call).toHaveBeenCalledWith('chats.goal.answer', {
      id: 'chat-1',
      answers,
      clarify_seq: 5,
    });
  });
});

describe('api.updateGoalCriteria', () => {
  it('omits statement when undefined', async () => {
    await updateGoalCriteria('chat-1', {
      criteria: [{ id: 'c1', text: 'Green runs', verify: 'run_tests' }],
    });
    const [method, params] = rpc.call.mock.calls[0];
    expect(method).toBe('chats.goal.criteria.update');
    expect('statement' in params).toBe(false);
    expect(params).toMatchObject({
      id: 'chat-1',
      criteria: [{ id: 'c1', text: 'Green runs', verify: 'run_tests' }],
    });
  });

  it('includes statement when provided', async () => {
    await updateGoalCriteria('chat-1', { statement: 'Verifiably stable', criteria: [] });
    const [, params] = rpc.call.mock.calls[0];
    expect(params.statement).toBe('Verifiably stable');
  });
});

describe('api.signoffGoal', () => {
  it('passes action and notes through', async () => {
    await signoffGoal('chat-1', 'send_back', 'spinner still flashes');
    expect(rpc.call).toHaveBeenCalledWith('chats.goal.signoff', {
      id: 'chat-1', action: 'send_back', notes: 'spinner still flashes',
    });
  });

  it('defaults notes to an empty string', async () => {
    await signoffGoal('chat-1', 'accept');
    expect(rpc.call).toHaveBeenCalledWith('chats.goal.signoff', {
      id: 'chat-1', action: 'accept', notes: '',
    });
  });
});
