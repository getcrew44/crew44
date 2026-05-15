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
  window.electronAPI = {
    openFileDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    getPathForFile: vi.fn(file => file?.name ? `/Users/me/${file.name}` : ''),
    getPathInfo: vi.fn().mockImplementation(async (paths) => paths.map(path => ({
      path,
      name: path.split('/').pop(),
      isDirectory: false,
    }))),
    readFileDataURL: vi.fn().mockResolvedValue('data:image/png;base64,input-image'),
  };
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

  it('anchors new task mention suggestions to the @ caret line', async () => {
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    const input = screen.getByTestId('new-task-input');
    fireEvent.change(input, { target: { value: '@a', selectionStart: 2, selectionEnd: 2 } });

    const listbox = await screen.findByRole('listbox', { name: /agent suggestions/i });
    expect(listbox.style.top).not.toBe('');
    expect(listbox.style.top).not.toBe('calc(100% + 8px)');
    expect(listbox.style.bottom).toBe('');
    expect(listbox.style.width).toBe('260px');
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
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'ship this task', 'a1', []);
    expect(onNewTask).toHaveBeenCalledWith('chat-1');
  });

  it('selects an attachment for a new task and sends attachment metadata', async () => {
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/proxy.txt'],
    });
    const onNewTask = vi.fn();
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={onNewTask}
        initialProjectId="p1"
      />
    );

    fireEvent.click(screen.getByTestId('new-task-attach'));
    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('proxy.txt');
    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'inspect this' },
    });
    fireEvent.click(screen.getByTestId('start-crew-button'));

    await waitFor(() => expect(api.createChat).toHaveBeenCalledOnce());
    expect(api.createChat).toHaveBeenCalledWith('p1', 'inspect this', 'a1');
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'inspect this', 'a1', [
      { display_name: 'proxy.txt', path: '/Users/me/proxy.txt', kind: 'file' },
    ]);
    expect(onNewTask).toHaveBeenCalledWith('chat-1');
  });

  it('accepts dropped file attachments in the new task composer', async () => {
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(screen.getByTestId('new-task-input'), {
      dataTransfer: {
        types: ['Files'],
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
      },
    });

    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('notes.txt');
    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'from drop' },
    });
    fireEvent.click(screen.getByTestId('start-crew-button'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'from drop', 'a1', [
      { display_name: 'notes.txt', path: '/Users/me/notes.txt', kind: 'file' },
    ]);
  });

  it('can start an attachment-only new task with the file name as the title', async () => {
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/proxy.txt'],
    });
    render(
      <NewTaskRoute
        projects={projects}
        agents={agents}
        onNewTask={() => {}}
        initialProjectId="p1"
      />
    );

    fireEvent.click(screen.getByTestId('new-task-attach'));
    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('proxy.txt');
    fireEvent.click(screen.getByTestId('start-crew-button'));

    await waitFor(() => expect(api.createChat).toHaveBeenCalledOnce());
    expect(api.createChat).toHaveBeenCalledWith('p1', 'proxy.txt', 'a1');
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', '', 'a1', [
      { display_name: 'proxy.txt', path: '/Users/me/proxy.txt', kind: 'file' },
    ]);
  });
});
