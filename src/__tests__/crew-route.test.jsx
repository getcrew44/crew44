import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CrewRoute from '../CrewRoute.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  rescanRuntimes: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  archiveAgent: vi.fn(),
}));

const baseProps = {
  agents: [],
  agentsMap: {},
  skills: [],
  runtimes: [
    {
      id: 'codex',
      name: 'Codex',
      provider: 'codex',
      status: 'available',
      version: '1.0.0',
    },
  ],
  initialTab: 'runtimes',
};

const agentProps = {
  ...baseProps,
  initialTab: 'agents',
  agents: [
    {
      id: 'agent-1',
      name: 'Planning Agent',
      kind: 'agent',
      runtime_id: 'codex',
      model: 'gpt-test',
      instruction: 'Plan the work.',
      skill_ids: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      color: '#C4644A',
      initial: 'P',
    },
  ],
};

describe('CrewRoute runtimes tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.rescanRuntimes.mockResolvedValue({});
  });

  it('uses Rescan as the runtimes action and removes per-runtime overflow controls', async () => {
    const onDataRefresh = vi.fn();
    const onToast = vi.fn();
    const { container } = render(<CrewRoute {...baseProps} onDataRefresh={onDataRefresh} onToast={onToast} />);

    expect(screen.getByRole('button', { name: 'Rescan' })).toBeInTheDocument();
    expect(screen.queryByText('+ Add runtime')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('···');

    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }));

    await waitFor(() => expect(api.rescanRuntimes).toHaveBeenCalledOnce());
    expect(onDataRefresh).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith('Runtimes refreshed.');
  });
});

describe('CrewRoute agents tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the same content width and page spacing as the new task page', () => {
    render(<CrewRoute {...agentProps} />);

    expect(screen.getByTestId('crew-route-shell')).toHaveStyle({
      paddingTop: '60px',
      paddingLeft: '36px',
      paddingRight: '36px',
    });

    const content = screen.getByTestId('crew-route-content');
    expect(content).toHaveStyle({
      maxWidth: '720px',
      margin: '0px auto',
    });
    expect(content.style.paddingLeft).toBe('');
    expect(content.style.paddingRight).toBe('');
  });
});

describe('CrewRoute agent detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('centers the detail content like the agents list and shows the breadcrumb header', () => {
    const { container } = render(<CrewRoute {...agentProps} />);

    fireEvent.click(screen.getByText('Planning Agent'));

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(container.textContent).toContain('\u203a');

    expect(screen.getByTestId('agent-detail-content')).toHaveStyle({
      maxWidth: '720px',
      margin: '0px auto',
    });
  });
});
