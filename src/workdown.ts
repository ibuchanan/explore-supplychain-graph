import { err, ok } from "@forge-ahead/errors";
import type { HandlerMap } from "./generated/contract";
import { type CommandContext, jiraGet } from "./jira";

const quote = JSON.stringify;
const escapeMarkdown = (text: string) =>
  text.replace(/[\\`*_{}[\]<>()#+!|~>-]/g, "\\$&");

type Node = {
  type: string;
  version?: number;
  text?: string;
  marks?: unknown[];
  content?: Node[];
};
function descriptionText(value: unknown): string {
  if (value === null) return "No description provided.";
  const doc = value as Node;
  if (doc?.type !== "doc" || doc.version !== 1 || !Array.isArray(doc.content))
    throw new Error("Invalid description");
  const paragraphs = doc.content.map((paragraph) => {
    if (
      paragraph.type !== "paragraph" ||
      !Array.isArray(paragraph.content ?? [])
    )
      throw new Error("Rich descriptions require ticket 07");
    return (paragraph.content ?? [])
      .map((node) => {
        if (
          node.type !== "text" ||
          typeof node.text !== "string" ||
          node.marks?.length
        )
          throw new Error("Unsupported inline content");
        return escapeMarkdown(node.text.replace(/\r\n?/g, "\n"));
      })
      .join("");
  });
  return paragraphs.join("\n\n").trim() || "No description provided.";
}

type Epic = {
  id: string;
  key: string;
  fields: {
    summary: string;
    updated: string;
    issuetype: { name: string; hierarchyLevel: number };
    description: unknown;
  };
};

export const exportWorkdown: HandlerMap<
  CommandContext,
  string
>["workdown.export"] = async (params, context) => {
  const { installation, principal } = context;
  if (!params.issue.trim()) return err("invalid-params");
  const response = await jiraGet(
    installation,
    principal.authorization,
    `issue/${encodeURIComponent(params.issue)}?fields=summary,issuetype,updated,description`,
  );
  if ([401, 403, 404].includes(response.status)) return err("forbidden");
  if (!response.ok) return err("internal-error");
  const issue = (await response.json()) as Epic;
  if (issue.fields.issuetype.hierarchyLevel !== 1)
    return err("profile-mismatch");
  const server = await jiraGet(
    installation,
    principal.authorization,
    "serverInfo",
  );
  if (!server.ok) return err("internal-error");
  const { baseUrl } = (await server.json()) as { baseUrl: string };
  if (
    !/^\d+$/.test(issue.id) ||
    typeof issue.key !== "string" ||
    !issue.key.trim() ||
    typeof issue.fields.summary !== "string" ||
    /[\r\n]/.test(issue.fields.summary)
  )
    return err("internal-error");
  if (new URL(baseUrl).protocol !== "https:") return err("internal-error");
  const sourceId = `ari:cloud:jira:${installation.cloudId}:issue/${issue.id}`;
  const resource = `${new URL(baseUrl).origin}/browse/${encodeURIComponent(issue.key)}`;
  const title = issue.fields.summary;
  const updated = new Date(issue.fields.updated).toISOString();
  const sourceDate = issue.fields.updated.slice(0, 10);
  if (new Date(sourceDate).toISOString().slice(0, 10) !== sourceDate)
    return err("internal-error");
  const document = [
    "---",
    'format: "workdown"',
    "format_version: 1",
    'type: "WorkItem"',
    `source_id: ${quote(sourceId)}`,
    `title: ${quote(title)}`,
    `resource: ${quote(resource)}`,
    `work_type: ${quote(issue.fields.issuetype.name)}`,
    `updated_at: ${quote(updated)}`,
    "generated:",
    '  by: "workdown/1"',
    "sources:",
    `  - id: ${quote(sourceId)}`,
    `    resource: ${quote(resource)}`,
    `    title: ${quote(title)}`,
    `    last_modified: ${quote(updated)}`,
    "---",
    "",
    `# ${escapeMarkdown(title)}`,
    "",
    "## Description",
    "",
    descriptionText(issue.fields.description),
    "",
  ].join("\n");
  return ok(document);
};
