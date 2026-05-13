const configuredBackendUrl = (import.meta.env.VITE_CREWAI_BACKEND_URL || '').replace(/\/$/, '');
let backendConfigPromise;

async function backendConfig() {
  if (!backendConfigPromise) {
    backendConfigPromise = (async () => {
      if (typeof window !== 'undefined' && window.electronAPI?.getBackendConfig) {
        const config = await window.electronAPI.getBackendConfig();
        return {
          url: (config?.url || '').replace(/\/$/, ''),
          token: config?.token || '',
        };
      }
      return {
        url: configuredBackendUrl,
        token: import.meta.env.VITE_CREWAI_AUTH_TOKEN || '',
      };
    })();
  }
  return backendConfigPromise;
}

async function apiBase() {
  const config = await backendConfig();
  return `${config.url}/api`;
}

async function authHeaders(extra = {}) {
  const config = await backendConfig();
  return {
    ...extra,
    ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
  };
}

async function get(path) {
  const res = await fetch((await apiBase()) + path, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch((await apiBase()) + path, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch((await apiBase()) + path, {
    method: 'PUT',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function del(path) {
  const res = await fetch((await apiBase()) + path, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export async function listProjects() {
  const data = await get('/projects');
  return data.items || [];
}

export async function getOnboardingStatus() {
  return get('/onboarding');
}

export async function completeOnboarding() {
  return post('/onboarding/complete', {});
}

export async function createProject(name, workdir, mainAgentId) {
  return post('/projects', { name, workdir, main_agent_id: mainAgentId });
}

export async function updateProject(id, data) {
  return put(`/projects/${id}`, data);
}

export async function deleteProject(id) {
  return del(`/projects/${id}`);
}

export async function listProjectChats(projectId) {
  const data = await get(`/projects/${projectId}/chats`);
  return data.items || [];
}

export async function listAgents() {
  const data = await get('/agents');
  return data.items || [];
}

export async function createAgent(name, instruction, runtimeId, model) {
  return post('/agents', { name, instruction, runtime_id: runtimeId, model });
}

export async function updateAgent(id, data) {
  return put(`/agents/${id}`, data);
}

export async function archiveAgent(id) {
  return post(`/agents/${id}/archive`, {});
}

export async function replaceAgentSkills(id, skillIds) {
  return put(`/agents/${id}/skills`, { skill_ids: skillIds });
}

export async function listSkills() {
  const data = await get('/skills');
  return data.items || [];
}

export async function createSkill(name) {
  return post('/skills', { name });
}

export async function updateSkill(id, name) {
  return put(`/skills/${id}`, { name });
}

export async function deleteSkill(id) {
  return del(`/skills/${id}`);
}

export async function listSkillFiles(id) {
  const data = await get(`/skills/${id}/files`);
  return data.items || [];
}

export async function putSkillFile(skillId, fileId, content) {
  return put(`/skills/${skillId}/files`, { file_id: fileId, content });
}

export async function listRuntimes() {
  const data = await get('/runtimes');
  return data.items || [];
}

export async function rescanRuntimes() {
  return post('/runtimes/rescan', {});
}

export async function getChat(id) {
  return get(`/chat/sessions/${id}`);
}

export async function createChat(projectId, title, mainAgentId) {
  return post('/chat/sessions', { project_id: projectId, title, main_agent_id: mainAgentId });
}

export async function updateChat(id, data) {
  return put(`/chat/sessions/${id}`, data);
}

export async function deleteChat(id) {
  return del(`/chat/sessions/${id}`);
}

export async function getChatEvents(id) {
  const data = await get(`/chat/sessions/${id}/events`);
  return data.events || [];
}

export async function postMessage(chatId, content, targetAgentId) {
  return post(`/chat/sessions/${chatId}/messages`, {
    content,
    target_agent_id: targetAgentId || '',
  });
}

export async function cancelChat(chatId) {
  return post(`/chat/sessions/${chatId}/cancel`, {});
}

function parseSseFrame(frame) {
  let event = 'message';
  const data = [];

  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const index = rawLine.indexOf(':');
    const field = index === -1 ? rawLine : rawLine.slice(0, index);
    const value = index === -1 ? '' : rawLine.slice(index + 1).replace(/^ /, '');

    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
  }

  return { event, data: data.join('\n') };
}

async function readSseStream(response, onEvent, onDone, onError) {
  if (!response.ok) throw new Error(`API ${response.status}: chat event stream`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';

    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (parsed.event === 'chat.event') {
        onEvent(JSON.parse(parsed.data));
      } else if (parsed.event === 'done') {
        onDone?.();
        return;
      } else if (parsed.event === 'error') {
        onError?.(new Error(parsed.data || 'SSE error'));
      }
    }
  }

  onDone?.();
}

// Returns a cleanup function. Connects to the chat SSE stream, calls onEvent
// for each event, onDone when the stream ends, and onError on failure.
export function streamChatEvents(chatId, after, onEvent, onDone, onError) {
  const controller = new AbortController();

  (async () => {
    const url = `${await apiBase()}/chat/sessions/${chatId}/events?follow=1${after ? '&after=' + after : ''}`;
    const res = await fetch(url, {
      headers: await authHeaders(),
      signal: controller.signal,
    });
    await readSseStream(res, onEvent, onDone, onError);
  })().catch(err => {
    if (err.name !== 'AbortError') onError?.(err);
  });

  return () => controller.abort();
}
