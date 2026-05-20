import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import TaskView from '../TaskView.jsx';
import * as api from '../api.js';
import { writeComposerDraft } from '../draftStore.js';
import { rememberAgents, __resetSeenAgentsCacheForTests } from '../utils.js';
import { generateImageThumbnail } from '../thumbnail.js';

vi.mock('../api.js', () => ({
  getChat: vi.fn(),
  postMessage: vi.fn(),
  interruptMessage: vi.fn(),
  cancelPendingSteer: vi.fn(),
  deliverPendingSteers: vi.fn(),
  cancelChat: vi.fn(),
  streamChatEvents: vi.fn(),
  listProjectFiles: vi.fn(),
  readProjectFile: vi.fn(),
  getProjectGitDiff: vi.fn(),
}));

vi.mock('../thumbnail.js', () => ({
  generateImageThumbnail: vi.fn(),
}));

const agentsMap = {
  'agent-1': {
    id: 'agent-1',
    name: 'Aria',
    kind: 'agent',
    initial: 'A',
    color: '#C4644A',
  },
  'agent-2': {
    id: 'agent-2',
    name: 'Default Agent',
    kind: 'agent',
    initial: 'D',
    color: '#5B7EDB',
  },
  'agent-3': {
    id: 'agent-3',
    name: 'Coding Agent',
    kind: 'agent',
    initial: 'C',
    color: '#2F79D8',
  },
};

const chat = {
  id: 'chat-1',
  title: 'Demo chat',
  created_at: '2026-05-12T10:00:00Z',
  main_agent_id: 'agent-1',
  current_agent_id: 'agent-1',
  participant_agent_ids: ['agent-1'],
  status: 'active',
  stream: { status: 'idle' },
};

beforeEach(() => {
  __resetSeenAgentsCacheForTests();
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
  generateImageThumbnail.mockResolvedValue('thumb-base64');
  api.getChat.mockResolvedValue(chat);
  api.postMessage.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
  api.interruptMessage.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
  api.cancelPendingSteer.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
  api.deliverPendingSteers.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
  api.cancelChat.mockResolvedValue({});
  api.streamChatEvents.mockImplementation((_chatId, _after, _onEvent, onDone) => {
    onDone?.();
    return vi.fn();
  });
  api.listProjectFiles.mockResolvedValue([]);
  api.readProjectFile.mockResolvedValue({ path: '', content: '', size: 0, truncated: false, binary: false });
  api.getProjectGitDiff.mockResolvedValue([]);
});

function emitEvent(stream, event) {
  return act(async () => {
    stream[2](event);
  });
}

