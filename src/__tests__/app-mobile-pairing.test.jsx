import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  listProjects: vi.fn(),
  listAgents: vi.fn(),
  listSkills: vi.fn(),
  listRuntimes: vi.fn(),
  listProjectChats: vi.fn(),
  listRemoteDevices: vi.fn(),
  getOnboardingStatus: vi.fn(),
  getGitInfo: vi.fn(),
  completeOnboarding: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  api.listProjects.mockResolvedValue([]);
  api.listAgents.mockResolvedValue([
    { id: 'agent-1', name: 'Agent One', kind: 'agent', runtime_id: 'runtime-1' },
  ]);
  api.listSkills.mockResolvedValue([]);
  api.listRuntimes.mockResolvedValue([{ id: 'runtime-1', name: 'Test Desk' }]);
  api.listProjectChats.mockResolvedValue([]);
  api.listRemoteDevices.mockResolvedValue([]);
  api.getGitInfo.mockResolvedValue({ is_git_repo: false });
  api.getOnboardingStatus.mockResolvedValue({
    last_onboarding_version: '1',
    onboarding_required: false,
  });
  api.completeOnboarding.mockResolvedValue({
    last_onboarding_version: '1',
    onboarding_required: false,
  });
});

describe('App mobile pairing launch behavior', () => {
  it('does not auto-open the pair mobile dialog on startup', async () => {
    render(<App />);

    await screen.findByText('No projects yet');

    expect(screen.queryByTestId('create-mobile-pairing')).not.toBeInTheDocument();
    expect(screen.queryByText('No mobile devices are paired.')).not.toBeInTheDocument();
  });
});
