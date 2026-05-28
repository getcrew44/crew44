export function BackIcon() {
  return <span className="back-symbol" aria-hidden="true">‹</span>;
}

export function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="12.5" cy="8" r="1" />
    </svg>
  );
}

export function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4" y="4" width="8" height="8" rx="1.2" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 8.5 13.5 2.5 11 13.5 8 9.5 2 8.5z" />
      <path d="M8 9.5 13.5 2.5" />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.5 4 6.4 2.5h3.2L10.5 4H13a1.2 1.2 0 0 1 1.2 1.2v6.6A1.2 1.2 0 0 1 13 13H3a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 3 4h2.5z" />
      <circle cx="8" cy="8.5" r="2.4" />
    </svg>
  );
}
