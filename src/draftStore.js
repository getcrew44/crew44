const DRAFT_PREFIX = 'crewai-composer-draft:v1';
const NEW_CHAT_PROJECT_KEY = `${DRAFT_PREFIX}:new-chat-project`;

function storage() {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

export function draftKey(projectId = '', chatId = '') {
  return `${DRAFT_PREFIX}:${projectId || ''}:${chatId || ''}`;
}

export function readComposerDraft(projectId = '', chatId = '') {
  const store = storage();
  if (!store) return {};

  try {
    return JSON.parse(store.getItem(draftKey(projectId, chatId)) || '{}') || {};
  } catch {
    return {};
  }
}

export function writeComposerDraft(projectId = '', chatId = '', draft = {}) {
  const store = storage();
  if (!store) return;

  const next = {
    text: draft.text || '',
    targetAgentId: draft.targetAgentId || '',
    targetProjectId: draft.targetProjectId || '',
  };

  if (!next.text && !next.targetAgentId && !next.targetProjectId) {
    store.removeItem(draftKey(projectId, chatId));
    return;
  }

  store.setItem(draftKey(projectId, chatId), JSON.stringify(next));
}

export function clearComposerDraft(projectId = '', chatId = '') {
  storage()?.removeItem(draftKey(projectId, chatId));
}

export function readLastNewChatProjectId() {
  return storage()?.getItem(NEW_CHAT_PROJECT_KEY) || '';
}

export function writeLastNewChatProjectId(projectId) {
  const store = storage();
  if (!store) return;
  if (projectId) store.setItem(NEW_CHAT_PROJECT_KEY, projectId);
  else store.removeItem(NEW_CHAT_PROJECT_KEY);
}
