import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CrewRoute from '../CrewRoute.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  rescanRuntimes: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  archiveAgent: vi.fn(),
  listPresets: vi.fn(() => Promise.resolve([])),
  seedDefaultCrew: vi.fn(),
  resetDefaultCrew: vi.fn(),
  resetAgentPreset: vi.fn(),
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('guides users to install a runtime when no agents or runtimes exist', () => {
    render(<CrewRoute
      {...baseProps}
      initialTab="agents"
      agents={[]}
      runtimes={[]}
    />);

    expect(screen.getByText('Install a runtime to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View runtimes' })).toBeInTheDocument();
    expect(screen.queryByText('No agents yet. Create one to get started.')).not.toBeInTheDocument();
  });

  it('does not append ago when the agent was updated just now', () => {
    const now = new Date('2026-05-13T07:10:32Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        updated_at: new Date(now - 30 * 1000).toISOString(),
      }]}
    />);

    expect(screen.getByText('Updated just now')).toBeInTheDocument();
    expect(screen.queryByText('Updated just now ago')).not.toBeInTheDocument();
  });

  it('shows the runtime name as quiet metadata without a label or badge', () => {
    render(<CrewRoute
      {...agentProps}
      runtimes={[{
        id: 'claude-code',
        name: 'Claude Code',
        provider: 'claude',
        status: 'available',
      }]}
      agents={[{
        ...agentProps.agents[0],
        runtime_id: 'claude-code',
      }]}
    />);

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByText('Runtime')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
  });

  it('shows preset reset completion through the app toast instead of an inline page message', async () => {
    const onToast = vi.fn();
    const onDataRefresh = vi.fn();
    api.resetAgentPreset.mockResolvedValue({ reset_agents: ['planning'], reset_skills: [] });

    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        preset_key: 'planning',
      }]}
      onDataRefresh={onDataRefresh}
      onToast={onToast}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Agent options' }));
    fireEvent.click(screen.getByText('Reset to factory version'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to factory' }));

    await waitFor(() => {
      expect(api.resetAgentPreset).toHaveBeenCalledWith('agent-1');
      expect(onToast).toHaveBeenCalledWith('Reset "Planning Agent" to factory version.');
      expect(onDataRefresh).toHaveBeenCalledOnce();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not offer removal for the partner preset agent', () => {
    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        name: 'Partner',
        preset_id: 'default-crew',
        preset_key: 'partner',
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Agent options' }));

    expect(screen.getByText('Reset to factory version')).toBeInTheDocument();
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });

  it('does not show the detail delete action for the partner preset agent', () => {
    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        name: 'Partner',
        preset_id: 'default-crew',
        preset_key: 'partner',
      }]}
    />);

    fireEvent.click(screen.getByText('Partner'));

    expect(screen.queryByRole('button', { name: 'Delete agent' })).not.toBeInTheDocument();
  });

  it.each([
    ['coding', 'Coding Agent'],
    ['product', 'Product Agent'],
    ['designer', 'Designer'],
  ])('offers removal for the %s preset agent', (presetKey, name) => {
    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        name,
        preset_id: 'default-crew',
        preset_key: presetKey,
      }]}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Agent options' }));

    expect(screen.getByText('Remove')).toBeInTheDocument();
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

  it('shows auto when an agent does not pin a model', () => {
    render(<CrewRoute
      {...agentProps}
      agents={[{
        ...agentProps.agents[0],
        model: '',
      }]}
    />);

    fireEvent.click(screen.getByText('Planning Agent'));

    expect(screen.getAllByText('auto')).toHaveLength(2);
    expect(screen.queryByText('No model')).not.toBeInTheDocument();
  });

  it('sizes the instruction editor to its content up to a maximum height', () => {
    render(<CrewRoute {...agentProps} />);

    fireEvent.click(screen.getByText('Planning Agent'));

    const editor = screen.getByTestId('agent-instruction-input');
    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 72 });

    fireEvent.change(editor, { target: { value: 'Short instruction.' } });
    expect(editor).toHaveStyle({ height: '72px', overflowY: 'hidden' });

    Object.defineProperty(editor, 'scrollHeight', { configurable: true, value: 900 });

    fireEvent.change(editor, { target: { value: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n') } });
    expect(editor).toHaveStyle({ height: '560px', overflowY: 'auto' });
  });
});
