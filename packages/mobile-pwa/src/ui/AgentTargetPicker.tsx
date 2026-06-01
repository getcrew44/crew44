import React from "react";
import { Agent } from "@/api/types";

function initialFor(agent?: Agent): string {
  return (agent?.name || "?")[0].toUpperCase();
}

function AgentAvatar({ agent, size = 20 }: { agent?: Agent; size?: number }) {
  return (
    <span
      className="agent-picker-avatar"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initialFor(agent)}
    </span>
  );
}

export function AgentTargetPicker({
  agents,
  value,
  onChange,
  disabled = false
}: {
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  const selected = agents.find(agent => agent.id === value) || agents[0];

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!selected) return null;

  return (
    <div className="agent-picker" ref={ref}>
      {open ? (
        <div className="agent-picker-menu" role="listbox" aria-label="Direct to">
          <div className="agent-picker-label">Direct to</div>
          {agents.map(agent => {
            const active = agent.id === selected.id;
            return (
              <button
                type="button"
                key={agent.id}
                className={`agent-picker-item ${active ? "agent-picker-item-active" : ""}`}
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(agent.id);
                  setOpen(false);
                }}
              >
                <AgentAvatar agent={agent} size={22} />
                <span className="agent-picker-item-name">{agent.name}</span>
                {active ? <span className="agent-picker-check">✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <button
        type="button"
        className="agent-picker-chip"
        disabled={disabled}
        title={`Talking to ${selected.name}`}
        onClick={() => setOpen(value => !value)}
      >
        <AgentAvatar agent={selected} size={20} />
        <span>{selected.name}</span>
        <span className={`agent-picker-caret ${open ? "agent-picker-caret-open" : ""}`}>›</span>
      </button>
    </div>
  );
}
