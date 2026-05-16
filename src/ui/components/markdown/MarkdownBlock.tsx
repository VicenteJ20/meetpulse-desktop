import type { ReactNode } from "react";
import { clsx } from "clsx";

export type MarkdownBlockData =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "meta"; label: string; value: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "code"; text: string; language?: string }
  | { type: "divider" };

type MarkdownInlinePart =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "em"; value: string }
  | { type: "code"; value: string };

export function MarkdownBlock({ block, tab }: { block: MarkdownBlockData; tab?: string }) {
  const isTranscript = tab === "transcription";

  if (block.type === "heading") {
    const Tag = `h${Math.min(6, Math.max(1, block.level))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    const className = clsx(
      "markdown-heading",
      block.level === 1 && "is-h1",
      block.level === 2 && "is-h2",
      block.level === 3 && "is-h3",
      block.level >= 4 && "is-minor",
    );
    return <Tag className={className}>{renderMarkdownInline(block.text)}</Tag>;
  }

  if (block.type === "code") {
    return (
      <pre className="markdown-code-block">
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.type === "table") {
    return (
      <div className="markdown-table-wrap">
        <table className="markdown-table">
          <thead>
            <tr>
              {block.headers.map((header, index) => (
                <th key={`${header}-${index}`}>{renderMarkdownInline(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {block.headers.map((_, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>{renderMarkdownInline(row[cellIndex] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "list") {
    const ListTag = block.ordered ? "ol" : "ul";
    return (
      <ListTag className={clsx("markdown-list", block.ordered && "is-ordered")}>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderMarkdownInline(item)}</li>
        ))}
      </ListTag>
    );
  }

  if (block.type === "quote") {
    return <blockquote className="markdown-quote">{renderMarkdownInline(block.text)}</blockquote>;
  }

  if (block.type === "meta") {
    return (
      <p className="markdown-meta">
        <span>{renderMarkdownInline(block.label)}</span>
        <strong>{renderMarkdownInline(block.value)}</strong>
      </p>
    );
  }

  if (block.type === "divider") {
    return <hr className="markdown-divider" />;
  }

  if (isTranscript) {
    const speakerMatch = block.text.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (speakerMatch) {
      return (
        <p className="transcript-line">
          <span className="transcript-speaker">{speakerMatch[1]}</span>
          <span className="transcript-text">{renderMarkdownInline(speakerMatch[2])}</span>
        </p>
      );
    }
    return <p className="transcript-line transcript-plain">{renderMarkdownInline(block.text)}</p>;
  }

  return <p className="markdown-paragraph">{renderMarkdownInline(block.text)}</p>;
}

function renderMarkdownInline(text: string): ReactNode {
  return parseMarkdownInline(text).map((part, index) => {
    if (part.type === "strong") return <strong key={`${part.value}-${index}`}>{part.value}</strong>;
    if (part.type === "em") return <em key={`${part.value}-${index}`}>{part.value}</em>;
    if (part.type === "code") return <code key={`${part.value}-${index}`}>{part.value}</code>;
    return <span key={`${part.value}-${index}`}>{part.value}</span>;
  });
}

function parseMarkdownInline(value: string): MarkdownInlinePart[] {
  const parts: MarkdownInlinePart[] = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) });
    }

    if (match[6]) {
      parts.push({ type: "code", value: match[6] });
    } else if (match[2] ?? match[3]) {
      parts.push({ type: "strong", value: match[2] ?? match[3] ?? "" });
    } else if (match[4] ?? match[5]) {
      parts.push({ type: "em", value: match[4] ?? match[5] ?? "" });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: "text", value }];
}
