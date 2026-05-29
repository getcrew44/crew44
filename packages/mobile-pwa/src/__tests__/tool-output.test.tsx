import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolOutput, toolOutputSections } from "@/ui/ToolOutput";

describe("ToolOutput", () => {
  it("unwraps JSON string output instead of showing literal quotes", () => {
    expect(toolOutputSections(JSON.stringify("Command running in background")).at(0)?.text).toBe("Command running in background");
  });

  it("renders unwrapped text without JSON quotes", () => {
    const html = renderToStaticMarkup(<ToolOutput output={JSON.stringify("Command running in background")} />);

    expect(html).toContain("Command running in background");
    expect(html).not.toContain("&quot;Command running in background&quot;");
  });
});
