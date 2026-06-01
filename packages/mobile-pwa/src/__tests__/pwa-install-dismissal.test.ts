import { afterEach, describe, expect, it, vi } from "vitest";
import { hasHandledPwaInstallPrompt, markPwaInstallPromptHandled } from "@/pwa-install/dismissal";

describe("PWA install prompt dismissal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists that the install prompt has been handled", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        }
      }
    });

    expect(hasHandledPwaInstallPrompt()).toBe(false);

    markPwaInstallPromptHandled();

    expect(hasHandledPwaInstallPrompt()).toBe(true);
  });

  it("does not throw when localStorage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        }
      }
    });

    expect(hasHandledPwaInstallPrompt()).toBe(false);
    expect(() => markPwaInstallPromptHandled()).not.toThrow();
  });
});
