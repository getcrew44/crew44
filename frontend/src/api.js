const BASE = '/api';

async function get(path) {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function put(path, body) {
  const res = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

async function del(path) {
  const res = await fetch(BASE + path, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export async function listProjects() {
  const data = await get('/projects');
  return data.items || [];
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

// Returns a cleanup function. Connects SSE, calls onEvent for each event,
// onDone when the stream ends, onError on failure.
export function streamChatEvents(chatId, after, onEvent, onDone, onError) {
  const url = `/api/chat/sessions/${chatId}/events?follow=1${after ? '&after=' + after : ''}`;
  const es = new EventSource(url);

  es.addEventListener('chat.event', (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  });

  es.addEventListener('done', () => {
    es.close();
    onDone?.();
  });

  es.onerror = (e) => {
    es.close();
    onError?.(e);
  };

  return () => es.close();
}
