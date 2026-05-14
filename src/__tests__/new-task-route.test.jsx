import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewTaskRoute from '../NewTaskRoute.jsx';

vi.mock('../api.js', () => ({
  createChat: vi.fn(),
  postMessage: vi.fn(),
}));

const projects = [
  { id: 'p1', name: 'First Project' },
  { id: 'p2', name: 'Second Project' },
];

const agents = [
  { id: 'a1', name: 'Aria' },
  { id: 'a2', name: 'Bryn' },
];

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('NewTaskRoute', () => {
  it('selects a newly provided initial project', () => {
    const { rerender } = render(
      <NewTaskRoute
        projects={[projects[0]]}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId=""
      />
    );

    expect(screen.getByText('Pick a project')).toBeInTheDocument();

    rerender(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p2"
      />
    );

    expect(screen.getByText('Second Project')).toBeInTheDocument();
  });

  it('restores the new-chat text draft for the selected project', () => {
    const { unmount } = render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'draft this launch plan' },
    });
    unmount();

    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    expect(screen.getByTestId('new-task-input')).toHaveValue('draft this launch plan');
  });
});
