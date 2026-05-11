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

export function displayAgent(cfg) {
  if (!cfg) return null;
  return {
    id: cfg.id,
    name: cfg.name,
    kind: 'agent',
    role: cfg.model || 'Agent',
    color: agentColor(cfg.id),
    initial: agentInitial(cfg.name),
    // keep all original fields
    ...cfg,
  };
}

export function mapBackendEvent(event) {
  const ts = formatTime(event.ts);

  if (event.type === 'message') {
    return {
      kind: 'message',
      author: event.message?.role === 'user' ? '__human__' : event.actor_agent_id,
      time: ts,
      body: event.message?.content || '',
      _seq: event.seq,
    };
  }
  if (event.type === 'thinking') {
    return {
      kind: 'thinking',
      author: event.actor_agent_id,
      time: ts,
      seconds: 0,
      reasoning: event.thinking?.content || '',
      _seq: event.seq,
    };
  }
  if (event.type === 'tool_call') {
    const input = event.tool_call?.input;
    const path = input?.path || input?.file || (typeof input === 'object' ? JSON.stringify(input) : String(input || ''));
    return {
      kind: 'tool',
      author: event.actor_agent_id,
      time: ts,
      tool: event.tool_call?.name || 'tool',
      path,
      result: 'pending',
      _seq: event.seq,
    };
  }
  if (event.type === 'tool_call_result') {
    return {
      kind: 'tool_result',
      author: event.actor_agent_id,
      time: ts,
      name: event.tool_call_result?.name || '',
      output: event.tool_call_result?.output || '',
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
