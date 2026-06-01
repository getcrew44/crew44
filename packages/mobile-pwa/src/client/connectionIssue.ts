export type ConnectionIssue = "" | "relay" | "desktop" | "desktop_timeout";

export function connectionIssueTitle(issue: ConnectionIssue): string {
  if (issue === "relay") return "Relay connection issue";
  if (issue === "desktop_timeout") return "Crew44 desktop timed out";
  return "Can't connect to the Crew44 desktop";
}
