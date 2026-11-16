import { type CommandContext, jiraGet } from "./jira";

type Field = {
  id: string;
  stableId?: string;
  schema: { type: string; custom?: string };
};
type Resolution = {
  id?: string;
  error?: "field-unreadable" | "field-unresolved";
};

async function catalog(
  context: CommandContext,
  project?: string,
): Promise<Field[] | undefined> {
  const fields: Field[] = [];
  let total: number | undefined;
  // Bound pathological or changing catalogs; never return a partial mapping.
  for (let page = 0; page < 1000; page++) {
    const response = await jiraGet(
      context.installation,
      context.principal.authorization,
      `field/search?expand=stableId&startAt=${fields.length}&maxResults=100${project ? `&projectIds=${encodeURIComponent(project)}` : ""}`,
    );
    if (!response.ok) return;
    const data = (await response.json()) as {
      startAt: number;
      total: number;
      isLast: boolean;
      values: Field[];
    };
    if (
      !Number.isInteger(data.total) ||
      data.total < 0 ||
      data.startAt !== fields.length ||
      !Array.isArray(data.values) ||
      typeof data.isLast !== "boolean" ||
      (total !== undefined && total !== data.total)
    )
      return;
    total = data.total;
    if (
      data.values.some(
        (field) =>
          !field ||
          typeof field.id !== "string" ||
          !field.schema ||
          typeof field.schema.type !== "string" ||
          (field.id.startsWith("customfield_") &&
            (typeof field.stableId !== "string" || !field.stableId.trim())),
      )
    )
      return;
    fields.push(...data.values);
    if (
      new Set(fields.map((field) => field.id)).size !== fields.length ||
      fields.length > total
    )
      return;
    if (data.isLast) return fields.length === total ? fields : undefined;
    if (!data.values.length || fields.length >= total) return;
  }
  return undefined;
}

export async function resolveStartDate(
  context: CommandContext,
  project: unknown,
): Promise<Resolution> {
  try {
    const fields = await catalog(context);
    if (!fields) return { error: "field-unreadable" };
    const matches = fields.filter(
      (field) => field.stableId === "sfid:jira-software:start-date",
    );
    if (!matches.length) return {};
    const field = matches[0];
    if (
      matches.length !== 1 ||
      !field ||
      !/^customfield_\d+$/.test(field.id) ||
      field.schema.type !== "date" ||
      field.schema.custom !==
        "com.atlassian.jira.plugin.system.customfieldtypes:datepicker"
    )
      return { error: "field-unresolved" };
    if (typeof project !== "string" || !/^\d+$/.test(project))
      return { error: "field-unreadable" };
    const applicable = await catalog(context, project);
    if (!applicable) return { error: "field-unreadable" };
    const candidates = applicable.filter(
      (item) => item.id === field.id || item.stableId === field.stableId,
    );
    if (!candidates.length) return {};
    const candidate = candidates[0];
    return candidates.length === 1 &&
      candidate?.id === field.id &&
      candidate.stableId === field.stableId &&
      candidate.schema.type === field.schema.type &&
      candidate.schema.custom === field.schema.custom
      ? { id: field.id }
      : { error: "field-unresolved" };
  } catch {
    return { error: "field-unreadable" };
  }
}
