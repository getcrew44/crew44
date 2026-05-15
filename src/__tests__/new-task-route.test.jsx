import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewTaskRoute from '../NewTaskRoute.jsx';
import * as api from '../api.js';
import { writeLastNewChatProjectId } from '../draftStore.js';

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
  api.createChat.mockResolvedValue({ id: 'chat-1', main_agent_id: 'a1' });
  api.postMessage.mockResolvedValue({});
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

  it('suggests and highlights agents after @ in the new task input', async () => {
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    const input = screen.getByTestId('new-task-input');
    fireEvent.change(input, { target: { value: '@br', selectionStart: 3, selectionEnd: 3 } });

    const option = await screen.findByRole('option', { name: /Bryn/i });
    fireEvent.click(option);

    expect(input).toHaveValue('@Bryn ');
    expect(screen.getByTestId('composer-mention-highlight')).toHaveTextContent('@Bryn');
  });

  it('requires an explicit project selection before starting', async () => {
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId=""
      />
    );

    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'ship this task' },
    });

    const start = screen.getByTestId('start-crew-button');
    expect(screen.getByText('Pick a project')).toBeInTheDocument();
    expect(start).toBeDisabled();
    fireEvent.click(start);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.createChat).not.toHaveBeenCalled();
    expect(api.postMessage).not.toHaveBeenCalled();
  });

  it('uses the remembered last new task project when it still exists', () => {
    writeLastNewChatProjectId('p2');

    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId=""
      />
    );

    expect(screen.getByText('Second Project')).toBeInTheDocument();
    expect(screen.getByTestId('start-crew-button')).toBeDisabled();
  });

  it('clears a remembered project when that project no longer exists', () => {
    writeLastNewChatProjectId('missing-project');

    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId=""
      />
    );

    expect(screen.getByText('Pick a project')).toBeInTheDocument();
    expect(window.localStorage.getItem('crewai-composer-draft:v1:new-chat-project')).toBeNull();
  });

  it('starts in the selected project after the user picks one', async () => {
    const onNewTask = vi.fn();
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={onNewTask}
        initialProjectId=""
      />
    );

    fireEvent.click(screen.getByText('Pick a project'));
    fireEvent.click(await screen.findByText('Second Project'));
    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'ship this task' },
    });
    fireEvent.click(screen.getByTestId('start-crew-button'));

    await waitFor(() => expect(api.createChat).toHaveBeenCalledOnce());
    expect(api.createChat).toHaveBeenCalledWith('p2', 'ship this task', 'a1');
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'ship this task', 'a1');
    expect(onNewTask).toHaveBeenCalledWith('chat-1');
  });
});
