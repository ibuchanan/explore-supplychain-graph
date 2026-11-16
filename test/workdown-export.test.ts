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
  },
};
afterEach(() => vi.unstubAllGlobals());

async function call(
  issue = epic,
  params: unknown = { profile: "jira-epic", issue: "DEMO-42" },
  status = 200,
) {
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    expect(options.headers).toMatchObject({
      Authorization: "Basic dGVzdDpmYWtl",
    });
    expect(
      url.startsWith(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/`,
      ),
    ).toBe(true);
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
    { installContext: `ari:cloud:jira::site/${cloudId}` },
  );
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body);
}

describe("workdown.export", () => {
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
    const b = { ...epic, fields: { labels: ["a", "b"], ...epic.fields } };
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
