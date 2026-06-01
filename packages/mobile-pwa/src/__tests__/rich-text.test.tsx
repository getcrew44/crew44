import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RichText } from "@/ui/RichText";

describe("RichText", () => {
  it("renders markdown pipe tables with inline formatting and alignment", () => {
    const html = renderToStaticMarkup(<RichText text={[
      "| Name | Score |",
      "| --- | ---: |",
      "| Ada | **10** |",
      "| Lin | `8` |"
    ].join("\n")} />);

    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Ada");
    expect(html).toContain("<strong>10</strong>");
    expect(html).toContain("<code>8</code>");
    expect(html).toContain("text-align:right");
  });

  it("renders inline and display math with KaTeX", () => {
    const inline = renderToStaticMarkup(<RichText text="Use $x^2 + 1$ here." />);
    const block = renderToStaticMarkup(<RichText text={"$$\n\\int_0^1 x^2 dx\n$$"} />);

    expect(inline).toContain("cw-math-inline");
    expect(inline).toContain("katex");
    expect(inline).not.toContain("$x^2 + 1$");
    expect(block).toContain("cw-math-block");
    expect(block).toContain("katex-display");
  });

  it("preserves LaTeX backslashes inside table cells", () => {
    const html = renderToStaticMarkup(<RichText text={[
      "| Dist | PDF |",
      "| --- | --- |",
      "| Normal | $\\frac{1}{\\sigma\\sqrt{2\\pi}}$ |"
    ].join("\n")} />);

    expect(html).toContain("<table");
    expect(html).toContain("katex");
    expect(html).not.toContain("frac{1}{sigmasqrt");
  });

  it("renders fenced code blocks", () => {
    const html = renderToStaticMarkup(<RichText text={"```ts\nconst value = 1;\n```"} />);

    expect(html).toContain("rich-code");
    expect(html).toContain("const value = 1;");
  });
});
