import { describe, it, expect } from 'vitest';
import { runtimeIconUrl } from '../runtime-icons/index.js';

describe('runtimeIconUrl', () => {
  it('resolves product icons by provider first', () => {
    const url = runtimeIconUrl({ provider: 'claude', id: 'qwen' });

    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(url).toContain('Claude%20Code');
    expect(url).not.toContain('Qwen');
  });

  it('falls back to runtime id when provider is missing', () => {
    const url = runtimeIconUrl({ id: 'qwen' });

    expect(url).toMatch(/^data:image\/svg\+xml/);
    expect(url).toContain('Qwen');
  });

  it('returns null for unknown or empty runtimes so callers can render a letter fallback', () => {
    expect(runtimeIconUrl({ provider: 'unknown', id: 'missing' })).toBeNull();
    expect(runtimeIconUrl(null)).toBeNull();
  });
});
