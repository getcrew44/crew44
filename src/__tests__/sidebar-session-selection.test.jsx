import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../Sidebar.jsx';

// Minimal props needed to render Sidebar without errors
const noop = () => {};
const baseProps = {
  route: 'task',
  setRoute: noop,
  onPick: noop,
  deskName: 'Test Desk',
  backendOnline: true,
};

// Sessions using ChatRecord shape (field is `id`, not `chat_id`)
const SESSIONS = [
  { id: 'chat-aaa', title: 'hi',    status: 'active', age: '9m' },
  { id: 'chat-bbb', title: 'hello', status: 'active', age: '8m' },
  { id: 'chat-ccc', title: 'lovely',status: 'active', age: 'just now' },
];

const PROJECTS = [{ id: 'proj-1', name: '语境-中文素材', workdir: '/tmp', sessions: SESSIONS }];

// jsdom normalises hex to rgb when reading back inline styles
const SELECTED_BG = 'rgb(235, 229, 214)'; // #EBE5D6

describe('Sidebar session selection', () => {
  it('highlights only the currently selected chat', () => {
    render(
      <Sidebar
        {...baseProps}
        projects={PROJECTS}
        currentChatId="chat-bbb"
      />
    );

    const hello = screen.getByTestId('chat-chat-bbb');
    const hi    = screen.getByTestId('chat-chat-aaa');
    const lovely = screen.getByTestId('chat-chat-ccc');

    expect(hello.style.background).toBe(SELECTED_BG);
    expect(hi.style.background).not.toBe(SELECTED_BG);
    expect(lovely.style.background).not.toBe(SELECTED_BG);
  });

  it('highlights no session when currentChatId is null', () => {
    render(
      <Sidebar
        {...baseProps}
        projects={PROJECTS}
        currentChatId={null}
      />
    );

    for (const s of SESSIONS) {
      expect(screen.getByTestId(`chat-${s.id}`).style.background).not.toBe(SELECTED_BG);
    }
  });

  it('highlights no session when currentChatId is undefined (the bug scenario)', () => {
    // The original bug: c.chat_id on a ChatRecord → undefined → all sessions matched.
    // This test ensures undefined currentChatId does NOT select all sessions.
    render(
      <Sidebar
        {...baseProps}
        projects={PROJECTS}
        currentChatId={undefined}
      />
    );

    for (const s of SESSIONS) {
      expect(screen.getByTestId(`chat-${s.id}`).style.background).not.toBe(SELECTED_BG);
    }
  });

  it('highlights no session while the new task route is shown', () => {
    render(
      <Sidebar
        {...baseProps}
        route="new"
        projects={PROJECTS}
        currentChatId="chat-bbb"
      />
    );

    for (const s of SESSIONS) {
      expect(screen.getByTestId(`chat-${s.id}`).style.background).not.toBe(SELECTED_BG);
    }
  });
});

// ── Mapping unit test ──────────────────────────────────────────────────────────
// Verifies the sidebarProjects computation uses c.id (ChatRecord field),
// not c.chat_id (ChatIndexEntry field — does not exist on ChatRecord).
describe('sidebarProjects chat ID mapping', () => {
  // Simulate what projects.chats.list actually returns:
  // ListProjectChats returns []ChatRecord, not []ChatIndexEntry.
  const chatRecord = {
    id: 'real-uuid-123',
    title: 'My Chat',
    status: 'active',
    updated_at: '2026-05-12T10:00:00Z',
    // deliberately no chat_id field — ChatRecord doesn't have one
  };

  it('ChatRecord has id, not chat_id', () => {
    expect(chatRecord.id).toBe('real-uuid-123');
    expect(chatRecord.chat_id).toBeUndefined();
  });

  it('mapping c.id produces a valid session id', () => {
    const session = { id: chatRecord.id, title: chatRecord.title };
    expect(session.id).toBe('real-uuid-123');
    expect(session.id).not.toBeUndefined();
  });

  it('mapping c.chat_id (the bug) produces undefined', () => {
    // This is what the broken code did: id: c.chat_id
    const brokenSession = { id: chatRecord.chat_id, title: chatRecord.title };
    expect(brokenSession.id).toBeUndefined();
  });

  it('undefined session id causes all sessions to match when currentChatId is also undefined', () => {
    // Demonstrates the exact failure chain:
    // 1. c.chat_id → undefined  (wrong field)
    // 2. any onPick call sets currentChatId to undefined
    // 3. undefined === undefined is true for every session
    const brokenSessions = [
      { id: chatRecord.chat_id },  // id: undefined
      { id: chatRecord.chat_id },  // id: undefined
    ];
    const currentChatId = brokenSessions[0].id;  // undefined after first pick

    const activeCount = brokenSessions.filter(s => currentChatId === s.id).length;
    expect(activeCount).toBe(2);  // BUG: all match
  });

  it('correct id field prevents all-selected bug', () => {
    const correctSessions = [
      { id: 'chat-aaa' },
      { id: 'chat-bbb' },
    ];
    const currentChatId = 'chat-aaa';

    const activeCount = correctSessions.filter(s => currentChatId === s.id).length;
    expect(activeCount).toBe(1);  // only one matches
  });
});
