import React from "react";
import { hasHandledPwaInstallPrompt, markPwaInstallPromptHandled } from "./dismissal";
import { PWA_PAIRED_EVENT } from "./events";
import { AndroidNonChromeInstallPrompt } from "./devices/android-non-chrome/AndroidNonChromeInstallPrompt";
import { detectInstallTarget, isStandalonePwa } from "./devices/detectInstallTarget";
import { IosLegacyInstallPrompt } from "./devices/ios-legacy/IosLegacyInstallPrompt";
import { IosModernInstallPrompt } from "./devices/ios-modern/IosModernInstallPrompt";
import { BeforeInstallPromptEvent, InstallTarget } from "./devices/types";

export function PwaInstallPromptController() {
  const [target, setTarget] = React.useState<InstallTarget>("unsupported");
  const deferredPromptRef = React.useRef<BeforeInstallPromptEvent | null>(null);

  React.useEffect(() => {
    if (isStandalonePwa()) {
      markPwaInstallPromptHandled();
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (hasHandledPwaInstallPrompt()) return;
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
    };
    const onAppInstalled = () => {
      markPwaInstallPromptHandled();
      setTarget("unsupported");
      deferredPromptRef.current = null;
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  React.useEffect(() => {
    if (target !== "unsupported") markPwaInstallPromptHandled();
  }, [target]);

  React.useEffect(() => {
    const onPaired = () => {
      if (isStandalonePwa()) {
        markPwaInstallPromptHandled();
        return;
      }
      if (hasHandledPwaInstallPrompt()) return;

      const nextTarget = detectInstallTarget();
      if (nextTarget === "android-chrome") {
        const prompt = deferredPromptRef.current;
        if (!prompt) return;
        markPwaInstallPromptHandled();
        prompt.prompt().then(() => prompt.userChoice).catch(() => {}).finally(() => {
          if (deferredPromptRef.current === prompt) deferredPromptRef.current = null;
        });
        return;
      }
      if (nextTarget !== "unsupported") setTarget(nextTarget);
    };
    window.addEventListener(PWA_PAIRED_EVENT, onPaired);
    return () => window.removeEventListener(PWA_PAIRED_EVENT, onPaired);
  }, []);

  const closePrompt = () => {
    setTarget("unsupported");
  };

  if (target === "ios-modern") return <IosModernInstallPrompt onClose={closePrompt} />;
  if (target === "ios-legacy") return <IosLegacyInstallPrompt onClose={closePrompt} />;
  if (target === "android-non-chrome") return <AndroidNonChromeInstallPrompt onClose={closePrompt} />;
  return null;
}
