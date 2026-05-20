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
  listRemoteDevices: vi.fn(),
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  archiveChat: vi.fn(),
  createChat: vi.fn(),
  postMessage: vi.fn(),
  getChat: vi.fn(),
  streamChatEvents: vi.fn(),
  cancelChat: vi.fn(),
  listProjectFiles: vi.fn(),
  // archiveChat() builds an ISO timestamp via updateChat under the hood; the
  // App-level handler only awaits the wrapper, so we mock the wrapper directly.
}));

const project = {
  id: 'p1',
  name: 'first-project',
  workdir: '/tmp/p1',
  main_agent_id: 'agent-1',
};

const chats = [
  { id: 'c1', title: 'chat one', status: 'active', updated_at: '2026-05-12T10:00:00Z' },
  { id: 'c2', title: 'chat two', status: 'active', updated_at: '2026-05-12T09:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.listProjects.mockResolvedValue([project]);
  api.listAgents.mockResolvedValue([
    { id: 'agent-1', name: 'Agent One', kind: 'agent', runtime_id: 'runtime-1' },
  ]);
  api.listSkills.mockResolvedValue([]);
  api.listRuntimes.mockResolvedValue([{ id: 'runtime-1', name: 'Test Desk' }]);
  api.listProjectChats.mockResolvedValue(chats);
  api.listRemoteDevices.mockResolvedValue([]);
  api.getOnboardingStatus.mockResolvedValue({
    last_onboarding_version: '1',
    onboarding_required: false,
  });
  api.completeOnboarding.mockResolvedValue({
    last_onboarding_version: '1',
    onboarding_required: false,
  });
  api.archiveChat.mockResolvedValue({ ok: true });
  api.createChat.mockResolvedValue({
    id: 'c3',
    title: 'new task',
    project_id: 'p1',
    main_agent_id: 'agent-1',
  });
  api.postMessage.mockResolvedValue({ ok: true });
  api.getChat.mockResolvedValue({
    id: 'c3',
    title: 'new task',
    project_id: 'p1',
    main_agent_id: 'agent-1',
    current_agent_id: 'agent-1',
    participant_agent_ids: ['agent-1'],
    status: 'active',
    created_at: '2026-05-12T11:00:00Z',
    updated_at: '2026-05-12T11:00:00Z',
    stream: { status: 'idle' },
  });
  api.streamChatEvents.mockImplementation((_chatId, _after, _onEvent, onDone) => {
    onDone?.();
    return vi.fn();
  });
  api.cancelChat.mockResolvedValue({});
  api.listProjectFiles.mockResolvedValue([]);
});

describe('App archive chat handler', () => {
  it('keeps chats whose archived_at is the backend zero time', async () => {
    api.listProjectChats.mockResolvedValue([
      {
        id: 'c-zero',
        title: 'zero archived chat',
        status: 'active',
        updated_at: '2026-05-12T10:00:00Z',
        archived_at: '0001-01-01T00:00:00Z',
      },
    ]);

    render(<App />);

    expect(await screen.findByText('zero archived chat')).toBeInTheDocument();
  });

  it('calls api.archiveChat and removes the chat from the sidebar list', async () => {
    render(<App />);

    // Wait for both chats to render in the sidebar.
    await screen.findByText('chat one');
    expect(screen.getByText('chat two')).toBeInTheDocument();

    const session = screen.getByTestId('chat-c1');
    fireEvent.mouseEnter(session);
    fireEvent.click(screen.getByTitle('Archive chat'));
    fireEvent.click(screen.getByTitle('Confirm archive'));

    await waitFor(() => expect(api.archiveChat).toHaveBeenCalledWith('c1'));
    // Optimistic local update — the archived chat disappears without a refetch.
    await waitFor(() => expect(screen.queryByText('chat one')).not.toBeInTheDocument());
    expect(screen.getByText('chat two')).toBeInTheDocument();
  });

  it('does not resurrect an archived chat when a stale refresh returns it later', async () => {
    api.listProjectChats
      .mockResolvedValueOnce(chats)
      .mockResolvedValueOnce(chats);

    render(<App />);

    await screen.findByText('chat one');

    const session = screen.getByTestId('chat-c1');
    fireEvent.mouseEnter(session);
    fireEvent.click(screen.getByTitle('Archive chat'));
    fireEvent.click(screen.getByTitle('Confirm archive'));

    await waitFor(() => expect(api.archiveChat).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByText('chat one')).not.toBeInTheDocument());

    // NewTaskRoute requires an explicit project selection before the Start
    // button enables; the merged-in attachments work removed the implicit
    // "first project wins" fallback.
    fireEvent.click(screen.getByText('Pick a project'));
    const options = await screen.findAllByText('first-project');
    // First match is the sidebar label; the picker dropdown option is the second.
    fireEvent.click(options[options.length - 1]);
    fireEvent.change(screen.getByTestId('new-task-input'), {
      target: { value: 'start another task' },
    });
    fireEvent.click(screen.getByTestId('start-crew-button'));

    await waitFor(() => expect(api.listProjectChats).toHaveBeenCalledTimes(2));

    expect(screen.queryByText('chat one')).not.toBeInTheDocument();
  });
});