describe('TaskView', () => {
  it('does not show the manual agent mention button in the composer toolbar', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    await screen.findByTestId('composer-input');

    expect(screen.queryByRole('button', { name: '@ @agent' })).not.toBeInTheDocument();
  });

  it('suggests agents after @ and highlights the selected mention in the composer', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    fireEvent.change(input, { target: { value: '@d', selectionStart: 2, selectionEnd: 2 } });

    const option = await screen.findByRole('option', { name: /default agent/i });
    fireEvent.click(option);

    expect(input).toHaveValue('@Default Agent ');
    expect(screen.getByTestId('composer-mention-highlight')).toHaveTextContent('@Default Agent');
  });

  it('keeps highlighted mentions on the same text metrics as the textarea', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    fireEvent.change(input, {
      target: {
        value: '@Coding Agent hhiif dsa321',
        selectionStart: '@Coding Agent hhiif dsa321'.length,
        selectionEnd: '@Coding Agent hhiif dsa321'.length,
      },
    });

    expect(screen.getByTestId('composer-mention-highlight').style.fontWeight).toBe('inherit');
  });

  it('preserves overlay scroll position when auto-resize resets textarea scrollTop', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    const input = await screen.findByTestId('composer-input');

    // Simulate content that overflows max height (>160px)
    Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => 300 });

    // Track scrollTop — initial value simulates cursor scrolled mid-content
    let scrollTopValue = 80;
    Object.defineProperty(input, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v) => { scrollTopValue = Math.max(0, v); },
    });

    // Intercept style.height to simulate browser resetting scrollTop when height='auto'
    Object.defineProperty(input.style, 'height', {
      configurable: true,
      get: () => '',
      set: (v) => { if (v === 'auto') scrollTopValue = 0; },
    });

    await act(async () => {
      fireEvent.change(input, { target: { value: 'a'.repeat(200), selectionStart: 200, selectionEnd: 200 } });
    });

    // The overlay must translate by the restored scrollTop (80), not the reset 0
    const overlay = input.previousElementSibling;
    expect(overlay).not.toBeNull();
    expect(overlay.style.transform).toBe('translateY(-80px)');
  });

  it('deletes a whole mention when backspacing immediately after it', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    const value = '@Coding Agent hhiif dsa321';
    const cursor = '@Coding Agent '.length;
    fireEvent.change(input, {
      target: { value, selectionStart: cursor, selectionEnd: cursor },
    });
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(input).toHaveValue('hhiif dsa321');
  });

  it('selects an attachment, shows a chip, and sends attachment metadata', async () => {
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/proxy.txt'],
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'please inspect' } });
    fireEvent.click(screen.getByTestId('composer-attach'));

    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('proxy.txt');
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'please inspect', 'agent-1', [
      { display_name: 'proxy.txt', path: '/Users/me/proxy.txt', kind: 'file' },
    ]);
  });

  it('accepts dropped file attachments in the composer', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const composer = await screen.findByTestId('composer-column');
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(composer, {
      dataTransfer: {
        types: ['Files'],
        items: [{ kind: 'file', getAsFile: () => file }],
        files: [file],
      },
    });

    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('notes.txt');
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'from drop' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'from drop', 'agent-1', [
      { display_name: 'notes.txt', path: '/Users/me/notes.txt', kind: 'file' },
    ]);
  });

  it('accepts dropped folder attachments in the composer', async () => {
    window.electronAPI.getPathInfo.mockImplementationOnce(async (paths) => paths.map(path => ({
      path,
      name: path.split('/').pop(),
      isDirectory: true,
    })));
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const composer = await screen.findByTestId('composer-column');
    const folder = new File([''], 'Design Kit', { type: '' });
    fireEvent.drop(composer, {
      dataTransfer: {
        types: ['Files'],
        items: [{ kind: 'file', getAsFile: () => folder }],
        files: [folder],
      },
    });

    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('Design Kit');
    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'use this folder' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'use this folder', 'agent-1', [
      { display_name: 'Design Kit', path: '/Users/me/Design Kit', kind: 'folder' },
    ]);
  });

  it('removes an attachment before sending', async () => {
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/proxy.txt'],
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    await screen.findByTestId('composer-input');
    fireEvent.click(screen.getByTestId('composer-attach'));
    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('proxy.txt');

    fireEvent.click(screen.getByLabelText('Remove proxy.txt'));
    expect(screen.queryByTestId('attachment-chip')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'no file' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'no file', 'agent-1', []);
  });

  it('generates image thumbnails for selected image attachments', async () => {
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/screen.png'],
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    await screen.findByTestId('composer-input');
    fireEvent.click(screen.getByTestId('composer-attach'));

    await waitFor(() => expect(generateImageThumbnail).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('attachment-thumbnail')).toHaveAttribute('src', 'data:image/jpeg;base64,thumb-base64');

    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', '', 'agent-1', [
      {
        display_name: 'screen.png',
        path: '/Users/me/screen.png',
        kind: 'image',
        thumbnail_jpeg_base64: 'thumb-base64',
      },
    ]);
  });

  it('marks image attachments when thumbnail generation fails', async () => {
    generateImageThumbnail.mockRejectedValueOnce(new Error('bad image'));
    window.electronAPI.openFileDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/Users/me/screen.png'],
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    await screen.findByTestId('composer-input');
    fireEvent.click(screen.getByTestId('composer-attach'));
    expect(await screen.findByTestId('attachment-chip')).toHaveTextContent('screen.png');

    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', '', 'agent-1', [
      {
        display_name: 'screen.png',
        path: '/Users/me/screen.png',
        kind: 'image',
        thumbnail_failed: true,
      },
    ]);
  });

  it('scrolls the conversation to the bottom when a new message arrives', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const timeline = await screen.findByTestId('conversation-scroll');
    Object.defineProperty(timeline, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(timeline, 'clientHeight', { configurable: true, value: 300 });

    const firstStream = api.streamChatEvents.mock.calls[0];
    await act(async () => {
      firstStream[2]({
        seq: 3,
        type: 'message',
        ts: '2026-05-12T10:02:00Z',
        actor_agent_id: 'agent-1',
        message: { role: 'assistant', content: '新的回复' },
      });
    });

    await waitFor(() => expect(timeline.scrollTop).toBe(900));
  });

  it('moves the running cancel action into the composer stop button', async () => {
    api.getChat.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const stop = await screen.findByRole('button', { name: /stop/i });
    expect(screen.queryByRole('button', { name: /pause crew/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();

    fireEvent.click(stop);

    await waitFor(() => expect(api.cancelChat).toHaveBeenCalledWith('chat-1'));
  });

  it('renders multiple queued steer cards and delivers them from the final card', async () => {
    api.getChat.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
    api.streamChatEvents.mockImplementation(() => vi.fn());
    const queued = [];
    api.interruptMessage.mockImplementation((_chatId, content, attachments = []) => {
      queued.push({ id: `steer-${queued.length + 1}`, content, attachments, queued_at: new Date().toISOString() });
      return Promise.resolve({ ...chat, stream: { status: 'streaming', pending_steers: [...queued] } });
    });
    api.deliverPendingSteers.mockImplementation((_chatId, ids) => {
      const remaining = queued.filter(item => !ids.includes(item.id));
      queued.splice(0, queued.length, ...remaining);
      return Promise.resolve({ ...chat, stream: { status: 'streaming', pending_steers: [...queued] } });
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    await waitFor(() => expect(screen.getByTestId('composer-send')).toHaveTextContent('Steer'));

    fireEvent.change(input, { target: { value: 'first steer' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    expect(await screen.findByTestId('queued-steer-card')).toHaveTextContent('first steer');

    fireEvent.change(input, { target: { value: 'second steer' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(screen.getAllByTestId('queued-steer-card')).toHaveLength(2));
    expect(screen.getByText('Deliver all 2 now')).toBeInTheDocument();
    expect(screen.queryByText('Deliver now')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Deliver all 2 now'));

    await waitFor(() => expect(api.deliverPendingSteers).toHaveBeenCalledWith('chat-1', ['steer-1', 'steer-2']));
    await waitFor(() => expect(screen.queryByTestId('queued-steer-card')).not.toBeInTheDocument());
  });

  it('reconciles a persisted user stream event with the optimistic user message', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    fireEvent.change(input, { target: { value: '请修复这个问题' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(screen.getAllByText('请修复这个问题')).toHaveLength(1);

    const secondStream = api.streamChatEvents.mock.calls[1];
    await act(async () => {
      secondStream[2]({
        seq: 7,
        type: 'message',
        ts: '2026-05-12T10:01:00Z',
        actor_agent_id: 'agent-1',
        message: { role: 'user', content: '请修复这个问题' },
      });
    });

    expect(screen.getAllByText('请修复这个问题')).toHaveLength(1);
  });

  it('plays the done sound only after agent activity finishes', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());
    const originalAudioContext = globalThis.AudioContext;
    const originalWindowAudioContext = window.AudioContext;
    const close = vi.fn();
    const oscillator = {
      connect: vi.fn(),
      frequency: { setValueAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
      set onended(fn) {
        this._onended = fn;
      },
    };
    const audioContext = vi.fn();
    class FakeAudioContext {
      constructor() {
        audioContext();
        this.currentTime = 0;
        this.destination = {};
        this.state = 'running';
      }
      resume() {
        this.state = 'running';
        return Promise.resolve();
      }
      createOscillator() {
        return oscillator;
      }
      createGain() {
        return {
          connect: vi.fn(),
          gain: {
            setValueAtTime: vi.fn(),
            exponentialRampToValueAtTime: vi.fn(),
          },
        };
      }
      close() {
        close();
      }
    }
    globalThis.AudioContext = FakeAudioContext;
    window.AudioContext = FakeAudioContext;

    try {
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

      const input = await screen.findByTestId('composer-input');
      fireEvent.change(input, { target: { value: '请修复这个问题' } });
      fireEvent.click(screen.getByTestId('composer-send'));

      await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
      const runStream = api.streamChatEvents.mock.calls[1];

      await act(async () => {
        runStream[3]();
      });
      // Send-click primes the AudioContext, so construction itself is not the
      // signal we care about — the oscillator.start call is what plays sound.
      expect(oscillator.start).not.toHaveBeenCalled();

      await emitEvent(runStream, {
        seq: 8,
        type: 'message',
        ts: '2026-05-12T10:02:00Z',
        actor_agent_id: 'agent-1',
        message: { role: 'assistant', content: '修好了' },
      });
      await act(async () => {
        runStream[3]();
      });

      expect(oscillator.start).toHaveBeenCalledOnce();
    } finally {
      globalThis.AudioContext = originalAudioContext;
      window.AudioContext = originalWindowAudioContext;
    }
  });

  it('renders a simplified header with id and opened time', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Demo chat');
    // 8-char short id
    expect(screen.getByText('chat-1')).toBeInTheDocument();
    expect(screen.getByText(/opened /)).toBeInTheDocument();
    // Status indicator was removed — streaming state is conveyed by the
    // composer's Stop button and the elapsed-time tick, not a header label.
    expect(screen.queryByText('active')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
  });

  it('does not render a Share button in the header', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument();
  });

  it('shows a handover divider between two agent messages', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());
    const multiAgentChat = { ...chat, participant_agent_ids: ['agent-1', 'agent-2'] };
    api.getChat.mockResolvedValue(multiAgentChat);

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'Hi from Aria' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: 'agent-2', message: { role: 'assistant', content: 'Taking it from here' },
    });

    const dividers = await screen.findAllByTestId('handover-divider');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]).toHaveTextContent(/Aria handed off to Default Agent/);
  });

  it('renders a handover divider across an intervening human turn (agent → human → agent)', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());
    api.getChat.mockResolvedValue({ ...chat, participant_agent_ids: ['agent-1', 'agent-2'] });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    // Partner-style sequence: Aria speaks, the user redirects to Default Agent,
    // Default Agent answers. The user turn must not hide the handover.
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'Hi from Aria' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:05Z',
      actor_agent_id: '', message: { role: 'user', content: 'handover to @Default Agent' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'message', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: 'agent-2', message: { role: 'assistant', content: 'Hello, Default here' },
    });

    const dividers = await screen.findAllByTestId('handover-divider');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]).toHaveTextContent(/Aria handed off to Default Agent/);
  });

  it('does NOT render a handover divider for human → agent or agent → human transitions', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: '', message: { role: 'user', content: 'hello' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:05Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'hi back' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'message', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: '', message: { role: 'user', content: 'more' },
    });

    expect(screen.queryByTestId('handover-divider')).not.toBeInTheDocument();
  });

  it('shows the current target-agent picker in the composer and sends with the selected target_agent_id', async () => {
    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const picker = await screen.findByTestId('composer-agent-picker');
    // Default target = current_agent_id = agent-1 = Aria
    expect(picker).toHaveTextContent('Aria');

    fireEvent.click(picker);
    const option = await screen.findByRole('option', { name: /Default Agent/i });
    fireEvent.click(option);

    // The pill now reflects the new selection
    expect(picker).toHaveTextContent('Default Agent');

    const input = screen.getByTestId('composer-input');
    fireEvent.change(input, { target: { value: 'route this to default' } });
    fireEvent.click(screen.getByTestId('composer-send'));

    await waitFor(() => expect(api.postMessage).toHaveBeenCalledOnce());
    expect(api.postMessage).toHaveBeenCalledWith('chat-1', 'route this to default', 'agent-2', []);
  });

  it('restores unsent chat text and target-agent drafts', async () => {
    api.getChat.mockResolvedValue({
      ...chat,
      project_id: 'p1',
      current_agent_id: 'agent-1',
      main_agent_id: 'agent-1',
    });
    writeComposerDraft('p1', 'chat-1', {
      text: 'keep this draft',
      targetAgentId: 'agent-2',
    });

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

    const input = await screen.findByTestId('composer-input');
    await waitFor(() => expect(input).toHaveValue('keep this draft'));
    expect(screen.getByTestId('composer-agent-picker')).toHaveTextContent('Default Agent');
  });

  it('attributes a message from a deleted agent to that agent (not to the user)', async () => {
    // Seed the session cache so the deleted agent's original name is still known
    rememberAgents({
      'ghost-agent': { id: 'ghost-agent', name: 'Ghosty', kind: 'agent', color: '#abcdef', initial: 'G' },
    });
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'ghost-agent',
      message: { role: 'assistant', content: 'I am no longer in your crew' },
    });

    const body = await screen.findByText('I am no longer in your crew');
    const block = body.closest('div').parentElement;
    expect(within(block).getByText('Ghosty')).toBeInTheDocument();
    expect(within(block).getByTestId('deleted-agent-tag')).toBeInTheDocument();
    // Critical: NOT attributed to "You"
    expect(within(block).queryByText('You')).not.toBeInTheDocument();
  });

  it('renders an unknown-id author as a "Deleted agent" placeholder, never as "You"', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'never-seen',
      message: { role: 'assistant', content: 'orphan reply' },
    });

    const body = await screen.findByText('orphan reply');
    const block = body.closest('div').parentElement;
    expect(within(block).getByText('Deleted agent')).toBeInTheDocument();
    expect(within(block).queryByText('You')).not.toBeInTheDocument();
  });

  it('advances the elapsed-time meta when the per-second tick fires while running', async () => {
    // We can't lean on vi.useFakeTimers — it also fakes the setTimeout used
    // by RTL's waitFor and produces test timeouts. Instead, intercept the
    // 1s setInterval the header installs, capture its callback, and trigger
    // it manually after advancing Date.now().
    const realSetInterval = global.setInterval;
    const tickCallbacks = [];
    const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb, delay) => {
      if (delay === 1000) {
        tickCallbacks.push(cb);
        return /* fake handle */ -1;
      }
      return realSetInterval(cb, delay);
    });
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-05-12T10:01:00Z').getTime()
    );
    try {
      api.getChat.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
      api.streamChatEvents.mockImplementation(() => vi.fn());

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);

      // Initial render: 1m elapsed (chat created at 10:00:00, "now" = 10:01:00).
      await screen.findByText(/elapsed 1m 0s/);
      expect(tickCallbacks.length).toBeGreaterThan(0);

      // Advance "now" and fire the captured tick → header should re-render.
      dateNowSpy.mockReturnValue(new Date('2026-05-12T10:02:00Z').getTime());
      await act(async () => {
        tickCallbacks.forEach(cb => cb());
      });
      expect(screen.getByText(/elapsed 2m 0s/)).toBeInTheDocument();
    } finally {
      intervalSpy.mockRestore();
      dateNowSpy.mockRestore();
    }
  });

  it('does NOT install a per-second tick when the chat is not streaming', async () => {
    const realSetInterval = global.setInterval;
    const tickCallbacks = [];
    const intervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb, delay) => {
      if (delay === 1000) {
        tickCallbacks.push(cb);
        return -1;
      }
      return realSetInterval(cb, delay);
    });
    try {
      api.getChat.mockResolvedValue({
        ...chat,
        stream: { status: 'idle' },
        updated_at: '2026-05-12T10:00:30Z',
      });
      api.streamChatEvents.mockImplementation(() => vi.fn());

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
      await screen.findByText(/elapsed/);
      expect(tickCallbacks).toHaveLength(0);
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('renders tool calls collapsed by default and expands the output on click', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'tool_call', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      tool_call: { call_id: 'call-1', name: 'Bash', input: { command: "sed -n '1,180p' /tmp/x" } },
    });
    await emitEvent(stream, {
      seq: 2, type: 'tool_call_result', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-1',
      tool_call_result: { call_id: 'call-1', tool_call_seq: 1, name: 'Bash', output: 'first output line\nsecond output line' },
    });

    // The compact row is visible; the detail box should be hidden by default.
    const row = await screen.findByTestId('tool-event-row');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-event-detail')).not.toBeInTheDocument();

    // Clicking expands and reveals the full output.
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByTestId('tool-event-detail');
    expect(detail).toHaveTextContent('first output line');
    expect(detail).toHaveTextContent('second output line');

    // Clicking again collapses it back.
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-event-detail')).not.toBeInTheDocument();
  });

  it('collapses consecutive tool calls from the same agent into a single group row', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'tool_call', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      tool_call: { name: 'Bash', input: { command: 'a' } },
    });
    await emitEvent(stream, {
      seq: 2, type: 'tool_call', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-1',
      tool_call: { name: 'Bash', input: { command: 'b' } },
    });
    await emitEvent(stream, {
      seq: 3, type: 'tool_call', ts: '2026-05-12T10:00:02Z',
      actor_agent_id: 'agent-1',
      tool_call: { name: 'Bash', input: { command: 'c' } },
    });

    // Single group row collapsed by default; no individual tool rows yet.
    const groupRow = await screen.findByTestId('tool-group-row');
    expect(groupRow).toHaveTextContent(/Used 3 tools/);
    expect(groupRow).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByTestId('tool-event-row')).toHaveLength(0);

    // "Aria" agent header shows once for the whole group.
    const column = screen.getByTestId('conversation-column');
    expect(within(column).getAllByText('Aria')).toHaveLength(1);

    // Expanding reveals each individual tool's compact row.
    fireEvent.click(groupRow);
    expect(groupRow).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryAllByTestId('tool-event-row')).toHaveLength(3);
  });

  it('aggregates the tool-group summary by tool name with an x{n} count', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    // Bash, Bash, Read, Bash → must collapse to "Bash x3 · Read", not
    // "Bash · Bash · Read · Bash".
    const tools = ['Bash', 'Bash', 'Read', 'Bash'];
    for (let i = 0; i < tools.length; i++) {
      await emitEvent(stream, {
        seq: i + 1, type: 'tool_call',
        ts: `2026-05-12T10:00:0${i}Z`,
        actor_agent_id: 'agent-1',
        tool_call: { name: tools[i], input: { command: String(i) } },
      });
    }

    const groupRow = await screen.findByTestId('tool-group-row');
    // Aggregated by name, original first-seen order preserved (Bash before Read).
    expect(groupRow).toHaveTextContent(/Bash\s*x3\s*·\s*Read/);
    expect(groupRow).not.toHaveTextContent(/Bash\s*·\s*Bash/);
  });

  it('restarts the agent header when a user message interrupts a same-agent run', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    // Aria → user → Aria. The user turn breaks the run, so Aria's header
    // must reappear on the second message.
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'first agent reply' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:05Z',
      actor_agent_id: '__human__', message: { role: 'user', content: 'a follow up from me' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'message', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'second agent reply' },
    });

    const column = screen.getByTestId('conversation-column');
    expect(within(column).getAllByText('Aria')).toHaveLength(2);
  });

  it('shares a single header across consecutive same-agent events (tool, message, tool)', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'tool_call', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      tool_call: { name: 'Bash', input: { command: 'a' } },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:05Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'thinking out loud' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'tool_call', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: 'agent-1',
      tool_call: { name: 'Bash', input: { command: 'b' } },
    });

    await screen.findAllByTestId('tool-event-row');
    // Same agent throughout → only the first event displays Aria's header.
    const column = screen.getByTestId('conversation-column');
    expect(within(column).getAllByText('Aria')).toHaveLength(1);
  });

  it('renders an explicit backend handover event with the right verb and target', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'message', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'planning…' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'handover', ts: '2026-05-12T10:00:05Z',
      actor_agent_id: 'agent-1',
      handover: { subtype: 'delegate', agent_id: 'agent-2', agent_name: 'Default Agent', note: 'write the composer' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'message', ts: '2026-05-12T10:00:10Z',
      actor_agent_id: 'agent-2', message: { role: 'assistant', content: 'on it' },
    });

    const dividers = await screen.findAllByTestId('handover-divider');
    // Only ONE divider — the explicit one. No synthesized duplicate from the
    // actor change that follows.
    expect(dividers).toHaveLength(1);
    expect(dividers[0]).toHaveTextContent(/Aria handed off to Default Agent/);
    // The note is hidden until the divider is clicked.
    expect(dividers[0]).not.toHaveTextContent(/write the composer/);
    fireEvent.click(within(dividers[0]).getByTestId('handover-toggle'));
    expect(dividers[0]).toHaveTextContent(/write the composer/);
  });

  it('drops degenerate handover events whose source and target are the same agent', async () => {
    // Regression: the backend emits a `scheduled` handover (source → target,
    // useful) AND an `occurred` handover (target → target, just an
    // acknowledgment). The acknowledgment must not render.
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'handover', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      handover: { subtype: 'scheduled', agent_id: 'agent-2', agent_name: 'Default Agent', note: 'greet the user' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'handover', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-2',
      handover: { subtype: 'occurred', agent_id: 'agent-2', agent_name: 'Default Agent', note: 'greet the user' },
    });
    await emitEvent(stream, {
      seq: 3, type: 'message', ts: '2026-05-12T10:00:02Z',
      actor_agent_id: 'agent-2', message: { role: 'assistant', content: 'hi there' },
    });

    const dividers = await screen.findAllByTestId('handover-divider');
    expect(dividers).toHaveLength(1);
    expect(dividers[0]).toHaveTextContent(/Aria.*Default Agent/);
    expect(dividers[0]).not.toHaveTextContent(/Default Agent handed off to Default Agent/);
  });

  it('uses the right verb for return and escalate handover subtypes', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'handover', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-2',
      handover: { subtype: 'return', agent_id: 'agent-1' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'handover', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-1',
      handover: { subtype: 'escalate', agent_id: 'agent-3' },
    });

    const dividers = await screen.findAllByTestId('handover-divider');
    expect(dividers[0]).toHaveTextContent(/returned to/);
    expect(dividers[1]).toHaveTextContent(/escalated to/);
  });

  it('skips runtime_session events from the timeline', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'runtime_session', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      runtime_session: { runtime_id: 'r-1', session_id: 's-1', status: 'starting' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'hello' },
    });

    await screen.findByText('hello');
    // The runtime_session event must not produce a fallback "Deleted agent"
    // or empty block — it should simply be absent.
    const column = screen.getByTestId('conversation-column');
    expect(within(column).queryByText(/runtime|session/i)).not.toBeInTheDocument();
  });

  it('renders an error event with subtype, code, message, and agent metadata', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'error', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1',
      error: {
        subtype: 'tool_error', code: 'E_TIMEOUT',
        message: 'run_tests exceeded 30s',
        agent_id: 'agent-1', agent_name: 'Aria',
      },
    });

    const block = await screen.findByTestId('error-event');
    expect(within(block).getByText(/tool error/)).toBeInTheDocument();
    expect(within(block).getByText('E_TIMEOUT')).toBeInTheDocument();
    expect(within(block).getByText(/run_tests exceeded 30s/)).toBeInTheDocument();
    expect(within(block).getByText('Aria')).toBeInTheDocument();
  });

  it('pairs a thinking event with the next message from the same author (renders as inline chip, not standalone)', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'thinking', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', thinking: { content: 'considering the plan' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-1', message: { role: 'assistant', content: 'here is the plan' },
    });

    await screen.findByText('here is the plan');
    // Only ONE thought chip — attached to the message — no standalone thinking block.
    expect(screen.getAllByTestId('thought-chip')).toHaveLength(1);
    // And the Aria header appears exactly once for the combined block.
    const column = screen.getByTestId('conversation-column');
    expect(within(column).getAllByText('Aria')).toHaveLength(1);
  });

  it('renders a standalone thinking event when no message from the same author follows', async () => {
    api.streamChatEvents.mockImplementation(() => vi.fn());

    render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
    await screen.findByTestId('composer-input');

    const stream = api.streamChatEvents.mock.calls[0];
    await emitEvent(stream, {
      seq: 1, type: 'thinking', ts: '2026-05-12T10:00:00Z',
      actor_agent_id: 'agent-1', thinking: { content: 'still thinking' },
    });
    await emitEvent(stream, {
      seq: 2, type: 'message', ts: '2026-05-12T10:00:01Z',
      actor_agent_id: 'agent-2', message: { role: 'assistant', content: 'unrelated reply' },
    });

    await screen.findByText('unrelated reply');
    // Aria's thinking is rendered standalone (chip plus name).
    const column = screen.getByTestId('conversation-column');
    expect(within(column).getByText('Aria')).toBeInTheDocument();
    expect(screen.getByTestId('thought-chip')).toBeInTheDocument();
  });

  it('keeps the streaming indicator on after the user navigates away from a running chat', async () => {
    api.getChat.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
    // streamChatEvents stays connected — no immediate onDone
    api.streamChatEvents.mockImplementation(() => vi.fn());

    const onStreamingChange = vi.fn();
    const { unmount } = render(
      <TaskView chatId="chat-1" agentsMap={agentsMap} onStreamingChange={onStreamingChange} />
    );

    // Wait for the streaming=true callback
    await waitFor(() => {
      const lastCall = onStreamingChange.mock.calls[onStreamingChange.mock.calls.length - 1];
      expect(lastCall).toEqual(['chat-1', true]);
    });

    onStreamingChange.mockClear();
    unmount();

    // Critically: unmount must NOT report streaming=false. That was the bug —
    // it caused the sidebar spinner to disappear even while the backend kept
    // working.
    expect(onStreamingChange).not.toHaveBeenCalledWith('chat-1', false);
  });

  describe('composer suggestions', () => {
    it('suggests skills for the current agent after / and inserts the chosen one', async () => {
      const skills = [
        { id: 'skill-1', name: 'review' },
        { id: 'skill-2', name: 'plan' },
        { id: 'skill-3', name: 'qa' },
      ];
      const agentsWithSkills = {
        ...agentsMap,
        'agent-1': { ...agentsMap['agent-1'], skill_ids: ['skill-1', 'skill-2'] },
      };

      render(<TaskView chatId="chat-1" agentsMap={agentsWithSkills} skills={skills} />);

      const input = await screen.findByTestId('composer-input');
      fireEvent.change(input, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });

      const reviewOption = await screen.findByRole('option', { name: /review/i });
      expect(reviewOption).toBeInTheDocument();
      // 'qa' is not in agent-1's skill_ids, so it must NOT appear
      expect(screen.queryByRole('option', { name: /^qa$/i })).not.toBeInTheDocument();

      fireEvent.click(reviewOption);
      expect(input).toHaveValue('/review ');
    });

    it('does not show skill suggestions when the agent has none enabled', async () => {
      const skills = [{ id: 'skill-1', name: 'review' }];
      // agent-1 has no skill_ids field, so nothing is enabled
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} skills={skills} />);

      const input = await screen.findByTestId('composer-input');
      fireEvent.change(input, { target: { value: '/', selectionStart: 1, selectionEnd: 1 } });

      expect(screen.queryByRole('listbox', { name: /skill suggestions/i })).not.toBeInTheDocument();
    });

    it('fetches and shows file suggestions after @path when the project has a workdir', async () => {
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.listProjectFiles.mockResolvedValue([
        { path: 'src/main.go', is_dir: false },
        { path: 'src/helpers', is_dir: true },
      ]);
      const projects = [{ id: 'proj-1', workdir: '/tmp/demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);

      // Wait until the chat has loaded — the draft-reset effect only fires once
      // projectId is set, and it clears val. If we type before that effect runs,
      // the suggestion never opens.
      const input = await screen.findByTestId('composer-input');
      await waitFor(() => expect(api.getChat).toHaveBeenCalled());
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(input, { target: { value: '@src', selectionStart: 4, selectionEnd: 4 } });

      const fileOption = await screen.findByRole('option', { name: /main\.go/i }, { timeout: 2000 });
      fireEvent.click(fileOption);

      expect(input).toHaveValue('@src/main.go ');
      expect(api.listProjectFiles).toHaveBeenCalledWith('proj-1', 'src', expect.any(Number));
    });

    it('highlights both agent mentions and skill commands in the composer', async () => {
      const skills = [{ id: 'skill-1', name: 'review' }];
      const agentsWithSkills = {
        ...agentsMap,
        'agent-1': { ...agentsMap['agent-1'], skill_ids: ['skill-1'] },
      };
      render(<TaskView chatId="chat-1" agentsMap={agentsWithSkills} skills={skills} />);

      const input = await screen.findByTestId('composer-input');
      const text = '@Aria please /review the diff';
      fireEvent.change(input, {
        target: { value: text, selectionStart: text.length, selectionEnd: text.length },
      });

      const highlights = await screen.findAllByTestId('composer-mention-highlight');
      const labels = highlights.map(h => h.textContent);
      expect(labels).toContain('@Aria');
      expect(labels).toContain('/review');
    });
  });

  describe('Files drawer', () => {
    function captureStream() {
      const captured = {};
      api.streamChatEvents.mockImplementation((_chatId, _after, onEvent, onDone, onError) => {
        captured.onEvent = onEvent;
        captured.onDone = onDone;
        captured.onError = onError;
        return vi.fn();
      });
      return captured;
    }

    it('shows a Files button with a count badge of edited files', async () => {
      const stream = captureStream();
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/foo.js' } },
        });
        stream.onEvent({
          seq: 2, ts: '2026-05-12T10:00:02Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'read_file', input: { path: 'src/bar.js' } },
        });
        stream.onEvent({
          seq: 3, ts: '2026-05-12T10:00:03Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'Bash', input: { command: 'ls' } },
        });
      });

      const toggle = await screen.findByTestId('files-drawer-toggle');
      // Only edit_file counts; read_file and Bash are excluded.
      expect(toggle).toHaveTextContent('1');
    });

    it('uses the project working-tree changed file count for the Files badge', async () => {
      const stream = captureStream();
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.getProjectGitDiff.mockResolvedValue([
        { path: 'src/one.js', status: 'M', added: 1, removed: 0, diff: [] },
        { path: 'src/two.js', status: 'M', added: 1, removed: 0, diff: [] },
        { path: 'src/three.js', status: 'M', added: 1, removed: 0, diff: [] },
        { path: 'src/four.js', status: 'M', added: 1, removed: 0, diff: [] },
        { path: 'src/five.js', status: '?', added: 0, removed: 0, diff: [] },
      ]);
      const projects = [{ id: 'proj-1', name: 'demo', workdir: '/tmp/demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/one.js' } },
        });
        stream.onEvent({
          seq: 2, ts: '2026-05-12T10:00:02Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/two.js' } },
        });
      });

      const toggle = await screen.findByTestId('files-drawer-toggle');
      await waitFor(() => expect(toggle).toHaveTextContent('5'));
      expect(api.getProjectGitDiff).toHaveBeenCalledWith('proj-1');
    });

    it('coalesces working-tree badge refreshes during bursts of tool events', async () => {
      const stream = captureStream();
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.getProjectGitDiff.mockResolvedValue([
        { path: 'src/one.js', status: 'M', added: 1, removed: 0, diff: [] },
      ]);
      const projects = [{ id: 'proj-1', name: 'demo', workdir: '/tmp/demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());
      await waitFor(() => expect(api.getProjectGitDiff).toHaveBeenCalledWith('proj-1'));
      api.getProjectGitDiff.mockClear();

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/one.js' } },
        });
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      await act(async () => {
        stream.onEvent({
          seq: 2, ts: '2026-05-12T10:00:02Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/two.js' } },
        });
      });
      await new Promise(resolve => setTimeout(resolve, 50));
      await act(async () => {
        stream.onEvent({
          seq: 3, ts: '2026-05-12T10:00:03Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/three.js' } },
        });
      });

      expect(api.getProjectGitDiff).not.toHaveBeenCalled();
      await waitFor(() => expect(api.getProjectGitDiff).toHaveBeenCalledTimes(1), { timeout: 1200 });
    });

    it('opens the drawer and shows touched files under their directories in tree mode', async () => {
      const stream = captureStream();
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/foo.js' } },
        });
        stream.onEvent({
          seq: 2, ts: '2026-05-12T10:00:02Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'read_file', input: { path: 'src/bar.js' } },
        });
      });

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      // No workdir → tree mode is the default. Both files should render under
      // the src/ folder.
      expect(screen.getByText('src/')).toBeInTheDocument();
      expect(screen.getByText('foo.js')).toBeInTheDocument();
      expect(screen.getByText('bar.js')).toBeInTheDocument();
      // The edit count surfaces in the header subtitle and on the changed leaf.
      const edits = await screen.findAllByText(/1 edit/);
      expect(edits.length).toBeGreaterThan(0);
    });

    it('fetches and shows the file content when a tree leaf is clicked', async () => {
      const stream = captureStream();
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.readProjectFile.mockResolvedValue({
        path: 'src/foo.js',
        content: 'const x = 1;\nconst y = 2;\n',
        size: 24, truncated: false, binary: false,
      });
      // No workdir → tree mode is the default.
      const projects = [{ id: 'proj-1', name: 'demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'write_file', input: { file_path: 'src/foo.js' } },
        });
      });

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      fireEvent.click(await screen.findByText('foo.js'));

      await waitFor(() => expect(api.readProjectFile).toHaveBeenCalledWith('proj-1', 'src/foo.js'));
      expect(await screen.findByText('const x = 1;')).toBeInTheDocument();
      expect(screen.getByText('const y = 2;')).toBeInTheDocument();
    });

    it('shows working-tree diffs in diff mode when the project has a workdir', async () => {
      const stream = captureStream();
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.getProjectGitDiff.mockResolvedValue([
        {
          path: 'src/foo.js', status: 'M', added: 2, removed: 1,
          diff: [
            { kind: 'hunk', text: '@@ -1,2 +1,3 @@' },
            { kind: 'ctx', text: 'const x = 1;' },
            { kind: 'del', text: 'const y = 2;' },
            { kind: 'add', text: 'const y = 22;' },
            { kind: 'add', text: 'const z = 3;' },
          ],
        },
        { path: 'NEW.md', status: '?', added: 0, removed: 0, diff: [] },
      ]);
      const projects = [{ id: 'proj-1', name: 'demo', workdir: '/tmp/demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      // Diff mode is the default with a workdir, but click to be explicit.
      fireEvent.click(screen.getByTestId('files-drawer-mode-diff'));

      const rows = await screen.findAllByTestId('git-diff-row');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('src/foo.js');
      expect(rows[0]).toHaveTextContent('+2');
      expect(rows[0]).toHaveTextContent('−1');
      expect(rows[1]).toHaveTextContent('NEW.md');
    });

    it('clears stale working-tree diffs when switching projects', async () => {
      api.getChat.mockImplementation(async (id) => ({
        ...chat,
        id,
        project_id: id === 'chat-1' ? 'proj-1' : 'proj-2',
      }));
      let resolveProj2Diff;
      api.getProjectGitDiff.mockImplementation((projectId) => {
        if (projectId === 'proj-1') {
          return Promise.resolve([
            { path: 'old-project.js', status: 'M', added: 1, removed: 0, diff: [] },
          ]);
        }
        return new Promise(resolve => { resolveProj2Diff = resolve; });
      });
      const projects = [
        { id: 'proj-1', name: 'one', workdir: '/tmp/one' },
        { id: 'proj-2', name: 'two', workdir: '/tmp/two' },
      ];

      const { rerender } = render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      await waitFor(() => expect(api.getProjectGitDiff).toHaveBeenCalledWith('proj-1'));
      expect(await screen.findByText('old-project.js')).toBeInTheDocument();

      rerender(<TaskView chatId="chat-2" agentsMap={agentsMap} projects={projects} />);
      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      await waitFor(() => expect(api.getProjectGitDiff).toHaveBeenCalledWith('proj-2'));

      expect(screen.queryByText('old-project.js')).not.toBeInTheDocument();
      resolveProj2Diff([]);
    });

    it('clicking a diff row opens the file with the diff toggle and unified diff visible', async () => {
      const stream = captureStream();
      api.getChat.mockResolvedValue({ ...chat, project_id: 'proj-1' });
      api.getProjectGitDiff.mockResolvedValue([
        {
          path: 'src/foo.js', status: 'M', added: 1, removed: 1,
          diff: [
            { kind: 'hunk', text: '@@ -1,1 +1,1 @@' },
            { kind: 'del', text: 'const y = 2;' },
            { kind: 'add', text: 'const y = 22;' },
          ],
        },
      ]);
      api.readProjectFile.mockResolvedValue({
        path: 'src/foo.js', content: 'const y = 22;\n', size: 14, truncated: false, binary: false,
      });
      const projects = [{ id: 'proj-1', name: 'demo', workdir: '/tmp/demo' }];

      render(<TaskView chatId="chat-1" agentsMap={agentsMap} projects={projects} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      const row = await screen.findByTestId('git-diff-row');
      fireEvent.click(row);

      // Diff view is the default when a diff payload is present.
      expect(await screen.findByText('const y = 2;')).toBeInTheDocument();
      expect(screen.getByText('const y = 22;')).toBeInTheDocument();
    });

    it('disables the diff toggle and defaults to tree when the project has no workdir', async () => {
      const stream = captureStream();
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/foo.js' } },
        });
      });

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      expect(screen.getByTestId('files-drawer-mode-diff')).toBeDisabled();
      // Tree mode shows the touched file under src/.
      expect(screen.getByText('src/')).toBeInTheDocument();
      expect(screen.getByText('foo.js')).toBeInTheDocument();
    });

    it('closes the drawer when the close button is clicked', async () => {
      const stream = captureStream();
      render(<TaskView chatId="chat-1" agentsMap={agentsMap} />);
      await waitFor(() => expect(stream.onEvent).toBeDefined());

      await act(async () => {
        stream.onEvent({
          seq: 1, ts: '2026-05-12T10:00:01Z', type: 'tool_call', actor_agent_id: 'agent-1',
          tool_call: { name: 'edit_file', input: { file_path: 'src/foo.js' } },
        });
      });

      fireEvent.click(await screen.findByTestId('files-drawer-toggle'));
      fireEvent.click(await screen.findByTestId('files-drawer-close'));

      // The toggle button reappears immediately because the drawer's intent
      // flips to closed; the drawer itself stays mounted briefly for the
      // slide-out animation, so wait it out before asserting unmount.
      expect(await screen.findByTestId('files-drawer-toggle')).toBeInTheDocument();
      await waitFor(
        () => expect(screen.queryByTestId('files-drawer-close')).not.toBeInTheDocument(),
        { timeout: 1000 },
      );
    });
  });
});
