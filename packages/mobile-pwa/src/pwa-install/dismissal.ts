const PWA_INSTALL_DISMISSED_KEY = "crew44:pwa-install-dismissed";

export function hasHandledPwaInstallPrompt(): boolean {
  try {
    return window.localStorage.getItem(PWA_INSTALL_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPwaInstallPromptHandled(): void {
  try {
    window.localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, "1");
  } catch {
    // If storage is unavailable, the prompt remains session-scoped.
  }
}
