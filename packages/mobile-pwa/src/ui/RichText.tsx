import React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

type Align = "left" | "center" | "right" | undefined;

type InlineToken =
  | { kind: "text"; value: string }
  | { kind: "file"; value: string }
  | { kind: "ref"; value: string }
  | { kind: "bold"; value: string }
  | { kind: "italic"; value: string }
  | { kind: "code"; value: string }
  | { kind: "link"; label: string; url: string }
  | { kind: "math"; value: string; displayMode: false };

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "hr" }
  | { kind: "code"; lines: string[]; lang: string }
  | { kind: "math"; value: string; displayMode: true }
  | { kind: "table"; header: string[]; alignments: Align[]; rows: string[][] }
  | { kind: "ul" | "ol"; items: string[] };

function pushTextToken(tokens: InlineToken[], text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  if (last?.kind === "text") last.value += text;
  else tokens.push({ kind: "text", value: text });
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let plainStart = 0;
  let i = 0;

  const flushPlain = (end: number) => {
    pushTextToken(tokens, text.slice(plainStart, end));
    plainStart = end;
  };

  while (i < text.length) {
    if (text.startsWith("{{file:", i) || text.startsWith("{{ref:", i)) {
      const close = text.indexOf("}}", i + 2);
      if (close !== -1) {
        flushPlain(i);
        const raw = text.slice(i + 2, close);
        const sep = raw.indexOf(":");
        const kind = raw.slice(0, sep);
        if (kind === "file" || kind === "ref") tokens.push({ kind, value: raw.slice(sep + 1) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: "bold", value: text.slice(i + 2, close) });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: "code", value: text.slice(i + 1, close) });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    if (text.startsWith("\\(", i)) {
      const close = text.indexOf("\\)", i + 2);
      if (close !== -1) {
        flushPlain(i);
        tokens.push({ kind: "math", value: text.slice(i + 2, close), displayMode: false });
        i = close + 2;
        plainStart = i;
        continue;
      }
    }

    if (text[i] === "$" && text[i + 1] !== "$") {
      const close = text.indexOf("$", i + 1);
      const value = close === -1 ? "" : text.slice(i + 1, close);
      if (close !== -1 && value && value.trim() === value) {
        flushPlain(i);
        tokens.push({ kind: "math", value, displayMode: false });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    const link = text[i] === "[" ? text.slice(i).match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/) : null;
    if (link) {
      flushPlain(i);
      tokens.push({ kind: "link", label: link[1], url: link[2] });
      i += link[0].length;
      plainStart = i;
      continue;
    }

    if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      const value = close === -1 ? "" : text.slice(i + 1, close);
      if (close !== -1 && value && !value.includes("\n")) {
        flushPlain(i);
        tokens.push({ kind: "italic", value });
        i = close + 1;
        plainStart = i;
        continue;
      }
    }

    i += 1;
  }

  pushTextToken(tokens, text.slice(plainStart));
  return tokens;
}

function MathNode({ value, displayMode = false }: { value: string; displayMode?: boolean }) {
  const html = katex.renderToString(value, {
    displayMode,
    throwOnError: false,
    strict: "ignore",
    trust: false
  });
  const Tag = displayMode ? "div" : "span";
  return (
    <Tag
      className={displayMode ? "cw-math-block" : "cw-math-inline"}
      aria-label={value}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((token, index) => {
        if (token.kind === "bold") return <strong key={index}>{token.value}</strong>;
        if (token.kind === "italic") return <em key={index}>{token.value}</em>;
        if (token.kind === "code" || token.kind === "file") return <code key={index}>{token.value}</code>;
        if (token.kind === "ref") return <span key={index} className="rich-ref">@{token.value}</span>;
        if (token.kind === "math") return <MathNode key={index} value={token.value} displayMode={token.displayMode} />;
        if (token.kind === "link") return <a key={index} href={token.url} target="_blank" rel="noreferrer">{token.label}</a>;
        return <React.Fragment key={index}>{token.value}</React.Fragment>;
      })}
    </>
  );
}

function splitTableRow(line: string): string[] | null {
  let value = line.trim();
  if (!value.includes("|")) return null;
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "`") inCode = !inCode;
    if (char === "\\" && !inCode) {
      const next = value[index + 1];
      if (next === "|" || next === "\\") {
        cell += next;
        index += 1;
        continue;
      }
      cell += char;
      continue;
    }
    if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseDelimiterRow(line: string): Align[] | null {
  const cells = splitTableRow(line);
  if (!cells || cells.length < 1) return null;
  const alignments: Align[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    alignments.push(left && right ? "center" : right ? "right" : left ? "left" : undefined);
  }
  return alignments;
}

