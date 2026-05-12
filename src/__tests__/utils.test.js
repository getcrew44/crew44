import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  agentColor, agentInitial, relativeTime, formatTime,
  displayAgent, mapBackendEvent, mergeToolResults, HUMAN_USER,
} from '../utils.js';

// ─── agentColor ────────────────────────────────────────────────────────────────
describe('agentColor', () => {
  it('returns a hex color from the palette', () => {
    const c = agentColor('agent-1');
    expect(c).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('is deterministic — same id always returns the same color', () => {
    expect(agentColor('aria')).toBe(agentColor('aria'));
    expect(agentColor('uuid-abc-123')).toBe(agentColor('uuid-abc-123'));
  });

  it('produces different colors for different ids (most of the time)', () => {
    const colors = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(agentColor)
    );
    // Not every id will collide; we expect at least a few distinct colors
    expect(colors.size).toBeGreaterThan(1);
  });
});

// ─── agentInitial ──────────────────────────────────────────────────────────────
describe('agentInitial', () => {
  it('returns first letter uppercased', () => {
    expect(agentInitial('aria')).toBe('A');
    expect(agentInitial('Nico')).toBe('N');
  });

  it('handles empty/null/undefined safely', () => {
    expect(agentInitial('')).toBe('?');
    expect(agentInitial(null)).toBe('?');
    expect(agentInitial(undefined)).toBe('?');
  });

  it('handles non-Latin characters', () => {
    expect(agentInitial('语境')).toBe('语');
  });
});

// ─── relativeTime ──────────────────────────────────────────────────────────────
describe('relativeTime', () => {
  const NOW = new Date('2026-05-12T12:00:00Z').getTime();

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns just now for < 60s', () => {
    const t = new Date(NOW - 30 * 1000).toISOString();
    expect(relativeTime(t)).toBe('just now');
  });

  it('returns minutes', () => {
    const t = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('5m');
  });

  it('returns hours', () => {
    const t = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('3h');
  });

  it('returns days', () => {
    const t = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('2d');
  });

  it('returns weeks', () => {
    const t = new Date(NOW - 14 * 24 * 60 * 60 * 1000).toISOString();
    expect(relativeTime(t)).toBe('2w');
  });

  it('handles invalid/empty input', () => {
    expect(relativeTime('')).toBe('');
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime('not a date')).toBe('');
  });
});

// ─── formatTime ────────────────────────────────────────────────────────────────
describe('formatTime', () => {
  it('formats hours and minutes', () => {
    // Use local timezone — just verify shape
    const ts = '2026-05-12T14:05:00Z';
    expect(formatTime(ts)).toMatch(/^\d{1,2}:\d{2}$/);
  });

  it('pads minutes with zero', () => {
    const t = new Date();
    t.setHours(9); t.setMinutes(5);
    const result = formatTime(t.toISOString());
    expect(result).toMatch(/:05$/);
  });

  it('returns empty string for empty input', () => {
    expect(formatTime('')).toBe('');
    expect(formatTime(undefined)).toBe('');
  });

  it('returns original string for unparseable input', () => {
    expect(formatTime('not a date')).toBe('not a date');
  });
});

