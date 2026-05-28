import React from "react";
import { Agent } from "@/api/types";
import { RenderableTimelineItem, ToolItem } from "@/api/events";

function resolveAuthor(id: string, agents: Agent[], name?: string) {
  if (id === "__human__") return { name: "You", initial: "Y", human: true };
  const agent = agents.find(item => item.id === id);
  const displayName = agent?.name || name || "Agent";
  return { name: displayName, initial: (displayName || "?")[0].toUpperCase(), human: false };
}

function Avatar({ initial, human }: { initial: string; human?: boolean }) {
  return <span className={`avatar ${human ? "avatar-human" : ""}`}>{initial}</span>;
}

function ToolStatus({ result }: { result: ToolItem["result"] }) {
  if (result === "pending") return <span className="tool-status">running</span>;
  return <span className={`tool-dot ${result === "error" ? "tool-dot-error" : ""}`} />;
}

function ToolLine({ tool }: { tool: ToolItem }) {
  const [open, setOpen] = React.useState(false);
  const detail = tool.output || tool.detail || "";
  return (
    <div className="tool-line">
      <button type="button" className="tool-summary" onClick={() => setOpen(value => !value)}>
        <span>{open ? "⌄" : "›"}</span>
        <strong>{tool.tool}</strong>
        <span className="tool-path">{tool.path}</span>
        <ToolStatus result={tool.result} />
      </button>
      {open && detail ? <pre className="tool-detail">{detail}</pre> : null}
    </div>
  );
}

export function Timeline({
  items,
  agents
}: {
  items: RenderableTimelineItem[];
  agents: Agent[];
}) {
  return (
    <div className="timeline">
      {items.map((item, index) => {
        if (item.kind === "handover_divider") {
          const from = resolveAuthor(item.from, agents, item.fromName);
          const to = resolveAuthor(item.to, agents, item.toName);
          return (
            <div className="handover" key={`${item.kind}:${item._seq}:${index}`}>
              <span>{from.name}</span>
              <span>{item.subtype === "return" ? "returned to" : item.subtype === "escalate" ? "escalated to" : "handed off to"}</span>
              <strong>{to.name}</strong>
              {item.note ? <em>{item.note}</em> : null}
            </div>
          );
        }

        if (item.kind === "message") {
          const author = resolveAuthor(item.author, agents, item.authorName);
          return (
            <article className={`message ${item.role === "user" ? "message-user" : ""}`} key={`${item.kind}:${item._seq}:${index}`}>
              {item.showHeader !== false ? (
                <header>
                  <Avatar initial={author.initial} human={author.human} />
                  <strong>{author.name}</strong>
                  <time>{item.time}</time>
                </header>
              ) : null}
              {item._thought ? (
                <details className="thought">
                  <summary>Thought</summary>
                  <p>{item._thought.reasoning}</p>
                </details>
              ) : null}
              <p className="message-body">{item.body}</p>
            </article>
          );
        }

        if (item.kind === "thinking") {
          const author = resolveAuthor(item.author, agents, item.authorName);
          return (
            <article className="message message-muted" key={`${item.kind}:${item._seq}:${index}`}>
              <header>
                <Avatar initial={author.initial} />
                <strong>{author.name}</strong>
                <time>{item.time}</time>
              </header>
              <p className="message-body">{item.reasoning}</p>
            </article>
          );
        }

        if (item.kind === "tool") {
          return <ToolLine key={`${item.kind}:${item._seq}:${index}`} tool={item} />;
        }

        if (item.kind === "tool_group") {
          return (
            <section className="tool-group" key={`${item.kind}:${item._seq}:${index}`}>
              <div className="tool-group-title">Used {item.events.length} tools</div>
              {item.events.map(tool => <ToolLine key={`${tool._seq}:${tool.tool}`} tool={tool} />)}
            </section>
          );
        }

        if (item.kind === "error") {
          return (
            <article className="message message-error" key={`${item.kind}:${item._seq}:${index}`}>
              <strong>{item.code || "Error"}</strong>
              <p>{item.message}</p>
            </article>
          );
        }

        return null;
      })}
    </div>
  );
}
