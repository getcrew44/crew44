import { InstallTarget } from "./types";

function isIos(userAgent: string): boolean {
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function iosMajorVersion(userAgent: string): number {
  const match = userAgent.match(/OS (\d+)_/);
  return match ? Number(match[1]) : 17;
}

export function isStandalonePwa(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export function detectInstallTarget(): InstallTarget {
  if (isStandalonePwa()) return "unsupported";

  const userAgent = navigator.userAgent;
  const ios = isIos(userAgent);
  const android = /Android/i.test(userAgent);

  if (ios) {
    return iosMajorVersion(userAgent) < 13 ? "ios-legacy" : "ios-modern";
  }

  if (android) {
    const chrome = /Chrome|CriOS/i.test(userAgent) && !/EdgA|SamsungBrowser|Firefox|FxiOS|OPR\//i.test(userAgent);
    return chrome ? "android-chrome" : "android-non-chrome";
  }

  return "unsupported";
}
