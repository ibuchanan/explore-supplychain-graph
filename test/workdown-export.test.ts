import { readFileSync } from "node:fs";
import { ok } from "@forge-ahead/errors";
import { createWebDispatcher } from "@forge-ahead/rpc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSync } from "../src/index";
import { options } from "../src/rpc";

const cloudId = "00000000-0000-4000-8000-000000000001";
const epic = {
  id: "10042",
  key: "DEMO-42",
  fields: {
    summary: "Publish partner availability",
    issuetype: { name: "Epic", hierarchyLevel: 1 },
    updated: "2026-11-15T10:30:00.000Z",
    description: null as unknown,
    security: null as unknown,
    project: { id: "10000", simplified: false } as unknown,
    status: null as unknown,
    resolution: null as unknown,
    priority: null as unknown,
    labels: [] as string[],
    created: null as string | null,
    duedate: null as string | null,
  },
};
afterEach(() => vi.unstubAllGlobals());

async function call(
  issue: typeof epic & { fields: Record<string, unknown> } = epic,
  params: unknown = { profile: "jira-epic", issue: "DEMO-42" },
  status = 200,
  catalog: unknown[] = [],
  site = cloudId,
  override?: (url: URL) => Response | undefined,
) {
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    expect(options.headers).toMatchObject({
      Authorization: "Basic dGVzdDpmYWtl",
    });
    expect(
      url.startsWith(`https://api.atlassian.com/ex/jira/${site}/rest/api/3/`),
    ).toBe(true);
    const overridden = override?.(new URL(url));
    if (overridden) return overridden;
    if (url.endsWith("/myself"))
      return Response.json({
        accountId: "reader",
        active: true,
        accountType: "atlassian",
      });
    if (url.includes("/mypermissions?"))
      return Response.json({
        permissions: { ADMINISTER: { havePermission: true } },
      });
    if (url.includes("/field/search?")) {
      const query = new URL(url).searchParams;
      expect(query.get("expand")).toBe("stableId");
      const startAt = Number(query.get("startAt"));
      return Response.json({
        startAt,
        maxResults: 1,
        total: catalog.length,
        isLast: startAt + 1 >= catalog.length,
        values: catalog.slice(startAt, startAt + 1),
      });
    }
    if (url.includes("/issue/")) return Response.json(issue, { status });
    if (url.endsWith("/serverInfo"))
      return Response.json({ baseUrl: "https://source.example.com" });
    throw new Error("Unexpected Jira request");
  });
  const response = await runSync(
    {
      method: "POST",
      headers: {
        "Content-Type": ["application/json"],
        Authorization: ["Basic dGVzdDpmYWtl"],
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "workdown.export",
        params,
      }),
    },
    { installContext: `ari:cloud:jira::site/${site}` },
  );
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body);
}

const startField = {
  id: "customfield_20017",
  name: "Start date",
  stableId: "sfid:jira-software:start-date",
  schema: {
    type: "date",
    custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
  },
};

