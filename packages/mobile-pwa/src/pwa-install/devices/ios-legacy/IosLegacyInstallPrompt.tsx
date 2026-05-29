import { InstallCloseButton, InstallPromptProps } from "../types";
import "./IosLegacyInstallPrompt.css";

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M6 11v8h12v-8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IosLegacyInstallPrompt({ onClose }: InstallPromptProps) {
  return (
    <div className="ios-legacy-install-overlay" role="dialog" aria-modal="true" aria-labelledby="ios-legacy-install-title">
      <section className="ios-legacy-install-sheet">
        <InstallCloseButton onClose={onClose} />
        <img className="ios-legacy-install-icon" src="/icons/icon-192.png" alt="" aria-hidden="true" />
        <h2 id="ios-legacy-install-title">Install Crew44 Mobile</h2>
        <p>Tap the share button in the bottom toolbar, then tap Add to Home Screen.</p>
        <div className="ios-legacy-phone" aria-hidden="true">
          <div className="ios-legacy-page" />
          <div className="ios-legacy-toolbar">
            <span />
            <span className="ios-legacy-share"><ShareIcon /></span>
            <span />
          </div>
        </div>
        <div className="ios-legacy-action-row" aria-hidden="true">
          <span><PlusIcon /></span>
          <strong>Add to Home Screen</strong>
        </div>
      </section>
    </div>
  );
}
