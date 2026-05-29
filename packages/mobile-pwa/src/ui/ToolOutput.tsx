import React from "react";

type ToolOutputSection = {
  label: string;
  text: string;
};

export function toolOutputSections(rawOutput: string): ToolOutputSection[] {
  if (!rawOutput) return [];
  try {
    const parsed = JSON.parse(rawOutput);
    if (typeof parsed === "string") return [{ label: "", text: parsed }];
    return [{ label: "", text: rawOutput }];
  } catch {
    return [{ label: "", text: rawOutput }];
  }
}

export function ToolOutput({ output, result }: { output: string; result?: "ok" | "pending" | "error" }) {
  const sections = toolOutputSections(output);
  if (sections.length === 0) return null;
  return (
    <div className="tool-output">
      {sections.map((section, index) => (
        <div key={`${section.label || "output"}-${index}`} className={index > 0 ? "tool-output-section" : undefined}>
          {section.label ? (
            <div className={`tool-output-label ${section.label === "stderr" ? "tool-output-label-error" : ""}`}>
              {section.label}
            </div>
          ) : null}
          <pre className={`tool-pre-text ${result === "error" || section.label === "stderr" ? "tool-pre-text-error" : ""}`}>
            {section.text}
          </pre>
        </div>
      ))}
    </div>
  );
}