describe("workdown.export", () => {
  it("resolves a positive Start date match when unrelated fields omit stableId", async () => {
    const response = await call(
      { ...epic, fields: { ...epic.fields, [startField.id]: "2026-11-20" } },
      undefined,
      200,
      [
        {
          id: "customfield_999",
          name: "Unrelated custom field",
          schema: { type: "string" },
        },
        startField,
      ],
    );
    expect(response.result).toContain('start_date: "2026-11-20"\n');
  });
  it("omits readable empty optional name values", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        priority: { name: "" },
        resolution: { name: "   " },
      },
    });
    expect(response.result).toBeTypeOf("string");
    expect(response.result).not.toContain("priority:");
    expect(response.result).not.toContain("resolution:");
  });
  it("does not infer absence from an empty stable-ID discriminator", async () => {
    const response = await call(epic, undefined, 200, [
      { ...startField, stableId: "" },
    ]);
    expect(response.error.code).toBe(-32004);
  });
  it("emits byte-equivalent content for portable fixtures with different local field IDs", async () => {
    const a = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/workdown-export/start-date-site-a.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const b = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/workdown-export/start-date-site-b.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const first = await call(
      { ...epic, fields: { ...epic.fields, ...a.fields } },
      undefined,
      200,
      a.catalog,
    );
    const second = await call(
      { ...epic, fields: { ...epic.fields, ...b.fields } },
      undefined,
      200,
      b.catalog,
    );
    expect(first.result).toBeTypeOf("string");
    expect(first.result).toBe(second.result);
  });
  it.each([
    [[startField, { ...startField, id: "customfield_20018" }], -32003],
    [[{ ...startField, schema: { type: "string" } }], -32003],
    [[{ ...startField, stableId: undefined }], -32004],
  ])(
    "fails whole export for ambiguous, incompatible, or incomplete catalogs",
    async (fields, code) => {
      expect(
        (await call(epic, undefined, 200, fields as unknown[])).error.code,
      ).toBe(code);
    },
  );
  it.each([403, 429, 500])(
    "fails unreadable catalog requests (%s) without fallback",
    async (status) => {
      expect(
        (
          await call(epic, undefined, 200, [], cloudId, (url) =>
            url.pathname.endsWith("/field/search")
              ? Response.json({}, { status })
              : undefined,
          )
        ).error.code,
      ).toBe(-32004);
    },
  );
  it.each([
    { startAt: 0, total: 2, isLast: true, values: [startField] },
    { startAt: 1, total: 0, isLast: true, values: [] },
    { startAt: 0, total: 2, isLast: false, values: [] },
  ])("rejects inconsistent or incomplete catalog pagination", async (page) => {
    expect(
      (
        await call(epic, undefined, 200, [], cloudId, (url) =>
          url.pathname.endsWith("/field/search")
            ? Response.json(page)
            : undefined,
        )
      ).error.code,
    ).toBe(-32004);
  });
  it.each([null, ""])("omits a readable unset Start date %j", async (value) => {
    const response = await call(
      { ...epic, fields: { ...epic.fields, [startField.id]: value } },
      undefined,
      200,
      [startField],
    );
    expect(response.result).toBeTypeOf("string");
    expect(response.result).not.toContain("start_date:");
  });
  it("omits Start date when the complete catalog has no semantic match", async () => {
    const response = await call(epic, undefined, 200, [
      { ...startField, stableId: "sfid:other" },
    ]);
    expect(response.result).toBeTypeOf("string");
    expect(response.result).not.toContain("start_date:");
  });
  it("omits a field proven inapplicable by the complete project-filtered catalog", async () => {
    const response = await call(
      epic,
      undefined,
      200,
      [startField],
      cloudId,
      (url) =>
        url.searchParams.has("projectIds")
          ? Response.json({ startAt: 0, total: 0, isLast: true, values: [] })
          : undefined,
    );
    expect(response.result).toBeTypeOf("string");
    expect(response.result).not.toContain("start_date:");
  });
  it("ignores unrelated schema-less system fields across catalog pages", async () => {
    const response = await call(
      { ...epic, fields: { ...epic.fields, [startField.id]: "2026-11-17" } },
      undefined,
      200,
      [{ id: "systemWithoutSchema" }, startField],
    );
    expect(response.result).toBeTypeOf("string");
    const { parse } = await import("yaml");
    expect(parse(response.result.split("---\n")[1]).start_date).toBe(
      "2026-11-17",
    );
  });
  it("does not treat a missing requested Start date value as unset", async () => {
    expect((await call(epic, undefined, 200, [startField])).error.code).toBe(
      -32004,
    );
  });
  it.each([403, 404, 500])(
    "fails a separately unreadable Start date value (%s)",
    async (status) => {
      const response = await call(
        epic,
        undefined,
        200,
        [startField],
        cloudId,
        (url) =>
          url.searchParams.get("fields") === startField.id
            ? Response.json({}, { status })
            : undefined,
      );
      expect(response.error.code).toBe(-32004);
    },
  );
  it("preserves source identity across key changes but not site changes", async () => {
    const { parse } = await import("yaml");
    const metadata = (text: string) => parse(text.split("---\n")[1] ?? "");
    const original = metadata((await call()).result);
    const moved = metadata((await call({ ...epic, key: "MOVED-9" })).result);
    const other = metadata(
      (
        await call(
          epic,
          undefined,
          200,
          [],
          "00000000-0000-4000-8000-000000000002",
        )
      ).result,
    );
    expect(moved.source_id).toBe(original.source_id);
    expect(moved.resource).not.toBe(original.resource);
    expect(other.source_id).not.toBe(original.source_id);
  });
  it.each([
    { summary: "Changed" },
    { updated: "2026-11-16T10:30:00.000Z" },
    { labels: ["new"] },
  ])("changes bytes for a supported field change %j", async (change) => {
    expect(
      (await call({ ...epic, fields: { ...epic.fields, ...change } })).result,
    ).not.toBe((await call()).result);
  });
  it("does not treat a conflicting project catalog as proof of field absence", async () => {
    const response = await call(
      epic,
      undefined,
      200,
      [startField],
      cloudId,
      (url) =>
        url.searchParams.has("projectIds")
          ? Response.json({
              startAt: 0,
              total: 1,
              isLast: true,
              values: [{ ...startField, schema: { type: "string" } }],
            })
          : undefined,
    );
    expect(response.error).toEqual({
      code: -32003,
      message: "Field unresolved",
    });
  });
  it("reports invalid Start date values as field-unreadable", async () => {
    const response = await call(
      { ...epic, fields: { ...epic.fields, [startField.id]: "2026-02-30" } },
      undefined,
      200,
      [startField],
    );
    expect(response.error).toEqual({
      code: -32004,
      message: "Field unreadable",
    });
  });
  it.each([
    { priority: {} },
    { labels: ["ok", 4] },
    { created: "2026-02-30T10:30:00.000Z" },
  ])(
    "fails for malformed scalar values without returning partial content: %j",
    async (extra) => {
      const response = await call({
        ...epic,
        fields: { ...epic.fields, ...extra },
      } as typeof epic);
      expect(response.error).toEqual({
        code: -32004,
        message: "Field unreadable",
      });
    },
  );
  it("fails rather than silently omitting a requested unreadable scalar field", async () => {
    const response = await call(epic, undefined, 200, [], cloudId, (url) =>
      url.pathname.includes("/issue/")
        ? Response.json({
            ...epic,
            fields: { ...epic.fields, labels: undefined },
          })
        : undefined,
    );
    expect(response.error).toEqual({
      code: -32004,
      message: "Field unreadable",
    });
  });
  it("resolves Start date on later catalog pages by stable identity, not name or numeric ID", async () => {
    const id = "customfield_20017";
    const response = await call(
      { ...epic, fields: { ...epic.fields, [id]: "2026-11-20" } },
      undefined,
      200,
      [
        {
          id: "customfield_999",
          name: "Start date",
          stableId: "sfid:unrelated",
          schema: { type: "date" },
        },
        {
          id,
          name: "Localized planned start",
          stableId: "sfid:jira-software:start-date",
          schema: {
            type: "date",
            custom:
              "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
          },
        },
      ],
    );
    expect(response.result).toContain('start_date: "2026-11-20"\n');
    expect(response.result).not.toContain(id);
  });
  it("emits only the scalar disclosure allowlist with canonical values", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        status: {
          name: "Building",
          statusCategory: { key: "indeterminate", name: "In progress" },
        },
        resolution: { name: "Fixed" },
        priority: { name: "High" },
        labels: ["zebra", "alpha", "alpha"],
        created: "2026-11-01T12:00:00.000+0100",
        duedate: "2026-12-01",
        assignee: { displayName: "PRIVATE-PERSON" },
        comments: ["PRIVATE-COMMENT"],
        customfield_666: "PRIVATE-CUSTOM",
      },
    });
    expect(response.result).toContain(
      'work_status:\n  name: "Building"\n  category: "in_progress"\nresolution: "Fixed"\npriority: "High"\ntags:\n  - "alpha"\n  - "zebra"\ncreated_at: "2026-11-01T11:00:00.000Z"\n',
    );
    expect(response.result).toContain('due_date: "2026-12-01"\n');
    expect(response.result).not.toContain("PRIVATE");
  });
  it("includes the current issue key in the disclosed metadata", async () => {
    expect((await call()).result).toContain('key: "DEMO-42"\n');
  });
  it.each(["2026-02-30T10:30:00.000Z", "not-a-date"])(
    "rejects invalid source timestamp %s",
    async (updated) => {
      expect(
        (await call({ ...epic, fields: { ...epic.fields, updated } })).error
          .code,
      ).toBe(-32603);
    },
  );
  it("normalizes Jira timestamp offsets to UTC", async () => {
    const response = await call({
      ...epic,
      fields: { ...epic.fields, updated: "2026-11-15T11:30:00.000+0100" },
    });
    expect(response.result).toContain('updated_at: "2026-11-15T10:30:00.000Z"');
  });
  it("escapes literal Markdown in titles", async () => {
    const response = await call({
      ...epic,
      fields: { ...epic.fields, summary: "*Literal* <tag>" },
    });
    expect(response.result).toContain("\n# \\*Literal\\* \\<tag\\>\n");
  });
  it("fails closed for rich descriptions deferred to ticket 07", async () => {
    expect(
      (
        await call({
          ...epic,
          fields: {
            ...epic.fields,
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "heading", content: [] }],
            },
          },
        })
      ).error.code,
    ).toBe(-32603);
  });
  it("returns identical bytes with reordered fields and labels", async () => {
    const a = { ...epic, fields: { ...epic.fields, labels: ["b", "a"] } };
    const b = {
      ...epic,
      fields: {
        ...Object.fromEntries(Object.entries(epic.fields).reverse()),
        labels: ["a", "b"],
      },
    } as typeof epic;
    expect(await call(a)).toEqual(await call(b));
    expect(await call(a)).toEqual(await call(a));
  });
  it.each([
    ["format_version: 1", "format_version: 2"],
    ['title: "Publish partner availability"', "title: null"],
    ['work_type: "Epic"\n', ""],
    [
      'updated_at: "2026-11-15T10:30:00.000Z"',
      'updated_at: "2026-02-30T10:30:00.000Z"',
    ],
    ["generated:", 'due_date: "2026-02-30"\ngenerated:'],
    ["generated:", "priority: null\ngenerated:"],
    ['format: "workdown"', "format: workdown"],
    ['format: "workdown"', 'format: &format "workdown"'],
    ['format: "workdown"', 'format: !!str "workdown"'],
    ['format: "workdown"', 'format: "workdown"\nformat: "workdown"'],
    ['type: "WorkItem"', "type: *missing"],
    ["generated:", "---\n---\ngenerated:"],
  ])("rejects invalid produced Frontmatter: %s", async (from, to) => {
    const fixture = readFileSync(
      new URL(
        "./fixtures/workdown-export/epic-empty-description.workdown",
        import.meta.url,
      ),
      "utf8",
    );
    const dispatcher = createWebDispatcher({
      ...options,
      handlers: {
        "workdown.export": async () => ok(fixture.replace(from, to)),
      },
    });
    const response = await dispatcher.dispatch(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "workdown.export",
        params: { profile: "jira-epic", issue: "DEMO-42" },
      },
      {
        installation: { cloudId, apiBase: "https://api.atlassian.com" },
        principal: { accountId: "reader", authorization: "Basic dGVzdDpmYWtl" },
      },
    );
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    });
  });
  it.each(["", "   "])("rejects a blank issue %j", async (issue) => {
    expect((await call(epic, { profile: "jira-epic", issue })).error.code).toBe(
      -32602,
    );
  });
  it("rejects an unknown profile", async () => {
    expect(
      (await call(epic, { profile: "unknown", issue: "DEMO-42" })).error.code,
    ).toBe(-32602);
  });
  it.each([403, 404])(
    "does not reveal an unreadable or missing issue (%s)",
    async (status) => {
      expect((await call(epic, undefined, status)).error).toEqual({
        code: -32001,
        message: "Forbidden",
      });
    },
  );
  it("rejects a readable issue-secured Epic without disclosing its content", async () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await call({
        ...epic,
        fields: {
          ...epic.fields,
          summary: "private-secured-summary",
          security: { id: "10001", name: "private-security-level" },
        },
      });
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32005, message: "Issue ineligible" },
      });
      expect(JSON.stringify(output.mock.calls)).not.toContain("private-");
    } finally {
      output.mockRestore();
    }
  });
  it.each([undefined, {}, [], "", { id: 12 }, { id: "" }])(
    "fails closed when security is absent or ambiguous (case %#)",
    async (security) => {
      const response = await call({
        ...epic,
        fields: { ...epic.fields, security },
      });
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32006, message: "Eligibility undetermined" },
      });
    },
  );
  it("requests security explicitly and fails fast as the caller", async () => {
    let checked = false;
    await call(epic, undefined, 200, [], cloudId, (url) => {
      if (url.pathname.includes("/issue/")) {
        expect(url.searchParams.get("fields")?.split(",")).toContain(
          "security",
        );
        expect(url.searchParams.get("failFast")).toBe("true");
        checked = true;
      }
      return undefined;
    });
    expect(checked).toBe(true);
  });
  it.each([{}, { simplified: true }, { simplified: "false" }])(
    "does not authorize an unverified project type (case %#)",
    async (project) => {
      const response = await call({
        ...epic,
        fields: { ...epic.fields, project: { id: "10000", ...project } },
      });
      expect(response.error).toEqual({
        code: -32006,
        message: "Eligibility undetermined",
      });
      expect(response).not.toHaveProperty("result");
    },
  );
  it("classifies a failed eligibility read without exposing response content", async () => {
    const response = await call(epic, undefined, 200, [], cloudId, (url) =>
      url.pathname.includes("/issue/")
        ? new Response("private-upstream-error", { status: 500 })
        : undefined,
    );
    expect(response.error).toEqual({
      code: -32006,
      message: "Eligibility undetermined",
    });
  });
  it.each(["transport", "json", "fields"])(
    "fails closed on an invalid eligibility response (%s)",
    async (failure) => {
      const response = await call(epic, undefined, 200, [], cloudId, (url) => {
        if (!url.pathname.includes("/issue/")) return undefined;
        if (failure === "transport")
          throw new Error("private-transport-detail");
        return failure === "json"
          ? new Response("private-invalid-json")
          : Response.json({ fields: null });
      });
      expect(response.error).toEqual({
        code: -32006,
        message: "Eligibility undetermined",
      });
    },
  );
  it("rejects a readable non-Epic", async () => {
    expect(
      (
        await call({
          ...epic,
          fields: {
            ...epic.fields,
            issuetype: { name: "Task", hierarchyLevel: 0 },
          },
        })
      ).error.code,
    ).toBe(-32002);
  });
  it("rejects missing required source data without returning a document", async () => {
    const response = await call({
      ...epic,
      fields: { ...epic.fields, summary: "" },
    });
    expect(response.error.code).toBe(-32603);
    expect(response).not.toHaveProperty("result");
  });
  it("returns epic-plain-description.workdown for plain-text ADF", async () => {
    const description = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Let partners check availability before submitting an order.",
            },
          ],
        },
      ],
    };
    const response = await call({
      ...epic,
      fields: { ...epic.fields, description },
    });
    expect(response.result).toBe(
      readFileSync(
        new URL(
          "./fixtures/workdown-export/epic-plain-description.workdown",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
  it("returns epic-empty-description.workdown for an Epic with no description", async () => {
    const result = await call();
    expect(result).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: readFileSync(
        new URL(
          "./fixtures/workdown-export/epic-empty-description.workdown",
          import.meta.url,
        ),
        "utf8",
      ),
    });
  });
});
