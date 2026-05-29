import React from "react";
import { Agent } from "@/api/types";
import { ErrorItem, RenderableTimelineItem, ThinkingItem, ToolItem } from "@/api/events";
import { AttachmentTray } from "@/ui/AttachmentTray";
import { RichText } from "@/ui/RichText";
import { ToolOutput } from "@/ui/ToolOutput";

export type LoadedToolDetails = Pick<ToolItem, "path" | "input" | "output" | "detail" | "result">;

function resolveAuthor(id: string, agents: Agent[], name?: string) {
  if (id === "__human__") return { name: "You", initial: "Y", human: true };
  const agent = agents.find(item => item.id === id);
  const displayName = agent?.name || name || "Agent";
  return { name: displayName, initial: (displayName || "?")[0].toUpperCase(), human: false };
}

function Avatar({ initial, human, size }: { initial: string; human?: boolean; size?: number }) {
  return (
    <span
      className={`avatar ${human ? "avatar-human" : ""}`}
      style={size ? { width: size, height: size, fontSize: size * 0.45 } : undefined}
    >
      {initial}
    </span>
  );
}

function ThoughtChip({ thought }: { thought: ThinkingItem }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="thought-wrap">
      <button type="button" className="thought-chip" onClick={() => setOpen(value => !value)}>
        <span>{open ? "Thinking" : "Thought"}</span>
        <span className={`tool-caret ${open ? "tool-caret-open" : ""}`}>›</span>
      </button>
      {open ? <p className="thought-text">{thought.reasoning}</p> : null}
    </div>
  );
}

function ErrorDetails({ item }: { item: ErrorItem }) {
  const metadata = [item.subtype, item.code].filter(Boolean).join(" · ");
  const agentMeta = [
    item.agent_name ? `raised by ${item.agent_name}` : "",
    item.target_agent_name ? `target ${item.target_agent_name}` : ""
  ].filter(Boolean).join(" · ");
  return (
    <article className="event-box error-box">
      <div className="message-meta">Error · {item.time}</div>
      {metadata ? <p className="error-meta">{metadata}</p> : null}
      <p className="event-text">{item.message}</p>
      {agentMeta ? <p className="error-meta">{agentMeta}</p> : null}
    </article>
  );
}

function ToolStatus({ result }: { result: ToolItem["result"] }) {
  if (result === "pending") return <span className="tool-status">running</span>;
  if (result === "error") {
    return (
      <span className="tool-status-wrap">
        <span className="tool-dot tool-dot-error" />
        <span className="tool-status tool-status-error">failed</span>
      </span>
    );
  }
  return <span className="tool-dot" />;
}

function toolGroupSummary(events: ToolItem[]): string {
  const groups: Array<{ name: string; count: number }> = [];
  const seen = new Map<string, number>();
  for (const event of events) {
    const index = seen.get(event.tool);
    if (index == null) {
      seen.set(event.tool, groups.length);
      groups.push({ name: event.tool, count: 1 });
    } else {
      groups[index].count += 1;
    }
  }
  return groups.map(group => `${group.name}${group.count > 1 ? ` x${group.count}` : ""}`).join(" · ");
}

