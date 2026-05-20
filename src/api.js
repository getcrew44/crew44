import { rpc } from './rpc-client.js';

export async function listProjects() {
  const data = await rpc.call('projects.list');
  return data.items || [];
}

export async function getOnboardingStatus() {
  return rpc.call('onboarding.get');
}

export async function getRemoteStatus() {
  return rpc.call('remote.status');
}

export async function createRemotePairing(relayUrl) {
  return rpc.call('remote.pairing.create', { relay_url: relayUrl });
}

export async function listRemoteDevices() {
  const data = await rpc.call('remote.devices.list');
  return data.items || [];
}

export async function deleteRemoteDevice(deviceId) {
  return rpc.call('remote.devices.delete', { device_id: deviceId });
}

export async function completeOnboarding() {
  return rpc.call('onboarding.complete');
}

export async function createProject(name, workdir, mainAgentId) {
  return rpc.call('projects.create', { name, workdir, main_agent_id: mainAgentId });
}

export async function updateProject(id, data) {
  return rpc.call('projects.update', { ...data, id });
}

export async function deleteProject(id) {
  return rpc.call('projects.delete', { id });
}

export async function listProjectChats(projectId) {
  const data = await rpc.call('projects.chats.list', { id: projectId });
  return data.items || [];
}

export async function listProjectFiles(projectId, query, limit = 50) {
  const data = await rpc.call('projects.files.list', { id: projectId, query: query || '', limit });
  return data.items || [];
}

export async function readProjectFile(projectId, path) {
  return rpc.call('projects.files.read', { id: projectId, path });
}

export async function getProjectGitDiff(projectId) {
  const data = await rpc.call('projects.git.diff', { id: projectId });
  return data.items || [];
}

export async function listAgents() {
  const data = await rpc.call('agents.list');
  return data.items || [];
}

export async function createAgent(name, instruction, runtimeId, model) {
  return rpc.call('agents.create', { name, instruction, runtime_id: runtimeId, model });
}

export async function updateAgent(id, data) {
  return rpc.call('agents.update', { ...data, id });
}

export async function archiveAgent(id) {
  return rpc.call('agents.archive', { id });
}

export async function restoreAgent(id) {
  return rpc.call('agents.restore', { id });
}

export async function replaceAgentSkills(id, skillIds) {
  return rpc.call('agents.skills.replace', { id, skill_ids: skillIds });
}

export async function listSkills() {
  const data = await rpc.call('skills.list');
  return data.items || [];
}

export async function createSkill(name) {
  return rpc.call('skills.create', { name });
}

export async function updateSkill(id, name) {
  return rpc.call('skills.update', { id, name });
}

export async function deleteSkill(id) {
  return rpc.call('skills.delete', { id });
}

export async function listSkillFiles(id) {
  const data = await rpc.call('skills.files.list', { id });
  return data.items || [];
}

export async function putSkillFile(skillId, fileId, content) {
  return rpc.call('skills.files.put', { id: skillId, file_id: fileId, content });
}

export async function deleteSkillFile(skillId, fileId) {
  return rpc.call('skills.files.delete', { id: skillId, file_id: fileId });
}

export async function listRuntimes() {
  const data = await rpc.call('runtimes.list');
  return data.items || [];
}

export async function rescanRuntimes() {
  return rpc.call('runtimes.rescan');
}

export async function getRuntime(id) {
  return rpc.call('runtimes.get', { id });
}

export async function updateRuntime(id, patch) {
  return rpc.call('runtimes.update', { id, patch });
}

export async function listRuntimeModels(id) {
  const data = await rpc.call('runtimes.models', { id });
  return data.items || [];
}

export async function listPresets() {
  const data = await rpc.call('presets.list');
  return data.items || [];
}

export async function seedDefaultCrew() {
  return rpc.call('presets.defaultCrew.seed');
}

export async function resetDefaultCrew() {
  return rpc.call('presets.defaultCrew.reset');
}

export async function resetAgentPreset(id) {
  return rpc.call('agents.preset.reset', { id });
}

