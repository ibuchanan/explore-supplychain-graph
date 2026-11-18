import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
import { validateFrontmatter } from "./generated/frontmatter.js";
import { childrenTable } from "./workdown-children";

export function validateWorkdown(text: unknown): boolean {
  if (
    typeof text !== "string" ||
    !text.startsWith("---\n") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    text.endsWith("\n\n")
  )
    return false;
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return false;
  try {
    const doc = parseDocument(text.slice(4, end), {
      uniqueKeys: true,
      schema: "core",
    });
    if (doc.errors.length || doc.warnings.length || !isMap(doc.contents))
      return false;
    let safe = true;
    visit(doc, {
      Node(_key, node) {
        if (
          isAlias(node) ||
          ("anchor" in node && node.anchor) ||
          ("tag" in node && node.tag)
        )
          safe = false;
        if (
          _key !== "key" &&
          isScalar(node) &&
          typeof node.value === "string" &&
          !["QUOTE_DOUBLE", "QUOTE_SINGLE"].includes(node.type ?? "")
        )
          safe = false;
        if (
          isScalar(node) &&
          typeof node.value !== "string" &&
          !Number.isInteger(node.value)
        )
          safe = false;
        if (!isScalar(node) && !isMap(node) && !isSeq(node)) safe = false;
      },
    });
    if (!safe) return false;
    const data = doc.toJS({ maxAliasCount: 0 });
    if (!validateFrontmatter(data)) return false;
    for (const key of ["created_at", "updated_at", "start_date", "due_date"]) {
      const value = data[key];
      if (
        value !== undefined &&
        (!Number.isFinite(Date.parse(value)) ||
          (key.endsWith("_date")
            ? new Date(value).toISOString().slice(0, 10) !== value
            : new Date(value).toISOString() !== value))
      )
        return false;
    }
    for (const source of data.sources) {
      if (
        source.last_modified !== undefined &&
        (!Number.isFinite(Date.parse(source.last_modified)) ||
          new Date(source.last_modified).toISOString() !== source.last_modified)
      )
        return false;
    }
    if (
      data.tags &&
      (new Set(data.tags).size !== data.tags.length ||
        [...data.tags].sort().some((tag, index) => tag !== data.tags[index]))
    )
      return false;
    const primary = data.sources[0];
    if (
      primary.id !== data.source_id ||
      primary.resource !== data.resource ||
      primary.title !== data.title ||
      primary.last_modified !== data.updated_at
    )
      return false;
    const children = data.children ?? [];
    const ids = [
      data.source_id,
      ...children.map((item: { source_id: string }) => item.source_id),
    ];
    if (new Set(ids).size !== ids.length || data.sources.length !== ids.length)
      return false;
    if (data.parent && ids.includes(data.parent.source_id)) return false;
    if (
      children.some(
        (
          item: { source_id: string; resource: string; title: string },
          index: number,
        ) => {
          const source = data.sources[index + 1];
          return (
            source.id !== item.source_id ||
            source.resource !== item.resource ||
            source.title !== item.title ||
            "last_modified" in source
          );
        },
      )
    )
      return false;
    const escapeTitle = (value: string) =>
      value.replace(/[\\`*_{}[\]<>()#+!|~>-]/g, "\\$&");
    if (
      !text
        .slice(end + 5)
        .startsWith(`\n# ${escapeTitle(data.title)}\n\n## Description\n\n`)
    )
      return false;
    const body = text.slice(end + 5);
    const sections: number[] = [];
    let fence: { character: string; length: number } | undefined;
    let offset = 0;
    for (const line of body.split("\n")) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      const run = marker?.[1] ?? "";
      if (fence) {
        if (
          run.startsWith(fence.character) &&
          run.length >= fence.length &&
          !marker?.[2]?.trim()
        )
          fence = undefined;
      } else if (marker) {
        fence = { character: run.charAt(0), length: run.length };
      } else if (/^## Children\s*$/.test(line)) {
        sections.push(offset);
      }
      offset += line.length + 1;
    }
    if (children.length) {
      if (
        sections.length !== 1 ||
        body.slice(sections[0]) !== `${childrenTable(children)}\n`
      )
        return false;
    } else if (sections.length) return false;
    return true;
  } catch {
    return false;
  }
}
