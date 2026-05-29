import { InstallCloseButton, InstallPromptProps } from "../types";
import "./AndroidNonChromeInstallPrompt.css";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10.5V20h11v-9.5" />
      <path d="M10 20v-5h4v5" />
    </svg>
  );
}

export function AndroidNonChromeInstallPrompt({ onClose }: InstallPromptProps) {
  return (
    <div className="android-non-chrome-install-overlay" role="dialog" aria-modal="true" aria-labelledby="android-non-chrome-install-title">
      <section className="android-non-chrome-install-sheet">
        <InstallCloseButton onClose={onClose} />
        <img className="android-non-chrome-install-icon" src="/icons/icon-192.png" alt="" aria-hidden="true" />
        <h2 id="android-non-chrome-install-title">Install Crew44 Mobile</h2>
        <p>Open the browser menu, then choose Install app or Add to Home screen.</p>
        <div className="android-non-chrome-browser" aria-hidden="true">
          <div className="android-non-chrome-bar">
            <span>mobileapp.crew44.io</span>
            <strong><MenuIcon /></strong>
          </div>
          <div className="android-non-chrome-menu">
            <div>
              <HomeIcon />
              <span>Install app</span>
            </div>
            <div>
              <HomeIcon />
              <span>Add to Home screen</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
