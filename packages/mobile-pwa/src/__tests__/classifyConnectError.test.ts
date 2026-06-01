import { describe, expect, it } from "vitest";
import { classifyConnectError } from "@/client/classifyConnectError";
import { connectionIssueTitle } from "@/client/connectionIssue";
import { DesktopOfflineError, DesktopTimeoutError, RelayConnectionError } from "@/remote/relay";

describe("classifyConnectError", () => {
  it("classifies desktop offline errors as desktop issues", () => {
    expect(classifyConnectError(new DesktopOfflineError())).toEqual({
      issue: "desktop",
      message: "Can't connect to the Crew44 desktop"
    });
  });

  it("classifies desktop timeout errors as desktop timeout issues", () => {
    expect(classifyConnectError(new DesktopTimeoutError())).toEqual({
      issue: "desktop_timeout",
      message: "The Crew44 desktop did not respond within 10 seconds."
    });
  });

  it("keeps relay socket failures as relay issues", () => {
    expect(classifyConnectError(new RelayConnectionError("Relay socket failed"))).toEqual({
      issue: "relay",
      message: "Relay socket failed"
    });
  });

  it("maps connection issues to the expected titles", () => {
    expect(connectionIssueTitle("relay")).toBe("Relay connection issue");
    expect(connectionIssueTitle("desktop")).toBe("Can't connect to the Crew44 desktop");
    expect(connectionIssueTitle("desktop_timeout")).toBe("Crew44 desktop timed out");
  });
});