export async function getChat(id) {
  return rpc.call('chats.get', { id });
}

export async function listChats(projectId = '') {
  const data = await rpc.call('chats.list', { project_id: projectId });
  return data.items || [];
}

export async function createChat(projectId, title, mainAgentId) {
  return rpc.call('chats.create', { project_id: projectId, title, main_agent_id: mainAgentId });
}

export async function updateChat(id, data) {
  return rpc.call('chats.update', { ...data, id });
}

export async function deleteChat(id) {
  return rpc.call('chats.delete', { id });
}

export async function archiveChat(id) {
  return updateChat(id, { archived_at: new Date().toISOString() });
}

export async function getChatEvents(id) {
  const data = await rpc.call('chats.events.list', { chat_id: id, after: 0 });
  return data.events || [];
}

export async function postMessage(chatId, content, targetAgentId, attachments = []) {
  return rpc.call('chats.messages.post', {
    id: chatId,
    content,
    target_agent_id: targetAgentId || '',
    attachments,
  });
}

export async function interruptMessage(chatId, content, attachments = []) {
  return rpc.call('chats.messages.interrupt', {
    id: chatId,
    content,
    attachments,
  });
}

export async function cancelPendingSteer(chatId, steerId) {
  return rpc.call('chats.messages.interrupt.cancel', { id: chatId, steer_id: steerId });
}

export async function deliverPendingSteers(chatId, steerIds) {
  return rpc.call('chats.messages.interrupt.deliver', { id: chatId, steer_ids: steerIds });
}

export async function cancelChat(chatId) {
  return rpc.call('chats.cancel', { id: chatId });
}

// Returns a cleanup function. Connects to the chat RPC subscription, calls
// onEvent for each event, onDone when the stream ends, and onError on failure.
export function streamChatEvents(chatId, after, onEvent, onDone, onError) {
  let disposed = false;
  let subscriptionId = '';
  const cleanups = [];

  const matches = params => {
    if (subscriptionId) return params?.subscription_id === subscriptionId;
    return params?.chat_id === chatId;
  };
  cleanups.push(rpc.on('chat.event', params => {
    if (!matches(params)) return;
    onEvent(params.event);
  }));
  cleanups.push(rpc.on('chat.done', params => {
    if (!matches(params)) return;
    onDone?.();
  }));
  cleanups.push(rpc.on('chat.error', params => {
    if (!matches(params)) return;
    onError?.(new Error(params.message || 'Chat stream failed'));
  }));

  rpc.call('chats.events.subscribe', { chat_id: chatId, after: after || 0 })
    .then(result => {
      subscriptionId = result.subscription_id;
      if (disposed && subscriptionId) {
        rpc.call('chats.events.unsubscribe', { subscription_id: subscriptionId }).catch(() => {});
      }
    })
    .catch(err => {
      if (!disposed) onError?.(err);
    });

  return () => {
    disposed = true;
    for (const cleanup of cleanups) cleanup();
    if (subscriptionId) {
      rpc.call('chats.events.unsubscribe', { subscription_id: subscriptionId }).catch(() => {});
    }
  };
}

// ---------- Auto-optimizer ----------

export async function listOptimizerSuggestions() {
  return rpc.call('optimizer.suggestions.list');
}

export async function runOptimizerScan() {
  return rpc.call('optimizer.scan.run');
}

export async function actOnSuggestion(id, action, editedPreview) {
  const params = { id, action };
  if (editedPreview) params.edited_preview = editedPreview;
  return rpc.call('optimizer.suggestions.act', params);
}

export async function getOptimizerSchedule() {
  return rpc.call('optimizer.schedule.get');
}

export async function setOptimizerSchedule(schedule) {
  return rpc.call('optimizer.schedule.set', schedule);
}

export async function getOptimizerScan(id) {
  return rpc.call('optimizer.scans.get', { id });
}

export async function purgeOptimizerScans() {
  return rpc.call('optimizer.scans.purge');
}