function ToolLine({
  tool,
  onLoadToolDetails
}: {
  tool: ToolItem;
  onLoadToolDetails?: (toolCallSeq: number) => Promise<LoadedToolDetails>;
}) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState<LoadedToolDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = React.useState(false);
  const [detailError, setDetailError] = React.useState("");
  const effectiveTool = loaded ? { ...tool, ...loaded, compact: false } : tool;
  const detail = effectiveTool.output || effectiveTool.detail || "";
  const canOpen = Boolean(tool.compact || detail || effectiveTool.path.length > 70);
  const openTool = async () => {
    if (!canOpen) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || !tool.compact || loaded || loadingDetails || !onLoadToolDetails) return;
    setLoadingDetails(true);
    setDetailError("");
    try {
      setLoaded(await onLoadToolDetails(tool._seq));
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load tool details");
    } finally {
      setLoadingDetails(false);
    }
  };
  return (
    <div className={`tool-line ${open ? "tool-line-open" : ""}`}>
      <div className="tool-summary">
        <button
          type="button"
          className="tool-toggle"
          aria-label={`${open ? "Collapse" : "Expand"} ${effectiveTool.tool} details`}
          aria-expanded={open}
          disabled={!canOpen}
          onClick={openTool}
        >
          <span className={`tool-caret ${open ? "tool-caret-open" : ""} ${!canOpen ? "tool-caret-muted" : ""}`}>›</span>
        </button>
        <strong>{effectiveTool.tool}</strong>
        {effectiveTool.path ? <span className="tool-path">{effectiveTool.path}</span> : <span className="tool-flex" />}
        <ToolStatus result={effectiveTool.result} />
      </div>
      {open ? (
        <div className="tool-detail-wrap">
          {loadingDetails ? <p className="tool-loading">Loading details...</p> : null}
          {detailError ? <p className="tool-error">{detailError}</p> : null}
          {effectiveTool.path.length > 70 ? <p className="tool-path-expanded">{effectiveTool.path}</p> : null}
          {detail ? <ToolOutput output={detail} result={effectiveTool.result} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolGutter({
  author,
  authorName,
  time,
  agents,
  showHeader,
  children
}: {
  author: string;
  authorName?: string;
  time: string;
  agents: Agent[];
  showHeader?: boolean;
  children: React.ReactNode;
}) {
  const agent = resolveAuthor(author, agents, authorName);
  return (
    <article className="agent-message-wrap">
      {showHeader === false ? <span className="avatar-spacer" /> : <Avatar initial={agent.initial} human={agent.human} />}
      <div className="agent-content">
        {showHeader === false ? null : (
          <div className="agent-header">
            <strong>{agent.name}</strong>
            <time> · {time}</time>
          </div>
        )}
        {children}
      </div>
    </article>
  );
}

function ToolGroupLine({
  item,
  onLoadToolDetails
}: {
  item: Extract<RenderableTimelineItem, { kind: "tool_group" }>;
  onLoadToolDetails?: (toolCallSeq: number) => Promise<LoadedToolDetails>;
}) {
  const [open, setOpen] = React.useState(false);
  const status = item.events.some(event => event.result === "pending")
    ? "pending"
    : item.events.some(event => event.result === "error")
      ? "error"
      : "ok";
  return (
    <section className={`tool-group ${open ? "tool-line-open" : ""}`}>
      <div className="tool-summary">
        <button
          type="button"
          className="tool-toggle"
          aria-label={`${open ? "Collapse" : "Expand"} tool group details`}
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          <span className={`tool-caret ${open ? "tool-caret-open" : ""}`}>›</span>
        </button>
        <strong className="tool-group-title">Used {item.events.length} tools</strong>
        {open ? <span className="tool-flex" /> : <span className="tool-path">{toolGroupSummary(item.events)}</span>}
        <ToolStatus result={status} />
      </div>
      {open ? (
        <div className="tool-group-details">
          {item.events.map(tool => (
            <ToolLine key={`${tool._seq}:${tool.tool}`} tool={tool} onLoadToolDetails={onLoadToolDetails} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function Timeline({
  items,
  agents,
  onLoadToolDetails
}: {
  items: RenderableTimelineItem[];
  agents: Agent[];
  onLoadToolDetails?: (toolCallSeq: number) => Promise<LoadedToolDetails>;
}) {
  return (
    <div className="timeline">
      {items.map((item, index) => {
        if (item.kind === "handover_divider") {
          const from = resolveAuthor(item.from, agents, item.fromName);
          const to = resolveAuthor(item.to, agents, item.toName);
          return (
            <div className="handover" key={`${item.kind}:${item._seq}:${index}`}>
              <span className="handover-line" />
              <span className="handover-chip">
                <Avatar initial={from.initial} human={from.human} size={18} />
                <span className="handover-text">
                  <span className="muted-text">{from.name}</span>
                  <span>{item.subtype === "return" ? " returned to " : item.subtype === "escalate" ? " escalated to " : " handed off to "}</span>
                  <strong>{to.name}</strong>
                  {item.note ? <span className="muted-text"> · {item.note}</span> : null}
                </span>
                <Avatar initial={to.initial} human={to.human} size={18} />
              </span>
              <span className="handover-line" />
            </div>
          );
        }

        if (item.kind === "message") {
          const author = resolveAuthor(item.author, agents, item.authorName);
          const mine = author.human;
          return (
            <article className={mine ? "user-message-wrap" : "agent-message-wrap"} key={`${item.kind}:${item._seq}:${index}`}>
              {!mine ? (item.showHeader === false ? <span className="avatar-spacer" /> : <Avatar initial={author.initial} />) : null}
              <div className={`bubble ${mine ? "user-bubble" : "agent-bubble"}`}>
                {mine || item.showHeader !== false ? (
                  <div className="message-meta">{author.name} · {item.time}{item.userSteer ? " · Steer" : ""}</div>
                ) : null}
                {item._thought ? <ThoughtChip thought={item._thought} /> : null}
                <RichText text={item.body} />
                <AttachmentTray attachments={item.attachments} />
                {item.optimistic ? <span className="sending-text">Sending</span> : null}
              </div>
            </article>
          );
        }

        if (item.kind === "thinking") {
          const author = resolveAuthor(item.author, agents, item.authorName);
          return (
            <article className="agent-message-wrap" key={`${item.kind}:${item._seq}:${index}`}>
              {item.showHeader === false ? <span className="avatar-spacer" /> : <Avatar initial={author.initial} />}
              <div className="agent-content">
                <div className="message-meta">{author.name} · thinking · {item.time}</div>
                <ThoughtChip thought={item} />
              </div>
            </article>
          );
        }

        if (item.kind === "tool") {
          return (
            <ToolGutter
              key={`${item.kind}:${item._seq}:${index}`}
              author={item.author}
              authorName={item.authorName}
              time={item.time}
              agents={agents}
              showHeader={item.showHeader}
            >
              <ToolLine tool={item} onLoadToolDetails={onLoadToolDetails} />
            </ToolGutter>
          );
        }

        if (item.kind === "tool_group") {
          return (
            <ToolGutter
              key={`${item.kind}:${item._seq}:${index}`}
              author={item.author}
              authorName={item.authorName}
              time={item.time}
              agents={agents}
              showHeader={item.showHeader}
            >
              <ToolGroupLine item={item} onLoadToolDetails={onLoadToolDetails} />
            </ToolGutter>
          );
        }

        if (item.kind === "tool_result") {
          return (
            <article className="event-box" key={`${item.kind}:${item._seq}:${index}`}>
              <div className="message-meta">{item.name || "Tool"} result · {item.time}</div>
              <ToolOutput output={item.output} />
            </article>
          );
        }

        if (item.kind === "error") {
          return <ErrorDetails item={item} key={`${item.kind}:${item._seq}:${index}`} />;
        }

        return null;
      })}
    </div>
  );
}
