import { err, ok } from "@forge-ahead/errors";
import type { HandlerMap } from "./generated/contract";
import { type CommandContext, jiraGet } from "./jira";
import { resolveStartDate } from "./start-date";

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
    status?: { name: string; statusCategory?: { key: string } } | null;
    resolution?: { name: string } | null;
    priority?: { name: string } | null;
    labels?: string[] | null;
    created?: string | null;
    duedate?: string | null;
    [key: string]: unknown;
  };
};

function validScalars(fields: Epic["fields"]): boolean {
  const name = (value: unknown) => typeof value === "string" && !!value.trim();
  for (const key of ["status", "resolution", "priority"] as const) {
    const value = fields[key];
    if (
      value !== null &&
      (!value || typeof value !== "object" || typeof value.name !== "string")
    )
      return false;
  }
  if (fields.status?.statusCategory && !name(fields.status.statusCategory.key))
    return false;
  if (
    fields.labels !== null &&
    (!Array.isArray(fields.labels) || !fields.labels.every(name))
  )
    return false;
  for (const key of ["created", "duedate"] as const) {
    const value = fields[key];
    if (value === null || value === "") continue;
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
      return false;
    const day = value.slice(0, 10);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      new Date(day).toISOString().slice(0, 10) !== day ||
      (key === "duedate" && value !== day)
    )
      return false;
    if (
      key === "created" &&
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:?\d{2})$/.test(
        value,
      )
    )
      return false;
  }
  return true;
}

function scalarFields(fields: Epic["fields"]): string[] {
  const result: string[] = [];
  if (fields.status?.name.trim()) {
    result.push("work_status:", `  name: ${quote(fields.status.name)}`);
    const category = (
      { new: "todo", indeterminate: "in_progress", done: "done" } as Record<
        string,
        string
      >
    )[fields.status.statusCategory?.key ?? ""];
    if (category) result.push(`  category: ${quote(category)}`);
  }
  for (const key of ["resolution", "priority"] as const) {
    if (fields[key]?.name.trim())
      result.push(`${key}: ${quote(fields[key].name)}`);
  }
  if (fields.labels?.length)
    result.push(
      "tags:",
      ...[...new Set(fields.labels)]
        .sort()
        .map((label) => `  - ${quote(label)}`),
    );
  if (fields.created)
    result.push(`created_at: ${quote(new Date(fields.created).toISOString())}`);
  return result;
}

export const exportWorkdown: HandlerMap<
  CommandContext,
  string
>["workdown.export"] = async (params, context) => {
  const { installation, principal } = context;
  if (!params.issue.trim()) return err("invalid-params");
  let issue: Epic;
  try {
    const response = await jiraGet(
      installation,
      principal.authorization,
      `issue/${encodeURIComponent(params.issue)}?fields=summary,issuetype,updated,description,status,resolution,priority,labels,created,duedate,project,security&failFast=true`,
    );
    if ([401, 403, 404].includes(response.status)) return err("forbidden");
    if (!response.ok) return err("eligibility-undetermined");
    issue = (await response.json()) as Epic;
    if (!issue?.fields || typeof issue.fields !== "object")
      return err("eligibility-undetermined");
  } catch {
    return err("eligibility-undetermined");
  }
  if (issue.fields.issuetype.hierarchyLevel !== 1)
    return err("profile-mismatch");
  const security = issue.fields["security"];
  if (
    security &&
    typeof security === "object" &&
    "id" in security &&
    typeof security.id === "string" &&
    /^\d+$/.test(security.id)
  )
    return err("issue-ineligible");
  if (!Object.hasOwn(issue.fields, "security") || security !== null)
    return err("eligibility-undetermined");
  if (
    [
      "status",
      "resolution",
      "priority",
      "labels",
      "created",
      "duedate",
      "project",
    ].some((key) => !Object.hasOwn(issue.fields, key))
  )
    return err("field-unreadable");
  // Only classic projects have observed secured-item detection; next-gen remains gated.
  const project = issue.fields["project"] as { simplified?: unknown } | null;
  if (!project || project.simplified !== false)
    return err("eligibility-undetermined");
  if (!validScalars(issue.fields)) return err("field-unreadable");
  const mapping = await resolveStartDate(
    context,
    (issue.fields["project"] as { id?: unknown } | undefined)?.id,
  );
  if (mapping.error) return err(mapping.error);
  let startDate: unknown;
  if (mapping.id) {
    try {
      const valueResponse = await jiraGet(
        installation,
        principal.authorization,
        `issue/${encodeURIComponent(issue.id)}?fields=${mapping.id}`,
      );
      if (!valueResponse.ok) return err("field-unreadable");
      const value = (await valueResponse.json()) as {
        fields?: Record<string, unknown>;
      };
      if (!value.fields || !Object.hasOwn(value.fields, mapping.id))
        return err("field-unreadable");
      startDate = value.fields[mapping.id];
      if (
        startDate !== null &&
        startDate !== "" &&
        (typeof startDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
          !Number.isFinite(Date.parse(startDate)) ||
          new Date(startDate).toISOString().slice(0, 10) !== startDate)
      )
        return err("field-unreadable");
    } catch {
      return err("field-unreadable");
    }
  }
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
    `key: ${quote(issue.key)}`,
    ...scalarFields(issue.fields),
    `updated_at: ${quote(updated)}`,
    ...(startDate ? [`start_date: ${quote(startDate)}`] : []),
    ...(issue.fields.duedate
      ? [`due_date: ${quote(issue.fields.duedate)}`]
      : []),
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