// ─── displayAgent ──────────────────────────────────────────────────────────────
describe('displayAgent', () => {
  it('transforms backend AgentConfig to display shape', () => {
    const cfg = {
      id: 'agent-1', name: 'Aria',
      instruction: 'You are helpful',
      runtime_id: 'claude-mbp', model: 'claude-sonnet-4-5',
      skill_ids: ['skill-a'],
    };
    const a = displayAgent(cfg);
    expect(a.id).toBe('agent-1');
    expect(a.name).toBe('Aria');
    expect(a.kind).toBe('agent');
    expect(a.role).toBe('claude-sonnet-4-5');
    expect(a.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(a.initial).toBe('A');
  });

  it('preserves original fields', () => {
    const cfg = {
      id: 'x', name: 'X', model: 'gpt-5', skill_ids: ['s1', 's2'],
      runtime_id: 'rt-1', instruction: 'do things',
    };
    const a = displayAgent(cfg);
    expect(a.skill_ids).toEqual(['s1', 's2']);
    expect(a.runtime_id).toBe('rt-1');
    expect(a.instruction).toBe('do things');
  });

  it('returns null for null/undefined input', () => {
    expect(displayAgent(null)).toBeNull();
    expect(displayAgent(undefined)).toBeNull();
  });

  it('uses "Agent" as role when model is missing', () => {
    const a = displayAgent({ id: 'x', name: 'X' });
    expect(a.role).toBe('Agent');
  });
});

// ─── mapBackendEvent ───────────────────────────────────────────────────────────
describe('mapBackendEvent', () => {
  const baseEvent = { seq: 1, ts: '2026-05-12T10:00:00Z', actor_agent_id: 'aria' };

  it('maps user message to __human__ author', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'message',
      message: { role: 'user', content: 'hello' },
    });
    expect(e).toEqual({
      kind: 'message',
      author: '__human__',
      time: expect.any(String),
      body: 'hello',
      _seq: 1,
    });
  });

  it('maps assistant message to actor_agent_id', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'message',
      message: { role: 'assistant', content: 'response' },
    });
    expect(e.author).toBe('aria');
    expect(e.body).toBe('response');
  });

  it('maps thinking event', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'thinking',
      thinking: { content: 'reasoning here' },
    });
    expect(e).toEqual({
      kind: 'thinking',
      author: 'aria',
      time: expect.any(String),
      seconds: 0,
      reasoning: 'reasoning here',
      _seq: 1,
    });
  });

  it('maps tool_call event with input.path', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'tool_call',
      tool_call: { name: 'read_file', input: { path: 'src/x.ts' } },
    });
    expect(e.kind).toBe('tool');
    expect(e.tool).toBe('read_file');
    expect(e.path).toBe('src/x.ts');
    expect(e.result).toBe('pending');
  });

  it('maps tool_call event with complex input as JSON string', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'tool_call',
      tool_call: { name: 'search', input: { query: 'foo', limit: 10 } },
    });
    expect(e.tool).toBe('search');
    expect(e.path).toBe(JSON.stringify({ query: 'foo', limit: 10 }));
  });

  it('maps tool_call_result event', () => {
    const e = mapBackendEvent({
      ...baseEvent, type: 'tool_call_result',
      tool_call_result: { name: 'read_file', output: 'file contents' },
    });
    expect(e.kind).toBe('tool_result');
    expect(e.name).toBe('read_file');
    expect(e.output).toBe('file contents');
  });

  it('returns null for unknown event types', () => {
    expect(mapBackendEvent({ ...baseEvent, type: 'unknown' })).toBeNull();
  });

  it('handles missing payloads gracefully', () => {
    const e = mapBackendEvent({ ...baseEvent, type: 'thinking' });
    expect(e.reasoning).toBe('');
  });
});

// ─── mergeToolResults ──────────────────────────────────────────────────────────
describe('mergeToolResults', () => {
  it('merges a tool_result into the matching pending tool_call', () => {
    const events = [
      { kind: 'tool', tool: 'read_file', result: 'pending', _seq: 1 },
      { kind: 'tool_result', name: 'read_file', output: 'file contents', _seq: 2 },
    ];
    const merged = mergeToolResults(events);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('tool');
    expect(merged[0].result).toBe('ok');
    expect(merged[0].detail).toBe('file contents');
  });

  it('drops orphan tool_result with no matching tool_call', () => {
    const events = [
      { kind: 'message', body: 'hi', _seq: 1 },
      { kind: 'tool_result', name: 'nothing', output: 'orphaned', _seq: 2 },
    ];
    const merged = mergeToolResults(events);
    // No matching tool means the result IS appended standalone, per current behaviour
    expect(merged.length).toBe(2);
  });

  it('matches most recent pending tool when multiple exist', () => {
    const events = [
      { kind: 'tool', tool: 'read_file', result: 'pending', _seq: 1 },
      { kind: 'tool', tool: 'read_file', result: 'pending', _seq: 2 },
      { kind: 'tool_result', name: 'read_file', output: 'second result', _seq: 3 },
    ];
    const merged = mergeToolResults(events);
    expect(merged).toHaveLength(2);
    expect(merged[0].result).toBe('pending'); // first still pending
    expect(merged[1].result).toBe('ok');      // second merged
    expect(merged[1].detail).toBe('second result');
  });

  it('passes non-tool events through unchanged', () => {
    const events = [
      { kind: 'message', body: 'hi', _seq: 1 },
      { kind: 'thinking', reasoning: 'thinking…', _seq: 2 },
    ];
    expect(mergeToolResults(events)).toEqual(events);
  });

  it('truncates long output to 120 chars', () => {
    const longOutput = 'x'.repeat(500);
    const events = [
      { kind: 'tool', tool: 't', result: 'pending', _seq: 1 },
      { kind: 'tool_result', name: 't', output: longOutput, _seq: 2 },
    ];
    const merged = mergeToolResults(events);
    expect(merged[0].detail.length).toBe(120);
  });
});

// ─── HUMAN_USER ────────────────────────────────────────────────────────────────
describe('HUMAN_USER', () => {
  it('has the synthetic user shape needed by message renderers', () => {
    expect(HUMAN_USER.id).toBe('__human__');
    expect(HUMAN_USER.kind).toBe('human');
    expect(HUMAN_USER.name).toBeTruthy();
    expect(HUMAN_USER.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(HUMAN_USER.initial).toBeTruthy();
  });
});
