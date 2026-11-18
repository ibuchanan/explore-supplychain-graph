import { escapeMarkdown } from "./workdown-children";

type Node = {
  type: string;
  version?: number;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: Node[];
};
const omitted = "[unsupported content omitted]";
const normalize = (text: string) => text.replace(/\r\n?/g, "\n");
const literal = (text: string) => escapeMarkdown(normalize(text));

function destination(value: unknown, origin: string): string | undefined {
  if (
    typeof value !== "string" ||
    !value ||
    /\s/.test(value) ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return;
  try {
    const url = new URL(value, origin);
    if (
      !["https:", "http:", "mailto:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href.replace(
      /[()<>`\\|]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    return;
  }
}

export function descriptionText(value: unknown, origin: string): string {
  if (value === null) return "No description provided.";
  const doc = value as Node;
  if (doc?.type !== "doc" || doc.version !== 1 || !Array.isArray(doc.content))
    throw new Error("Invalid description");
  const content = (node: Node): Node[] => {
    if (node.content !== undefined && !Array.isArray(node.content))
      throw new Error("Invalid description content");
    return node.content ?? [];
  };
  const render = (node: Node, heading = false, cell = false): string => {
    if (!node || typeof node.type !== "string")
      throw new Error("Invalid description node");
    switch (node.type) {
      case "text": {
        if (
          typeof node.text !== "string" ||
          (node.marks !== undefined && !Array.isArray(node.marks))
        )
          throw new Error("Invalid description text");
        const marks = node.marks ?? [];
        const code = marks.some((mark) => mark.type === "code");
        if (!node.text.trim() && (heading || !code)) {
          const whitespace = normalize(node.text);
          return heading || cell ? whitespace.replace(/\n/g, " ") : whitespace;
        }
        let text = code ? normalize(node.text) : literal(node.text);
        if (heading || cell) text = text.replace(/\n/g, " ");
        if (code && cell) text = text.replace(/\|/g, "\\|");
        if (code) {
          const fence = "`".repeat(
            Math.max(
              0,
              ...[...text.matchAll(/`+/g)].map(([run]) => run.length),
            ) + 1,
          );
          const pad =
            /^`|`$/.test(text) || (/^ .* $/s.test(text) && !!text.trim())
              ? " "
              : "";
          text = `${fence}${pad}${text}${pad}${fence}`;
        }
        for (const mark of marks) {
          switch (mark.type) {
            case "code":
              break;
            case "strong":
              if (!heading) text = `**${text}**`;
              break;
            case "em":
              text = `*${text}*`;
              break;
            case "link": {
              const href = destination(mark.attrs?.["href"], origin);
              if (href && text.trim()) text = `[${text}](${href})`;
              break;
            }
            default:
              text += omitted;
          }
        }
        return text;
      }
      case "hardBreak":
        return heading || cell ? " " : "  \n";
      case "mention": {
        if (typeof node.attrs?.["text"] !== "string") return omitted;
        const text = literal(node.attrs["text"]);
        return heading || cell ? text.replace(/\n/g, " ") : text;
      }
      case "paragraph":
        return content(node)
          .map((child) => render(child, heading, cell))
          .join("");
      case "heading": {
        const text = content(node)
          .map((child) => render(child, true, cell))
          .join("")
          .trim();
        return text ? `**${text}**` : "";
      }
      case "blockquote":
        return blocks(content(node))
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
      case "listItem":
        return blocks(content(node));
      case "bulletList":
      case "orderedList": {
        const start = node.attrs?.["order"] ?? 1;
        if (
          node.type === "orderedList" &&
          (!Number.isSafeInteger(start) || Number(start) < 0)
        )
          return omitted;
        return content(node)
          .map((item, index) => {
            const prefix =
              node.type === "bulletList" ? "- " : `${Number(start) + index}. `;
            const lines = (
              item.type === "listItem" ? render(item) : omitted
            ).split("\n");
            return lines
              .map(
                (line, i) => `${i ? " ".repeat(prefix.length) : prefix}${line}`,
              )
              .join("\n");
          })
          .join("\n");
      }
      case "codeBlock": {
        if (
          content(node).some(
            (child) => child.type !== "text" || typeof child.text !== "string",
          )
        )
          return omitted;
        const text = normalize(
          content(node)
            .map((child) => child.text)
            .join(""),
        );
        const fence = "`".repeat(
          Math.max(2, ...[...text.matchAll(/`+/g)].map(([run]) => run.length)) +
            1,
        );
        const language = node.attrs?.["language"];
        const info =
          typeof language === "string" && /^[a-zA-Z0-9_+-]+$/.test(language)
            ? language
            : "";
        return `${fence}${info}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
      }
      case "table": {
        const rows = content(node);
        const width = rows[0] ? content(rows[0]).length : 0;
        if (
          !width ||
          rows.some(
            (row) =>
              row.type !== "tableRow" ||
              content(row).length !== width ||
              content(row).some(
                (cell) =>
                  !["tableHeader", "tableCell"].includes(cell.type) ||
                  (cell.attrs?.["colspan"] ?? 1) !== 1 ||
                  (cell.attrs?.["rowspan"] ?? 1) !== 1,
              ),
          )
        )
          return omitted;
        const lines = rows.map(
          (row) =>
            `| ${content(row)
              .map((cell) =>
                content(cell)
                  .map((child) => {
                    if (!["paragraph", "heading"].includes(child.type))
                      return omitted;
                    return render(child, false, true);
                  })
                  .join(" ")
                  .replace(/\n/g, " "),
              )
              .join(" | ")} |`,
        );
        if (
          content(rows[0] as Node).some((cell) => cell.type !== "tableHeader")
        )
          lines.unshift(`| ${Array(width).fill("").join(" | ")} |`);
        lines.splice(1, 0, `| ${Array(width).fill("---").join(" | ")} |`);
        return lines.join("\n");
      }
      case "rule":
        return "---";
      case "media":
      case "mediaSingle":
      case "mediaGroup":
        return "[media omitted]";
      default:
        return omitted;
    }
  };
  const blocks = (nodes: Node[]) =>
    nodes
      .map((node) => render(node))
      .filter(Boolean)
      .join("\n\n");
  return blocks(doc.content).trim() || "No description provided.";
}
