import React from "react";

export type InstallTarget = "ios-modern" | "ios-legacy" | "android-non-chrome" | "android-chrome" | "unsupported";

export interface InstallPromptProps {
  onClose: () => void;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt: () => Promise<void>;
}

export function InstallCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="pwa-install-close" aria-label="Close install guide" onClick={onClose}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}
