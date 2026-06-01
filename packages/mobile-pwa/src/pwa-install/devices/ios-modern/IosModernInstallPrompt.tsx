import { InstallCloseButton, InstallPromptProps } from "../types";
import "./IosModernInstallPrompt.css";

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15V3" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M6 11v8h12v-8" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IosModernInstallPrompt({ onClose }: InstallPromptProps) {
  return (
    <div className="ios-modern-install-overlay" role="dialog" aria-modal="true" aria-labelledby="ios-modern-install-title">
      <section className="ios-modern-install-sheet">
        <InstallCloseButton onClose={onClose} />
        <img className="ios-modern-install-icon" src="/icons/icon-192.png" alt="" aria-hidden="true" />
        <h2 id="ios-modern-install-title">Install Crew44 Mobile</h2>
        <p>Tap the Safari share button, then choose Add to Home Screen.</p>
        <div className="ios-modern-install-steps" aria-hidden="true">
          <div className="ios-modern-browser-bar">
            <span>mobileapp.crew44.io</span>
            <span className="ios-modern-share"><ShareIcon /></span>
          </div>
          <div className="ios-modern-action-row">
            <span><AddIcon /></span>
            <strong>Add to Home Screen</strong>
          </div>
        </div>
      </section>
    </div>
  );
}
