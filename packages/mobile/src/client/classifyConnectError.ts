import type { ConnectionIssue } from "@/client/connectionIssue";
import { DesktopOfflineError, DesktopTimeoutError, RelayConnectionError } from "@/remote/relay";

export type ConnectErrorClassification = {
  issue: Exclude<ConnectionIssue, "">;
  message: string;
};

export function classifyConnectError(err: unknown): ConnectErrorClassification {
  if (err instanceof DesktopOfflineError) {
    return { issue: "desktop", message: "Can't connect to the Crew44 desktop" };
  }

  if (err instanceof DesktopTimeoutError) {
    return {
      issue: "desktop_timeout",
      message: "The Crew44 desktop did not respond within 10 seconds."
    };
  }

  if (err instanceof RelayConnectionError) {
    return { issue: "relay", message: err.message };
  }

  return {
    issue: "desktop",
    message: err instanceof Error ? err.message : "Can't connect to the Crew44 desktop"
  };
}
