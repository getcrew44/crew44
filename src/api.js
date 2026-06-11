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

export async function listProjectFiles(projectId, query, limit = 50, chatId = '') {
  const data = await rpc.call('projects.files.list', { id: projectId, chat_id: chatId || '', query: query || '', limit });
  return data.items || [];
}

export async function readProjectFile(projectId, path, chatId = '') {
  return rpc.call('projects.files.read', { id: projectId, chat_id: chatId || '', path });
}

export async function getProjectGitDiff(projectId, chatId = '') {
  const data = await rpc.call('projects.git.diff', { id: projectId, chat_id: chatId || '' });
  return data.items || [];
}

// getGitInfo reports whether a project workdir is a git repo plus the branches
// available as worktree bases. Powers the New Task worktree controls.
export async function getGitInfo(projectId) {
  return rpc.call('projects.git.info', { id: projectId });
}

export async function listAgents() {
  const data = await rpc.call('agents.list');
  return data.items || [];
}

export async function createAgent(name, description, instruction, runtimeId, model) {
  return rpc.call('agents.create', { name, description, instruction, runtime_id: runtimeId, model });
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

export async function createChat(projectId, title, mainAgentId, { useWorktree, baseRef, goalMode, id } = {}) {
  const params = { project_id: projectId, title, main_agent_id: mainAgentId };
  if (useWorktree !== undefined) params.use_worktree = useWorktree;
  if (baseRef) params.base_ref = baseRef;
  if (goalMode) params.goal_mode = true;
  if (id) params.id = id;
  return rpc.call('chats.create', params);
}

// answers: [{ question_id, option }] for chips, [{ question_id, text }] for
// free text. Locks in the clarify round and starts the goal-lock turn.
// clarifySeq is required by the daemon: it binds the answers to the clarify
// round they answer (the seq of that round's goal_clarify event, mirrored on
// chat.goal.clarify_seq), so a stale submission against a superseded round
// is rejected instead of silently mis-applied.
export async function answerGoal(chatId, answers, clarifySeq) {
  return rpc.call('chats.goal.answer', { id: chatId, answers, clarify_seq: clarifySeq });
}

// Whole-list replacement: criteria not in the list are removed, changed
// criteria reset to pending and the gate re-arms.
export async function updateGoalCriteria(chatId, { statement, criteria }) {
  const params = { id: chatId, criteria };
  if (statement !== undefined) params.statement = statement;
  return rpc.call('chats.goal.criteria.update', params);
}

export async function signoffGoal(chatId, action, notes = '') {
  return rpc.call('chats.goal.signoff', { id: chatId, action, notes });
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
// onEvent for each event, onChatUpdated when chat metadata changes (e.g.
// auto-title applied), onDone when the stream ends, and onError on failure.
export function streamChatEvents(chatId, after, onEvent, onDone, onError, onChatUpdated) {
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
  cleanups.push(rpc.on('chat.updated', params => {
    if (!matches(params)) return;
    onChatUpdated?.(params.chat);
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

// ---------- Recruit ----------

export async function listRecruitAgents() {
  const data = await rpc.call('recruit.agents.list');
  return data.items || [];
}

export async function getRecruitAgent(id) {
  return rpc.call('recruit.agents.get', { id });
}

export async function installRecruitAgent(id) {
  return rpc.call('recruit.agents.install', { id });
}
