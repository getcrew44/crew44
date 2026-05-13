import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import TaskView from '../TaskView.jsx';
import * as api from '../api.js';

vi.mock('../api.js', () => ({
  getChat: vi.fn(),
  postMessage: vi.fn(),
  cancelChat: vi.fn(),
  streamChatEvents: vi.fn(),
}));

const agentsMap = {
  'agent-1': {
    id: 'agent-1',
    name: 'Aria',
    initial: 'A',
    color: '#C4644A',
  },
  'agent-2': {
    id: 'agent-2',
    name: 'Default Agent',
    initial: 'D',
    color: '#5B7EDB',
  },
  'agent-3': {
    id: 'agent-3',
    name: 'Coding Agent',
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
  vi.clearAllMocks();
  api.getChat.mockResolvedValue(chat);
  api.postMessage.mockResolvedValue({ ...chat, stream: { status: 'streaming' } });
  api.cancelChat.mockResolvedValue({});
  api.streamChatEvents.mockImplementation((_chatId, _after, _onEvent, onDone) => {
    onDone?.();
    return vi.fn();
  });
});

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

  it('reconciles a persisted user SSE event with the optimistic user message', async () => {
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
});
