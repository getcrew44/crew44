const AGENT_PALETTE = [
  '#C4644A', '#B8553E', '#D17F58', '#9C6B47',
  '#6E5A45', '#A8A05C', '#7A8C6E', '#5A7A8C',
  '#8C5A7A', '#6E8C5A',
];

export function agentColor(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (((h << 5) + h) + id.charCodeAt(i)) | 0;
  return AGENT_PALETTE[Math.abs(h) % AGENT_PALETTE.length];
}

export function agentInitial(name) {
  return (name || '?')[0].toUpperCase();
}

export function relativeTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d)) return '';
  const sec = Math.floor((Date.now() - d) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h';
  if (sec < 604800) return Math.floor(sec / 86400) + 'd';
  return Math.floor(sec / 604800) + 'w';
}

export function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d)) return isoString;
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

export const HUMAN_USER = {
  id: '__human__',
  name: 'You',
  kind: 'human',
  color: '#A8A05C',
  initial: 'Y',
};

// Session-local memory of every agent we have seen this run. Lets us still
// label messages from agents that have since been deleted from the live list.
// Not persisted — a hard reload starts empty.
const seenAgentsCache = new Map();

export function rememberAgents(agentsMap) {
  if (!agentsMap) return;
  for (const agent of Object.values(agentsMap)) {
    if (agent?.id && agent.id !== '__human__' && agent.kind === 'agent') {
      seenAgentsCache.set(agent.id, agent);
    }
  }
}

// Exposed for tests.
export function __resetSeenAgentsCacheForTests() {
  seenAgentsCache.clear();
}

// Look up an event's author. Returns HUMAN_USER for human messages, the live
// agent record when available, the session-remembered agent flagged as
// archived if it's no longer live, or a generic placeholder as a last resort.
export function resolveAuthor(authorId, agentsMap) {
  if (!authorId) return null;
  if (authorId === '__human__') return HUMAN_USER;
  const known = agentsMap?.[authorId];
  if (known) return known;
  const remembered = seenAgentsCache.get(authorId);
  if (remembered) return { ...remembered, archived: true };
  return {
    id: authorId,
    name: 'Deleted agent',
    kind: 'agent',
    role: '',
    color: agentColor(authorId),
    initial: '?',
    archived: true,
  };
}

export function displayAgent(cfg, runtimesById) {
  if (!cfg) return null;
  const runtime = runtimesById?.[cfg.runtime_id];
  const role = runtime?.name || cfg.model || 'Agent';
  return {
    id: cfg.id,
    name: cfg.name,
    kind: 'agent',
    role,
    color: agentColor(cfg.id),
    initial: agentInitial(cfg.name),
    // keep all original fields
    ...cfg,
  };
}

// Surface the meaningful content of a tool's input — the command, query, or
// prompt the model actually wrote — rather than the JSON envelope around it.
// Falls back to the JSON dump only when no string values are present.
function summarizeToolInput(input) {
  if (input == null) return '';
  if (typeof input !== 'object') return String(input);
  const preferred = ['command', 'cmd', 'path', 'file_path', 'file', 'args', 'query', 'prompt', 'pattern', 'url'];
  for (const key of preferred) {
    const v = input[key];
    if (typeof v === 'string' && v) return v;
  }
  const values = Object.values(input).filter(v => typeof v === 'string' && v);
  if (values.length) return values.join(' ');
  return JSON.stringify(input);
}

export function mapBackendEvent(event) {
  const ts = formatTime(event.ts);
  const tsISO = event.ts || '';

  if (event.type === 'message') {
    const attachments = event.message?.attachments || [];
    return {
      kind: 'message',
      author: event.message?.role === 'user' ? '__human__' : event.actor_agent_id,
      time: ts,
      tsISO,
      body: event.message?.content || '',
      ...(event.message?.user_steer ? { userSteer: true } : {}),
      ...(event.message?.steer_agent_id ? { steerAgentId: event.message.steer_agent_id } : {}),
      ...(event.message?.interrupted ? { interrupted: true } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      _seq: event.seq,
    };
  }
  if (event.type === 'thinking') {
    return {
      kind: 'thinking',
      author: event.actor_agent_id,
      time: ts,
      tsISO,
      seconds: 0,
      reasoning: event.thinking?.content || '',
      _seq: event.seq,
    };
  }
  if (event.type === 'tool_call') {
    const input = event.tool_call?.input || null;
    return {
      kind: 'tool',
      author: event.actor_agent_id,
      time: ts,
      tsISO,
      tool: event.tool_call?.name || 'tool',
      path: summarizeToolInput(input),
      // Preserve the raw input so downstream consumers (e.g. the files drawer)
      // can pick out file_path/path/paths without re-parsing the human-readable
      // summary.
      input,
      result: 'pending',
      _seq: event.seq,
    };
  }
  if (event.type === 'tool_call_result') {
    return {
      kind: 'tool_result',
      author: event.actor_agent_id,
      time: ts,
      tsISO,
      name: event.tool_call_result?.name || '',
      output: event.tool_call_result?.output || '',
      _seq: event.seq,
    };
  }
  if (event.type === 'runtime_session') {
    // Mapped so renderers can skip it explicitly rather than silently
    // dropping at the SSE boundary.
    return { kind: 'runtime_session', author: event.actor_agent_id, time: ts, tsISO, _seq: event.seq };
  }
  if (event.type === 'handover') {
    // Backend convention: Event.actor_agent_id is the source agent (the one
    // handing off); the Handover payload's agent_id is the destination.
    return {
      kind: 'handover',
      author: event.actor_agent_id,
      time: ts,
      tsISO,
      subtype: event.handover?.subtype || 'delegate',
      agent_id: event.actor_agent_id,
      target_agent_id: event.handover?.agent_id || '',
      target_agent_name: event.handover?.agent_name || '',
      note: event.handover?.note || '',
      _seq: event.seq,
    };
  }
  if (event.type === 'error') {
    return {
      kind: 'error',
      author: event.actor_agent_id,
      time: ts,
      tsISO,
      subtype: event.error?.subtype || 'error',
      code: event.error?.code || '',
      message: event.error?.message || '',
      agent_id: event.error?.agent_id || event.actor_agent_id || '',
      agent_name: event.error?.agent_name || '',
      target_agent_id: event.error?.target_agent_id || '',
      target_agent_name: event.error?.target_agent_name || '',
      _seq: event.seq,
    };
  }
  return null;
}

export function mergeToolResults(events) {
  const out = [];
  for (const ev of events) {
    if (ev.kind === 'tool_result') {
      // Find last pending tool with same name
      let merged = false;
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].kind === 'tool' && out[i].tool === ev.name && out[i].result === 'pending') {
          out[i] = { ...out[i], result: 'ok', detail: ev.output?.slice(0, 120) };
          merged = true;
          break;
        }
      }
      if (!merged) {
        // show as standalone result
        out.push(ev);
      }
    } else {
      out.push(ev);
    }
  }
  return out;
}
