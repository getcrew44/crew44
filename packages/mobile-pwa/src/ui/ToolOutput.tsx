import React from "react";

type ToolOutputSection = {
  label: string;
  text: string;
};

function isMultiline(text: string): boolean {
  return text.includes("\n");
}

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
          <pre
            className={[
              "tool-pre-text",
              isMultiline(section.text) ? "tool-pre-text-multiline" : "tool-pre-text-singleline",
              result === "error" || section.label === "stderr" ? "tool-pre-text-error" : ""
            ].filter(Boolean).join(" ")}
          >
            {section.text}
          </pre>
        </div>
      ))}
    </div>
  );
}
