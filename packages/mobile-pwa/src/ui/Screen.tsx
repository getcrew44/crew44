import React from "react";

export function Screen({ children }: { children: React.ReactNode }) {
  return <main className="screen">{children}</main>;
}

export function Header({
  title,
  left,
  right
}: {
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="header">
      {left ? <div className="header-side">{left}</div> : null}
      <h1>{title}</h1>
      {right ? <div className="header-side header-right">{right}</div> : null}
    </header>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button"
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={`button button-${variant}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  disabled,
  type = "button"
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className="icon-button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Row({
  title,
  subtitle,
  onClick,
  right
}: {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {subtitle ? <span className="row-subtitle">{subtitle}</span> : null}
      </span>
      {right ? <span className="row-right">{right}</span> : <span className="chevron">›</span>}
    </button>
  );
}

export function EmptyState({ title, body, children }: { title: string; body?: string; children?: React.ReactNode }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
      {children}
    </section>
  );
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function OfflineState({
  title,
  message,
  onRetry,
  onUnpair
}: {
  title: string;
  message: string;
  onRetry: () => void;
  onUnpair: () => void;
}) {
  return (
    <EmptyState title={title} body={message}>
      <div className="button-row">
        <Button onClick={onRetry}>Retry</Button>
        <Button variant="danger" onClick={onUnpair}>Unpair</Button>
      </div>
    </EmptyState>
  );
}
