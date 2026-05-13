import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../App.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  listProjects: vi.fn(),
  listAgents: vi.fn(),
  listSkills: vi.fn(),
  listRuntimes: vi.fn(),
  listProjectChats: vi.fn(),
  deleteProject: vi.fn(),
}));

const project = {
  id: 'p1',
  name: 'first-project',
  workdir: '/tmp/p1',
  main_agent_id: 'agent-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('crewai.onboardingComplete', '1');
  api.listProjects.mockResolvedValue([project]);
  api.listAgents.mockResolvedValue([
    { id: 'agent-1', name: 'Agent One', kind: 'agent', runtime_id: 'runtime-1' },
  ]);
  api.listSkills.mockResolvedValue([]);
  api.listRuntimes.mockResolvedValue([{ id: 'runtime-1', name: 'Test Desk' }]);
  api.listProjectChats.mockResolvedValue([]);
  api.deleteProject.mockResolvedValue({ ok: true });
});

describe('App project removal', () => {
  it('deletes and refreshes a project from the sidebar Remove menu item', async () => {
    render(<App />);

    await screen.findByText('first-project');

    const projectLabel = screen.getByText('first-project');
    const projectContainer = projectLabel.parentElement.parentElement;
    const [menuButton] = projectContainer.querySelectorAll('button');

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByText('Remove'));

    await waitFor(() => expect(api.deleteProject).toHaveBeenCalledWith('p1'));
    expect(api.listProjects).toHaveBeenCalledTimes(2);
  });
});
