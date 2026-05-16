import type { MarkdownBlockData } from "../components/markdown/MarkdownBlock";

export function parseMarkdownBlocks(content?: string | null): MarkdownBlockData[] {
  if (!content) return [];
  const normalized = content.replace(/^---[\s\S]*?---\s*/m, "");
  const withSpeakerBreaks = normalized.replace(/(\[Speaker\s+\d+\])/gi, "\n$1");
  const blocks: MarkdownBlockData[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let paragraphLines: string[] = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: "list", ordered: listOrdered, items: listItems });
      listItems = [];
    }
  }

  const lines = withSpeakerBreaks.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", text: codeLines.join("\n"), language: fence[1] });
      continue;
    }

    if (isMarkdownTableHeader(line, lines[index + 1]?.trim() ?? "")) {
      flushParagraph();
      flushList();
      const headers = splitMarkdownTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index].trim())) {
        rows.push(splitMarkdownTableRow(lines[index].trim()));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: stripMarkdownContainers(heading[2]) });
      continue;
    }

    const unorderedListItem = line.match(/^[-*+]\s+(.+)$/);
    const orderedListItem = line.match(/^\d+[.)]\s+(.+)$/);
    if (unorderedListItem || orderedListItem) {
      flushParagraph();
      const ordered = Boolean(orderedListItem);
      if (listItems.length > 0 && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      listItems.push(stripMarkdownContainers((orderedListItem ?? unorderedListItem)?.[1] ?? ""));
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: stripMarkdownContainers(line.replace(/^>\s*/, "")) });
      continue;
    }

    if (/^\[Speaker\s+\d+\]/i.test(line)) {
      flushParagraph();
      flushList();
      paragraphLines.push(stripMarkdownContainers(line));
      continue;
    }

    flushList();
    paragraphLines.push(stripMarkdownContainers(line));
  }

  flushParagraph();
  flushList();
  return blocks.slice(0, 120);
}

export function markdownBlocksToPlainText(blocks: MarkdownBlockData[], fallback: string): string {
  if (blocks.length === 0) return markdownToPlainText(fallback);

  return blocks
    .flatMap((block) => {
      if (block.type === "heading" || block.type === "paragraph" || block.type === "quote") return [block.text];
      if (block.type === "meta") return [`${block.label}: ${block.value}`];
      if (block.type === "list") return block.items;
      if (block.type === "code") return [block.text];
      if (block.type === "table") return [[block.headers.join(" | "), ...block.rows.map((row) => row.join(" | "))].join("\n")];
      return [];
    })
    .map((line) => markdownToPlainText(line).trim())
    .filter(Boolean)
    .join("\n\n");
}

export function markdownToPlainText(value: string): string {
  return value
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/```[\w-]*\n([\s\S]*?)```/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isMarkdownTableHeader(line: string, nextLine: string): boolean {
  return isMarkdownTableRow(line) && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine);
}

function isMarkdownTableRow(line: string): boolean {
  return line.includes("|") && line.split("|").filter((cell) => cell.trim()).length >= 2;
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripMarkdownContainers(cell.trim()));
}

function stripMarkdownContainers(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .trim();
}
