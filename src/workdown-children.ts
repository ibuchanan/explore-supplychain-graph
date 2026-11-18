import { type CommandContext, jiraGet } from "./jira";

export const escapeMarkdown = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/[\\`*_{}[\]<>()#+!|~>-]/g, "\\$&");

export type Child = {
  source_id: string;
  title: string;
  resource: string;
  work_type: string;
  key?: string;
  work_status?: { name: string; category?: string };
  resolution?: string;
};

export function childrenTable(children: Child[]): string {
  if (!children.length) return "";
  return [
    "## Children",
    "",
    "| Work item | Type | Status | Resolution |",
    "| --- | --- | --- | --- |",
    ...children.map(
      (child) =>
        `| [${escapeMarkdown(child.key ? `${child.key}: ${child.title}` : child.title)}](${child.resource}) | ${escapeMarkdown(child.work_type)} | ${child.work_status ? escapeMarkdown(child.work_status.name) : "—"} | ${child.resolution ? escapeMarkdown(child.resolution) : "—"} |`,
    ),
  ].join("\n");
}

export async function readChildren(
  context: CommandContext,
  parentId: string,
  origin: string,
): Promise<Child[]> {
  const query = new URLSearchParams({
    jql: `parent = ${parentId}`,
    fields: "summary,issuetype,status,resolution,parent,project,security",
    maxResults: "100",
    failFast: "true",
  });
  type Issue = {
    id: string;
    key: string;
    fields: {
      summary: string;
      issuetype: { name: string; subtask: boolean };
      parent: { id: string };
      project: { simplified: boolean };
      security: { id: string } | null;
      status: { name: string; statusCategory?: { key: string } } | null;
      resolution: { name: string } | null;
    };
  };
  const issues: Issue[] = [];
  const identities = new Set([parentId]);
  const tokens = new Set<string>();
  let token: string | undefined;
  do {
    if (token) query.set("nextPageToken", token);
    const response = await jiraGet(
      context.installation,
      context.principal.authorization,
      `search/jql?${query}`,
    );
    if (!response.ok) throw new Error("Children unreadable");
    const page = (await response.json()) as {
      issues: Issue[];
      isLast: boolean;
      nextPageToken?: string | null;
      warnings?: unknown;
    };
    if (
      !page ||
      !Array.isArray(page.issues) ||
      typeof page.isLast !== "boolean" ||
      (page.warnings !== undefined &&
        (!Array.isArray(page.warnings) || page.warnings.length)) ||
      (page.isLast
        ? page.nextPageToken != null
        : typeof page.nextPageToken !== "string" ||
          !page.nextPageToken ||
          tokens.has(page.nextPageToken))
    )
      throw new Error("Children unreadable");
    for (const issue of page.issues) {
      const fields = issue?.fields;
      const security = fields?.security;
      if (
        security &&
        typeof security === "object" &&
        typeof security.id === "string" &&
        /^\d+$/.test(security.id)
      )
        continue;
      const nonempty = (value: unknown): value is string =>
        typeof value === "string" && !!value.trim() && !/[\r\n]/.test(value);
      if (
        !fields ||
        !Object.hasOwn(fields, "security") ||
        security !== null ||
        fields.project?.simplified !== false ||
        fields.parent?.id !== parentId ||
        fields.issuetype?.subtask !== false ||
        !nonempty(fields.issuetype?.name) ||
        typeof issue.id !== "string" ||
        !/^\d+$/.test(issue.id) ||
        identities.has(issue.id) ||
        !nonempty(issue.key) ||
        !nonempty(fields.summary)
      )
        throw new Error("Children unreadable");
      for (const name of ["status", "resolution"] as const) {
        const value = fields[name];
        if (
          value !== null &&
          (!value ||
            typeof value !== "object" ||
            typeof value.name !== "string" ||
            /[\r\n]/.test(value.name))
        )
          throw new Error("Children unreadable");
      }
      if (
        fields.status?.statusCategory != null &&
        !nonempty(fields.status.statusCategory.key)
      )
        throw new Error("Children unreadable");
      identities.add(issue.id);
      issues.push(issue);
    }
    token = page.isLast ? undefined : (page.nextPageToken ?? undefined);
    if (token) tokens.add(token);
  } while (token);
  issues.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return issues.map((issue) => {
    const category = (
      { new: "todo", indeterminate: "in_progress", done: "done" } as Record<
        string,
        string
      >
    )[issue.fields.status?.statusCategory?.key ?? ""];
    return {
      source_id: `ari:cloud:jira:${context.installation.cloudId}:issue/${issue.id}`,
      title: issue.fields.summary,
      resource: `${origin}/browse/${encodeURIComponent(issue.key)}`,
      work_type: issue.fields.issuetype.name,
      key: issue.key,
      ...(issue.fields.status?.name.trim()
        ? {
            work_status: {
              name: issue.fields.status.name,
              ...(category ? { category } : {}),
            },
          }
        : {}),
      ...(issue.fields.resolution?.name.trim()
        ? { resolution: issue.fields.resolution.name }
        : {}),
    };
  });
}

export function childLines(child: Child): string[] {
  return [
    `  - source_id: ${JSON.stringify(child.source_id)}`,
    `    title: ${JSON.stringify(child.title)}`,
    `    resource: ${JSON.stringify(child.resource)}`,
    `    work_type: ${JSON.stringify(child.work_type)}`,
    ...(child.key ? [`    key: ${JSON.stringify(child.key)}`] : []),
    ...(child.work_status
      ? [
          "    work_status:",
          `      name: ${JSON.stringify(child.work_status.name)}`,
          ...(child.work_status.category
            ? [`      category: ${JSON.stringify(child.work_status.category)}`]
            : []),
        ]
      : []),
    ...(child.resolution
      ? [`    resolution: ${JSON.stringify(child.resolution)}`]
      : []),
  ];
}
