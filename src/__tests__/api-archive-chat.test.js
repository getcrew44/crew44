import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../rpc-client.js', () => ({
  rpc: { call: vi.fn() },
}));

import { archiveChat } from '../api.js';
import { rpc } from '../rpc-client.js';

beforeEach(() => {
  vi.clearAllMocks();
  rpc.call.mockResolvedValue({ ok: true });
});

describe('api.archiveChat', () => {
  it('routes to chats.update with an ISO archived_at timestamp and the chat id', async () => {
    const before = Date.now();
    await archiveChat('chat-42');
    const after = Date.now();

    expect(rpc.call).toHaveBeenCalledTimes(1);
    const [method, params] = rpc.call.mock.calls[0];
    expect(method).toBe('chats.update');
    expect(params.id).toBe('chat-42');
    expect(typeof params.archived_at).toBe('string');
    // ISO 8601 with the `Z` suffix.
    expect(params.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const sentTs = Date.parse(params.archived_at);
    expect(sentTs).toBeGreaterThanOrEqual(before);
    expect(sentTs).toBeLessThanOrEqual(after);
  });
});
