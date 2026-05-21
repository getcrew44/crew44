import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App.jsx';
import * as api from '../api.js';
import { playDoneSound } from '../audio.js';

vi.mock('../api.js', () => ({
  listProjects: vi.fn(),
  listAgents: vi.fn(),
  listSkills: vi.fn(),
  listRuntimes: vi.fn(),
  listProjectChats: vi.fn(),
  listChats: vi.fn(),
  listRemoteDevices: vi.fn(),
  getOnboardingStatus: vi.fn(),
  completeOnboarding: vi.fn(),
  getChat: vi.fn(),
  postMessage: vi.fn(),
  cancelChat: vi.fn(),
  streamChatEvents: vi.fn(),
  getProjectGitDiff: vi.fn(),
  listProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
}));

vi.mock('../audio.js', () => ({
  primeAudioContext: vi.fn(),
  playDoneSound: vi.fn(),
}));

const project = {
  id: 'p1',
  name: 'demo-project',
  workdir: '/tmp/p1',
  main_agent_id: 'agent-1',
};

const runningChat = {
  id: 'chat-running',
  title: 'busy task',
  project_id: 'p1',
  main_agent_id: 'agent-1',
  current_agent_id: 'agent-1',
  participant_agent_ids: ['agent-1'],
  status: 'active',
  created_at: '2026-05-12T10:00:00Z',
  updated_at: '2026-05-12T10:00:00Z',
  stream: { status: 'streaming' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listProjects.mockResolvedValue([project]);
  api.listAgents.mockResolvedValue([
    { id: 'agent-1', name: 'Aria', kind: 'agent', runtime_id: 'runtime-1' },
  ]);
  api.listSkills.mockResolvedValue([]);
  api.listRuntimes.mockResolvedValue([{ id: 'runtime-1', name: 'Test Desk' }]);
  api.listProjectChats.mockResolvedValue([runningChat]);
  api.listRemoteDevices.mockResolvedValue([]);
  api.getOnboardingStatus.mockResolvedValue({ onboarding_required: false });
  api.getChat.mockResolvedValue(runningChat);
  api.streamChatEvents.mockImplementation(() => vi.fn());
  api.getProjectGitDiff.mockResolvedValue([]);
  api.listProjectFiles.mockResolvedValue([]);
  api.readProjectFile.mockResolvedValue({ path: '', content: '', size: 0, truncated: false, binary: false });
  playDoneSound.mockClear();
});

describe('App streaming reconciliation', () => {
  it('keeps the sidebar running indicator after navigating away, then clears it via background reconciliation', async () => {
    // Capture the 5s reconcile interval the App installs.
    const realSetInterval = global.setInterval;
    const reconcileCallbacks = [];
    const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb, delay) => {
      if (delay === 5000) {
        reconcileCallbacks.push(cb);
        return -1;
      }
      return realSetInterval(cb, delay);
    });

    try {
      render(<App />);

      // Open the running chat — TaskView mounts and marks streaming=true.
      const chatItem = await screen.findByTestId('chat-chat-running');
      fireEvent.click(chatItem);

      // Sidebar shows the running spinner (an <svg/> inside the chat row).
      await waitFor(() => {
        const item = screen.getByTestId('chat-chat-running');
        expect(item.querySelector('svg')).toBeTruthy();
      });

      // The reconciliation poll should be installed once we're streaming.
      await waitFor(() => expect(reconcileCallbacks.length).toBeGreaterThan(0));

      // Navigate away — TaskView unmounts. The indicator must NOT disappear.
      fireEvent.click(screen.getByText(/New task/i));
      await waitFor(() => {
        const item = screen.getByTestId('chat-chat-running');
        expect(item.querySelector('svg')).toBeTruthy();
      });

      // Now the backend reports the chat as no longer streaming.
      api.getChat.mockResolvedValue({ ...runningChat, stream: { status: 'idle' } });

      // Fire the captured reconcile tick — override should clear, spinner gone.
      await act(async () => {
        await Promise.all(reconcileCallbacks.map(cb => cb()));
      });
      await waitFor(() => {
        const item = screen.getByTestId('chat-chat-running');
        expect(item.querySelector('svg')).toBeFalsy();
      });
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('plays the done sound when a background running chat finishes', async () => {
    const realSetInterval = global.setInterval;
    const reconcileCallbacks = [];
    const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb, delay) => {
      if (delay === 5000) {
        reconcileCallbacks.push(cb);
        return -1;
      }
      return realSetInterval(cb, delay);
    });

    try {
      render(<App />);

      const chatItem = await screen.findByTestId('chat-chat-running');
      fireEvent.click(chatItem);

      await waitFor(() => expect(reconcileCallbacks.length).toBeGreaterThan(0));
      fireEvent.click(screen.getByText(/New task/i));

      api.getChat.mockResolvedValue({ ...runningChat, stream: { status: 'idle' } });

      await act(async () => {
        await Promise.all(reconcileCallbacks.map(cb => cb()));
      });

      expect(playDoneSound).toHaveBeenCalledOnce();
    } finally {
      intervalSpy.mockRestore();
    }
  });
});
