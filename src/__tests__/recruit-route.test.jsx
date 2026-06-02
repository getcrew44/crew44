import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RecruitRoute from '../RecruitRoute.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  listRecruitAgents: vi.fn(),
  getRecruitAgent: vi.fn(),
  installRecruitAgent: vi.fn(),
}));

const patchEntry = {
  id: 'patch',
  name: 'Patch',
  description: 'Reproduces bugs from reports and writes the failing test first.',
  author: 'hex.studio',
  repo_url: 'https://github.com/hex/patch-agent',
  tags: ['testing'],
  installs: 3200,
  stars: 3400,
  trending: true,
  icon: { initial: 'P', color: '#B8553E' },
  installed: false,
};

const patchDetail = {
  entry: patchEntry,
  manifest: {
    schema_version: 'crew44.agent.v1',
    name: 'Patch',
    version: '1.2.0',
    description: 'Reproduces bugs from reports.',
    suggested_runtime: 'claude',
    skills: [{ name: 'minimal-failing-test', path: 'skills/minimal-failing-test/SKILL.md' }],
  },
  agent_body: '# Patch\nReproduces bugs from reports.\n',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RecruitRoute', () => {
  it('renders the Recruit heading and the registry list', async () => {
    api.listRecruitAgents.mockResolvedValue([patchEntry]);
    render(<RecruitRoute onToast={vi.fn()} />);
    expect(await screen.findByText('Patch')).toBeInTheDocument();
    expect(screen.getByText(/Browse agents published by the community/)).toBeInTheDocument();
    expect(screen.getByTestId('recruit-row-patch')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and replaces it with rows on success', async () => {
    let resolve;
    api.listRecruitAgents.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<RecruitRoute onToast={vi.fn()} />);
    expect(screen.getByTestId('recruit-skeleton')).toBeInTheDocument();
    await act(async () => { resolve([patchEntry]); });
    await waitFor(() => expect(screen.queryByTestId('recruit-skeleton')).not.toBeInTheDocument());
    expect(screen.getByTestId('recruit-row-patch')).toBeInTheDocument();
  });

  it('filters the list by the search query', async () => {
    api.listRecruitAgents.mockResolvedValue([
      patchEntry,
      { ...patchEntry, id: 'sage', name: 'Sage', description: 'Reads docs.', tags: ['research'] },
    ]);
    render(<RecruitRoute onToast={vi.fn()} />);
    await screen.findByText('Patch');
    fireEvent.change(screen.getByTestId('recruit-search'), { target: { value: 'sage' } });
    await waitFor(() => {
      expect(screen.queryByTestId('recruit-row-patch')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('recruit-row-sage')).toBeInTheDocument();
  });

  it('shows the error banner and retries on click', async () => {
    api.listRecruitAgents.mockRejectedValueOnce(new Error('network down'));
    render(<RecruitRoute onToast={vi.fn()} />);
    expect(await screen.findByTestId('recruit-error')).toHaveTextContent('network down');
    api.listRecruitAgents.mockResolvedValueOnce([patchEntry]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Patch')).toBeInTheDocument();
  });

  it('opens the detail view, calls the detail RPC, and renders manifest fields', async () => {
    api.listRecruitAgents.mockResolvedValue([patchEntry]);
    api.getRecruitAgent.mockResolvedValue(patchDetail);
    render(<RecruitRoute onToast={vi.fn()} />);
    await screen.findByText('Patch');
    fireEvent.click(screen.getByTestId('recruit-row-patch'));
    await waitFor(() => expect(api.getRecruitAgent).toHaveBeenCalledWith('patch'));
    expect(await screen.findByText('minimal-failing-test')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
  });

  it('back link returns to the list', async () => {
    api.listRecruitAgents.mockResolvedValue([patchEntry]);
    api.getRecruitAgent.mockResolvedValue(patchDetail);
    render(<RecruitRoute onToast={vi.fn()} />);
    await screen.findByText('Patch');
    fireEvent.click(screen.getByTestId('recruit-row-patch'));
    await screen.findByText('minimal-failing-test');
    fireEvent.click(screen.getByTestId('recruit-back'));
    await waitFor(() => expect(screen.getByTestId('recruit-row-patch')).toBeInTheDocument());
  });

  it('installs an agent, flips to the Added badge, toasts, and triggers data refresh', async () => {
    api.listRecruitAgents.mockResolvedValue([patchEntry]);
    api.installRecruitAgent.mockResolvedValue({ id: 'agent-1', name: 'Patch' });
    const toast = vi.fn();
    const refresh = vi.fn();
    render(<RecruitRoute onToast={toast} onDataRefresh={refresh} />);
    await screen.findByText('Patch');
    fireEvent.click(screen.getByTestId('recruit-install-btn'));
    await waitFor(() => expect(api.installRecruitAgent).toHaveBeenCalledWith('patch'));
    await waitFor(() => expect(screen.getByTestId('recruit-installed-badge')).toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith('Patch added to your crew.');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows an error toast when install fails', async () => {
    api.listRecruitAgents.mockResolvedValue([patchEntry]);
    api.installRecruitAgent.mockRejectedValue(new Error('release v1.2.0 not published'));
    const toast = vi.fn();
    render(<RecruitRoute onToast={toast} />);
    await screen.findByText('Patch');
    fireEvent.click(screen.getByTestId('recruit-install-btn'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('release v1.2.0 not published'));
    // Install button is not flipped to the Added badge on failure.
    expect(screen.queryByTestId('recruit-installed-badge')).not.toBeInTheDocument();
  });

  it('marks already-installed entries with the Added badge on first render', async () => {
    api.listRecruitAgents.mockResolvedValue([{ ...patchEntry, installed: true }]);
    render(<RecruitRoute onToast={vi.fn()} />);
    expect(await screen.findByTestId('recruit-installed-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('recruit-install-btn')).not.toBeInTheDocument();
  });
});