function parseTableAt(lines: string[], start: number): { block: Block; nextIndex: number } | null {
  const header = splitTableRow(lines[start]);
  if (!header || !lines[start + 1]) return null;
  const alignments = parseDelimiterRow(lines[start + 1]);
  if (!alignments || alignments.length !== header.length) return null;

  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length) {
    const raw = lines[index].replace(/\s+$/, "");
    if (!raw.trim() || !raw.includes("|")) break;
    const row = splitTableRow(raw);
    if (!row) break;
    rows.push(header.map((_, cellIndex) => row[cellIndex] || ""));
    index += 1;
  }

  return { block: { kind: "table", header, alignments, rows }, nextIndex: index };
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: "ul" | "ol" }> | null = null;
  let fence: { lang: string; lines: string[] } | null = null;
  let mathBlock: { end: "$$" | "\\]"; lines: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  const flushList = () => {
    if (list?.items.length) blocks.push(list);
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const fenceMatch = raw.match(/^\s*```\s*([\w+-]*)\s*$/);

    if (fence) {
      if (fenceMatch) {
        blocks.push({ kind: "code", lang: fence.lang, lines: fence.lines });
        fence = null;
      } else {
        fence.lines.push(raw);
      }
      continue;
    }

    if (mathBlock) {
      if (raw.trim() === mathBlock.end) {
        blocks.push({ kind: "math", displayMode: true, value: mathBlock.lines.join("\n") });
        mathBlock = null;
      } else {
        mathBlock.lines.push(raw);
      }
      continue;
    }

    if (fenceMatch) {
      flushPara();
      flushList();
      fence = { lang: fenceMatch[1] || "", lines: [] };
      continue;
    }

    const line = raw.replace(/\s+$/, "");
    const singleLineDollarMath = line.match(/^\s*\$\$\s*(\S[\s\S]*?)\s*\$\$\s*$/);
    const singleLineBracketMath = line.match(/^\s*\\\[\s*(\S[\s\S]*?)\s*\\\]\s*$/);
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    const bullet = /^\s*[-*]\s+/.test(line);
    const numbered = line.match(/^\s*\d+\.\s+(.+)$/);
    const hr = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    const table = parseTableAt(lines, index);

    if (singleLineDollarMath || singleLineBracketMath) {
      flushPara();
      flushList();
      blocks.push({ kind: "math", displayMode: true, value: singleLineDollarMath?.[1] || singleLineBracketMath?.[1] || "" });
    } else if (line.trim() === "$$" || line.trim() === "\\[") {
      flushPara();
      flushList();
      mathBlock = { end: line.trim() === "$$" ? "$$" : "\\]", lines: [] };
    } else if (table) {
      flushPara();
      flushList();
      blocks.push(table.block);
      index = table.nextIndex - 1;
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", level: heading[1].length, text: heading[2] });
    } else if (hr) {
      flushPara();
      flushList();
      blocks.push({ kind: "hr" });
    } else if (bullet) {
      flushPara();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(line.replace(/^\s*[-*]\s+/, ""));
    } else if (numbered) {
      flushPara();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(numbered[1]);
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  if (fence) blocks.push({ kind: "code", lang: fence.lang, lines: fence.lines });
  if (mathBlock) blocks.push({ kind: "math", displayMode: true, value: mathBlock.lines.join("\n") });
  flushPara();
  flushList();
  return blocks;
}

function Paragraph({ lines, compact }: { lines: string[]; compact?: boolean }) {
  return (
    <p className={`rich-text-p ${compact ? "rich-text-compact" : ""}`}>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <br /> : null}
          <InlineText text={line} />
        </React.Fragment>
      ))}
    </p>
  );
}

function RichTable({ block }: { block: Extract<Block, { kind: "table" }> }) {
  return (
    <div className="rich-table-wrap">
      <table className="rich-table">
        <thead>
          <tr>
            {block.header.map((cell, cellIndex) => (
              <th key={cellIndex} style={{ textAlign: block.alignments[cellIndex] || "left" }}>
                <InlineText text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} style={{ textAlign: block.alignments[cellIndex] || "left" }}>
                  <InlineText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RichText({ text }: { text: string }) {
  if (!text) return null;
  const blocks = parseBlocks(text);
  if (blocks.length === 1 && blocks[0].kind === "p") {
    return <Paragraph lines={blocks[0].lines} compact />;
  }
  return (
    <div className="rich-text">
      {blocks.map((block, index) => {
        if (block.kind === "h") {
          const tag = `h${Math.min(block.level + 1, 6)}`;
          return React.createElement(tag, { key: index }, <InlineText text={block.text} />);
        }
        if (block.kind === "hr") return <hr key={index} />;
        if (block.kind === "code") return <pre key={index} className="rich-code">{block.lines.join("\n")}</pre>;
        if (block.kind === "math") return <MathNode key={index} value={block.value} displayMode={block.displayMode} />;
        if (block.kind === "table") return <RichTable key={index} block={block} />;
        if (block.kind === "p") return <Paragraph key={index} lines={block.lines} />;
        if (block.kind === "ul" || block.kind === "ol") {
          const ListTag = block.kind;
          return (
            <ListTag key={index} className="rich-list">
              {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}
            </ListTag>
          );
        }
        return null;
      })}
    </div>
  );
}
