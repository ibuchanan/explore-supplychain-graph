import "./audit-runtime";
import { readFileSync } from "node:fs";
import { ok } from "@forge-ahead/errors";
import { createWebDispatcher } from "@forge-ahead/rpc";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { runSync } from "../src/index";
import { options } from "../src/rpc";
import { validateWorkdown } from "../src/workdown-validation";

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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function call(
  issue: typeof epic & { fields: Record<string, unknown> } = epic,
  params: unknown = { profile: "jira-epic", issue: "DEMO-42" },
  status = 200,
  catalog: unknown[] = [],
  site = cloudId,
  override?: (
    url: URL,
    options: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    expect(options.headers).toMatchObject({
      Authorization: "Basic dGVzdDpmYWtl",
    });
    expect(
      url.startsWith(`https://api.atlassian.com/ex/jira/${site}/rest/api/3/`),
    ).toBe(true);
    const overridden = override?.(new URL(url), options);
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
      const fields = query.has("id")
        ? catalog.filter(
            (field) => (field as { id: string }).id === query.get("id"),
          )
        : catalog;
      return Response.json({
        startAt,
        maxResults: 1,
        total: fields.length,
        isLast: startAt + 1 >= fields.length,
        values: fields.slice(startAt, startAt + 1),
      });
    }
    if (url.includes("/search/jql?"))
      return Response.json({ isLast: true, issues: [] });
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

it("shares the 60-request invocation budget across metadata and secured-child pages", async () => {
  let pages = 0;
  const result = await call(epic, undefined, 200, [], cloudId, (url) => {
    if (url.pathname.endsWith("/field/search")) {
      const startAt = Number(url.searchParams.get("startAt"));
      return Response.json({
        startAt,
        total: 20,
        isLast: startAt === 19,
        values: [{ id: `field_${startAt}`, stableId: `field:${startAt}` }],
      });
    }
    if (url.pathname.endsWith("/search/jql")) {
      pages++;
      return Response.json({
        isLast: pages === 100,
        ...(pages < 100 ? { nextPageToken: `page-${pages}` } : {}),
        issues: [{ fields: { security: { id: "7" } } }],
      });
    }
    return undefined;
  });
  expect(result).toMatchObject({ error: { code: -32007 } });
  expect(result).not.toHaveProperty("result");
  // 2 admission + 1 Subject + 20 catalog + 1 server + 36 child requests.
  expect(pages).toBe(36);
  expect(await call()).toHaveProperty("result");
});

it("stops metadata pagination at 35 seconds including admission time", async () => {
  vi.useFakeTimers();
  let pages = 0;
  const result = await call(epic, undefined, 200, [], cloudId, (url) => {
    if (url.pathname.endsWith("/myself")) vi.advanceTimersByTime(7_000);
    if (url.pathname.endsWith("/field/search")) {
      const startAt = pages++;
      vi.advanceTimersByTime(7_000);
      return Response.json({
        startAt,
        total: 10,
        isLast: startAt === 9,
        values: [{ id: `field_${startAt}`, stableId: `field:${startAt}` }],
      });
    }
    return undefined;
  });
  expect(result).toMatchObject({ error: { code: -32004 } });
  expect(result).not.toHaveProperty("result");
  expect(pages).toBe(4);
});

it("cancels a stalled child response body when only 2 seconds remain", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  let entered!: () => void;
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = call(epic, undefined, 200, [], cloudId, (url, options) => {
    if (url.pathname.endsWith("/search/jql")) {
      signal = options.signal ?? undefined;
      // Previous completed calls consume the invocation's time, not this call's timeout.
      const body = new ReadableStream({
        start() {
          entered();
        },
      });
      return new Response(body);
    }
    vi.advanceTimersByTime(6_600);
    return undefined;
  });
  await reading;
  const observed = pending.then((result) => ({ result }));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(signal?.aborted).toBe(true);
  expect(await observed).toMatchObject({ result: { error: { code: -32007 } } });
});

it("rejects a document whose rendering crosses the invocation deadline", async () => {
  vi.useFakeTimers();
  const result = await call(epic, undefined, 200, [], cloudId, (url) => {
    if (!url.pathname.endsWith("/search/jql")) return;
    const response = Response.json({ isLast: true, issues: [] });
    const json = response.json.bind(response);
    Object.defineProperty(response, "json", {
      value: async () => {
        const page = await json();
        Object.defineProperty(page, "issues", {
          get() {
            vi.advanceTimersByTime(20_000);
            return [];
          },
        });
        return page;
      },
    });
    return response;
  });
  expect(result).toMatchObject({ error: { code: -32007 } });
  expect(result).not.toHaveProperty("result");
});

it("reports unreadable site metadata without returning a partial document", async () => {
  const result = await call(epic, undefined, 200, [], cloudId, (url) => {
    if (url.pathname.endsWith("/serverInfo"))
      throw new Error("Jira deadline exhausted");
    return undefined;
  });
  expect(result).toMatchObject({ error: { code: -32004 } });
});

const startField = {
  id: "customfield_20017",
  name: "Start date",
  stableId: "sfid:jira-software:start-date",
  schema: {
    type: "date",
    custom: "com.atlassian.jira.plugin.system.customfieldtypes:datepicker",
  },
};

const child = {
  id: "10043",
  key: "DEMO-43",
  fields: {
    summary: "Define availability response",
    issuetype: { name: "Story", subtask: false },
    parent: { id: epic.id },
    project: { simplified: false },
    security: null,
    status: null,
    resolution: null,
  },
};

const inlineText = fc
  .string({
    unit: fc.constantFrom(
      ...'abc XYZ09\\`*_{}[]<>()#+!|~>-"\t',
      "é",
      "中",
      "🙂",
    ),
    maxLength: 40,
  })
  .filter((text) => text.trim().length > 0);
const fakeChild = fc
  .record({
    id: fc.integer({ min: 1, max: 9999 }).map(String),
    summary: inlineText,
    workType: inlineText,
    status: fc.option(inlineText, { nil: null }),
    resolution: fc.option(inlineText, { nil: null }),
  })
  .map(({ id, summary, workType, status, resolution }) => ({
    ...child,
    id,
    key: `DEMO-${id}`,
    fields: {
      ...child.fields,
      summary,
      issuetype: { name: workType, subtask: false },
      status: status === null ? null : { name: status },
      resolution: resolution === null ? null : { name: resolution },
    },
  }));
const fakeChildren = fc.uniqueArray(fakeChild, {
  selector: (issue) => issue.id,
  maxLength: 10,
});
const childPages = fakeChildren.chain((issues) =>
  fc
    .shuffledSubarray(issues, {
      minLength: issues.length,
      maxLength: issues.length,
    })
    .chain((shuffled) =>
      fc
        .array(fc.boolean(), {
          minLength: shuffled.length,
          maxLength: shuffled.length,
        })
        .map((cuts) => {
          const pages: (typeof issues)[] = [[]];
          shuffled.forEach((issue, index) => {
            pages[pages.length - 1]?.push(issue);
            if (cuts[index]) pages.push([]);
          });
          return { issues, pages };
        }),
    ),
);

async function exportPages(pages: unknown[][]) {
  const tokens: (string | null)[] = [];
  const response = await call(epic, undefined, 200, [], cloudId, (url) => {
    if (!url.pathname.endsWith("/search/jql")) return undefined;
    expect(url.searchParams.get("jql")).toBe("parent = 10042");
    expect(url.searchParams.get("failFast")).toBe("true");
    expect(url.searchParams.get("fields")).toBe(
      "summary,issuetype,status,resolution,parent,project,security",
    );
    tokens.push(url.searchParams.get("nextPageToken"));
    const index = tokens.length - 1;
    if (index >= pages.length) throw new Error("Unexpected child page request");
    return Response.json({
      issues: pages[index],
      isLast: index === pages.length - 1,
      ...(index < pages.length - 1
        ? { nextPageToken: `page-${index + 1}` }
        : {}),
    });
  });
  expect(response.error).toBeUndefined();
  return { ...response, tokens };
}

describe("workdown.export", () => {
  it("enforces the canonical UTF-8 byte boundary without returning a partial document", async () => {
    const description = (text: string) => ({
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const baseline = (
      await call({
        ...epic,
        fields: { ...epic.fields, description: description("é") },
      })
    ).result as string;
    const padding = 262144 - Buffer.byteLength(baseline, "utf8");
    const atLimit = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: description(`é${"a".repeat(padding)}`),
      },
    });
    expect(atLimit.error).toBeUndefined();
    expect(Buffer.byteLength(atLimit.result, "utf8")).toBe(262144);
    expect(validateWorkdown(atLimit.result)).toBe(true);
    const overLimit = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: description(`é${"a".repeat(padding)}b`),
      },
    });
    expect(overLimit).not.toHaveProperty("result");
    expect(overLimit.error).toEqual({
      code: -32008,
      message: "Document too large",
    });
  });
  it.each([
    { summary: "   " },
    { issuetype: { name: "", hierarchyLevel: 1 } },
    { updated: "2026-11-15" },
  ])(
    "never returns a successful invalid candidate for required values %j",
    async (fields) => {
      const response = await call({
        ...epic,
        fields: { ...epic.fields, ...fields },
      });
      expect(response).not.toHaveProperty("result");
      expect(response.error).toEqual({
        code: -32603,
        message: "Internal error",
      });
    },
  );
  it("caps eligible children across pages without counting excluded children or leaking content", async () => {
    const children = Array.from({ length: 101 }, (_, index) => ({
      ...child,
      id: String(20000 + index),
    }));
    const secured = {
      ...child,
      id: "99999",
      fields: { ...child.fields, summary: "RESTRICTED", security: { id: "1" } },
    };
    const baseline = await exportPages([children.slice(0, 100)]);
    const atLimit = await exportPages([
      children.slice(0, 50),
      [secured, ...children.slice(50, 100)],
    ]);
    expect(atLimit.result).toBe(baseline.result);
    expect(validateWorkdown(atLimit.result)).toBe(true);
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await call(epic, undefined, 200, [], cloudId, (url) => {
        if (!url.pathname.endsWith("/search/jql")) return undefined;
        return url.searchParams.has("nextPageToken")
          ? Response.json({ issues: [secured, children[100]], isLast: true })
          : Response.json({
              issues: children.slice(0, 100),
              isLast: false,
              nextPageToken: "next",
            });
      });
      expect(response).not.toHaveProperty("result");
      expect(response.error).toEqual({
        code: -32009,
        message: "Too many children",
      });
      expect(JSON.stringify(logs.mock.calls)).not.toMatch(
        /RESTRICTED|Define availability|"childCount"|"excludedCount"/,
      );
    } finally {
      logs.mockRestore();
    }
  });
  it("never discloses secured children, regardless of their number, content or page", async () => {
    await fc.assert(
      fc.asyncProperty(
        childPages,
        fc.array(
          fc.record({
            id: fc.integer({ min: 100000, max: 999999 }).map(String),
            fields: fc.jsonValue(),
            page: fc.nat(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async ({ pages }, secured) => {
          const logs = vi.spyOn(console, "info").mockImplementation(() => {});
          try {
            const baseline = await exportPages(pages);
            logs.mockClear();
            const mixed: unknown[][] = pages.map((page) => [...page]);
            for (const issue of secured) {
              mixed[issue.page % mixed.length]?.unshift({
                id: issue.id,
                key: `PRIVATE-${issue.id}`,
                fields: {
                  private: issue.fields,
                  summary: `PRIVATE-${issue.id}`,
                  security: { id: issue.id },
                },
              });
            }
            const result = await exportPages(mixed);
            expect(result.result).toBe(baseline.result);
            expect(JSON.stringify(logs.mock.calls)).not.toContain("PRIVATE-");
          } finally {
            logs.mockRestore();
          }
        },
      ),
    );
  });
  it("exports identical bytes in lexical native-ID order for any ordering or page split", async () => {
    await fc.assert(
      fc.asyncProperty(childPages, async ({ issues, pages }) => {
        const baseline = await exportPages([issues]);
        const paged = await exportPages(pages);
        expect(paged.result).toBe(baseline.result);
        expect(paged.tokens).toEqual([
          null,
          ...pages.slice(1).map((_, index) => `page-${index + 1}`),
        ]);
        const metadata = parse(paged.result.split("---\n")[1]);
        const ids = issues.map((issue) => issue.id).sort();
        expect(
          (metadata.children ?? []).map(
            (item: { source_id: string }) => item.source_id,
          ),
        ).toEqual(ids.map((id) => `ari:cloud:jira:${cloudId}:issue/${id}`));
        expect(metadata.sources.slice(1)).toEqual(
          (metadata.children ?? []).map(
            (item: { source_id: string; resource: string; title: string }) => ({
              id: item.source_id,
              resource: item.resource,
              title: item.title,
            }),
          ),
        );
        expect(validateWorkdown(paged.result)).toBe(true);
      }),
    );
  });
  it("exports one direct child with matching sources and an escaped Children table", async () => {
    const response = await call(epic, undefined, 200, [], cloudId, (url) =>
      url.pathname.endsWith("/search/jql")
        ? Response.json({ isLast: true, issues: [child] })
        : undefined,
    );
    expect(response.error).toBeUndefined();
    const metadata = parse(response.result.split("---\n")[1]);
    expect(metadata.children).toEqual([
      {
        source_id: `ari:cloud:jira:${cloudId}:issue/10043`,
        title: "Define availability response",
        resource: "https://source.example.com/browse/DEMO-43",
        work_type: "Story",
        key: "DEMO-43",
      },
    ]);
    expect(metadata).not.toHaveProperty("parent");
    expect(metadata.sources[1]).toEqual({
      id: `ari:cloud:jira:${cloudId}:issue/10043`,
      resource: "https://source.example.com/browse/DEMO-43",
      title: "Define availability response",
    });
    expect(response.result).toContain(
      "\n## Children\n\n| Work item | Type | Status | Resolution |\n| --- | --- | --- | --- |\n| [DEMO\\-43: Define availability response](https://source.example.com/browse/DEMO-43) | Story | — | — |\n",
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it("reads every page as the caller and sorts completed children by lexical native ID", async () => {
    const first = {
      ...child,
      id: "9",
      key: "DEMO-9",
      fields: {
        ...child.fields,
        summary: "Pipe | <text>",
        status: { name: "Done", statusCategory: { key: "done" } },
        resolution: { name: "Fixed" },
        description: "private-description",
        updated: "private-updated",
        comments: ["private-comment"],
      },
    };
    const second = { ...child, id: "10", key: "DEMO-10" };
    const paged = await exportPages([[first], [second]]);
    const unpaged = await exportPages([
      [
        second,
        {
          ...first,
          fields: { ...first.fields, updated: "other-private-update" },
        },
      ],
    ]);
    expect(paged.tokens).toEqual([null, "page-1"]);
    expect(paged.result).toBe(unpaged.result);
    const metadata = parse(paged.result.split("---\n")[1]);
    expect(metadata.children.map((item: { key: string }) => item.key)).toEqual([
      "DEMO-10",
      "DEMO-9",
    ]);
    expect(metadata.children[1].work_status).toEqual({
      name: "Done",
      category: "done",
    });
    expect(metadata.children[1].resolution).toBe("Fixed");
    expect(paged.result).not.toContain("private-");
    expect(paged.result).toContain("Pipe \\| \\<text\\>");
    expect(validateWorkdown(paged.result)).toBe(true);
  });
  it("fails closed on malformed pagination or transport failure after any valid prefix", async () => {
    const invalidPage = fc.oneof(
      fc.constant({ issues: [child], isLast: false }),
      fc.constant({ issues: [child] }),
      inlineText.map((token) => ({
        issues: [child],
        isLast: true,
        nextPageToken: token,
      })),
      fc.jsonValue().map((warning) => ({
        issues: [child],
        isLast: true,
        warnings: [warning],
      })),
      fc
        .jsonValue()
        .filter((value) => typeof value !== "boolean")
        .map((isLast) => ({ issues: [child], isLast })),
      fc
        .jsonValue()
        .filter((value) => !Array.isArray(value))
        .map((issues) => ({ issues, isLast: true })),
      fc.constant(null),
    );
    await fc.assert(
      fc.asyncProperty(
        childPages,
        fc.nat(),
        fc.constantFrom(
          "page",
          "failed-page",
          "repeated-token",
          "bad-json",
          "network",
        ),
        invalidPage,
        fc.constantFrom(401, 403, 404, 429, 500, 503),
        async ({ pages }, offset, failure, malformed, status) => {
          const prefixLength =
            failure === "repeated-token"
              ? 1 + (offset % pages.length)
              : offset % (pages.length + 1);
          let requests = 0;
          const response = await call(
            epic,
            undefined,
            200,
            [],
            cloudId,
            (url) => {
              if (!url.pathname.endsWith("/search/jql")) return undefined;
              const index = requests++;
              if (index < prefixLength)
                return Response.json({
                  issues: pages[index],
                  isLast: false,
                  nextPageToken: `page-${index + 1}`,
                });
              if (index > prefixLength)
                throw new Error("Unexpected request after failed page");
              if (failure === "network")
                throw new Error("private-network-details");
              if (failure === "bad-json")
                return new Response("private-invalid-json");
              if (failure === "failed-page")
                return new Response("private-upstream", { status });
              return Response.json(
                failure === "repeated-token"
                  ? {
                      issues: [],
                      isLast: false,
                      nextPageToken: `page-${1 + (offset % prefixLength)}`,
                    }
                  : malformed,
              );
            },
          );
          expect(response).toEqual({
            jsonrpc: "2.0",
            id: 1,
            error: { code: -32007, message: "Children unreadable" },
          });
          expect(requests).toBe(prefixLength + 1);
        },
      ),
    );
  });
  it("rejects a non-final page without a continuation token", async () => {
    const response = await call(epic, undefined, 200, [], cloudId, (url) =>
      url.pathname.endsWith("/search/jql")
        ? Response.json({ issues: [child], isLast: false })
        : undefined,
    );
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32007, message: "Children unreadable" },
    });
  });
  it("returns no partial document when a continuation token repeats", async () => {
    let pages = 0;
    const response = await call(epic, undefined, 200, [], cloudId, (url) => {
      if (!url.pathname.endsWith("/search/jql")) return undefined;
      if (++pages > 2) throw new Error("test stops unbounded pagination");
      return Response.json({
        issues: pages === 1 ? [child] : [],
        isLast: false,
        nextPageToken: "again",
      });
    });
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32007, message: "Children unreadable" },
    });
    expect(pages).toBe(2);
  });
  it("silently excludes secured children without exposing their data or counts", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const response = await call(epic, undefined, 200, [], cloudId, (url) =>
        url.pathname.endsWith("/search/jql")
          ? Response.json({
              isLast: true,
              issues: [
                {
                  ...child,
                  id: "10099",
                  key: "PRIVATE-99",
                  fields: {
                    security: { id: "123", name: "private-level" },
                    summary: "private-summary",
                  },
                },
              ],
            })
          : undefined,
      );
      expect(response.error).toBeUndefined();
      expect(response.result).toBe(
        readFileSync(
          new URL(
            "./fixtures/workdown-export/epic-empty-description.workdown",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(JSON.stringify(logs.mock.calls)).not.toContain("private-");
      expect(JSON.stringify(logs.mock.calls)).not.toContain("PRIVATE-99");
    } finally {
      logs.mockRestore();
    }
  });
  it.each([
    { security: undefined },
    { security: {} },
    { project: { simplified: true } },
    { parent: { id: "99999" } },
    { parent: undefined },
    { issuetype: { name: "Subtask", subtask: true } },
    { summary: "" },
    { summary: "two\nlines" },
    { status: undefined },
    { status: { name: 123 } },
    { resolution: {} },
  ])(
    "fails closed on an indeterminate or invalid child (case %#)",
    async (fields) => {
      const response = await call(epic, undefined, 200, [], cloudId, (url) =>
        url.pathname.endsWith("/search/jql")
          ? Response.json({
              isLast: true,
              issues: [{ ...child, fields: { ...child.fields, ...fields } }],
            })
          : undefined,
      );
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32007, message: "Children unreadable" },
      });
    },
  );
  it.each([
    [child, child],
    [{ ...child, id: epic.id }],
    [{ ...child, id: "invalid" }],
  ])(
    "rejects duplicate, primary-equal or invalid child identities (case %#)",
    async (...issues) => {
      const response = await call(epic, undefined, 200, [], cloudId, (url) =>
        url.pathname.endsWith("/search/jql")
          ? Response.json({ isLast: true, issues })
          : undefined,
      );
      expect(response).toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32007, message: "Children unreadable" },
      });
    },
  );
  it("round-trips Markdown-sensitive text through export, YAML parsing and validateWorkdown", async () => {
    const description = fc
      .array(
        fc.oneof(
          inlineText,
          fc.constantFrom(
            "\n",
            "\r\n",
            "\r",
            "## Children",
            "```",
            "~~~",
            "---",
            "| a | b |",
          ),
        ),
        { maxLength: 10 },
      )
      .map((parts) => parts.join(""));
    const escaped = (text: string) =>
      [...text]
        .map((character) =>
          "\\`*_{}[]<>()#+!|~>-".includes(character)
            ? `\\${character}`
            : character,
        )
        .join("");
    await fc.assert(
      fc.asyncProperty(
        inlineText,
        description,
        fakeChildren,
        async (title, text, issues) => {
          const response = await call(
            {
              ...epic,
              fields: {
                ...epic.fields,
                summary: title,
                description: {
                  type: "doc",
                  version: 1,
                  content: [
                    { type: "paragraph", content: [{ type: "text", text }] },
                  ],
                },
              },
            },
            undefined,
            200,
            [],
            cloudId,
            (url) =>
              url.pathname.endsWith("/search/jql")
                ? Response.json({ issues, isLast: true })
                : undefined,
          );
          expect(response.error).toBeUndefined();
          const document: string = response.result;
          expect(validateWorkdown(document)).toBe(true);
          const end = document.indexOf("\n---\n", 4);
          const metadata = parse(document.slice(4, end));
          const body = document.slice(end + 5);
          expect(metadata.title).toBe(title);
          expect(metadata.sources[0].title).toBe(title);
          expect(
            (metadata.children ?? []).map(
              (item: { title: string }) => item.title,
            ),
          ).toEqual(
            [...issues]
              .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
              .map((issue) => issue.fields.summary),
          );
          const normalized =
            escaped(text.replace(/\r\n?/g, "\n")).trim() ||
            "No description provided.";
          const sorted = [...issues].sort((a, b) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
          );
          const table = sorted.length
            ? [
                "",
                "## Children",
                "",
                "| Work item | Type | Status | Resolution |",
                "| --- | --- | --- | --- |",
                ...sorted.map(
                  (issue) =>
                    `| [${escaped(`${issue.key}: ${issue.fields.summary}`)}](https://source.example.com/browse/${issue.key}) | ${escaped(issue.fields.issuetype.name)} | ${issue.fields.status ? escaped(issue.fields.status.name) : "—"} | ${issue.fields.resolution ? escaped(issue.fields.resolution.name) : "—"} |`,
                ),
                "",
              ].join("\n")
            : "";
          expect(body).toBe(
            `\n# ${escaped(title)}\n\n## Description\n\n${normalized}\n${table}`,
          );
          const reserialized = `---\n${stringify(metadata, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" })}---\n${body}`;
          expect(validateWorkdown(reserialized)).toBe(true);
          expect(
            validateWorkdown(
              document.replace(
                `\n# ${escaped(title)}\n`,
                `\n# changed ${escaped(title)}\n`,
              ),
            ),
          ).toBe(false);
          if (issues.length)
            expect(
              validateWorkdown(
                document.replace("| Work item |", "| Changed |"),
              ),
            ).toBe(false);
        },
      ),
    );
  });
  it("validates standalone parent records and rejects identity or Children table mismatches", async () => {
    const response = await call(epic, undefined, 200, [], cloudId, (url) =>
      url.pathname.endsWith("/search/jql")
        ? Response.json({ isLast: true, issues: [child] })
        : undefined,
    );
    const metadata = parse(response.result.split("---\n")[1]);
    const body = response.result.slice(
      response.result.indexOf("\n---\n", 4) + 5,
    );
    const document = (data: unknown, content = body) =>
      `---\n${stringify(data, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" })}---\n${content}`;
    expect(validateWorkdown(document(metadata))).toBe(true);
    expect(
      validateWorkdown(
        document(metadata, body.replace(" | Story |", " | Bug |")),
      ),
    ).toBe(false);
    expect(
      validateWorkdown(
        document(metadata, `${body.slice(0, body.indexOf("\n## Children"))}\n`),
      ),
    ).toBe(false);
    expect(
      validateWorkdown(document(metadata, `${body}\n## Children\n\nextra\n`)),
    ).toBe(false);
    const standalone = {
      ...metadata,
      children: undefined,
      sources: [metadata.sources[0]],
      parent: metadata.children[0],
    };
    const noTable = `${body.slice(0, body.indexOf("\n## Children")).trimEnd()}\n`;
    delete standalone.children;
    expect(validateWorkdown(document(standalone, noTable))).toBe(true);
    expect(validateWorkdown(document(standalone))).toBe(false);
    expect(
      validateWorkdown(
        document(
          {
            ...standalone,
            parent: { ...standalone.parent, source_id: metadata.source_id },
          },
          noTable,
        ),
      ),
    ).toBe(false);
    expect(
      validateWorkdown(document({ ...metadata, parent: metadata.children[0] })),
    ).toBe(false);
    expect(
      validateWorkdown(
        document({
          ...metadata,
          children: [metadata.children[0], metadata.children[0]],
          sources: [...metadata.sources, metadata.sources[1]],
        }),
      ),
    ).toBe(false);
    expect(
      validateWorkdown(
        document({
          ...metadata,
          sources: [
            metadata.sources[0],
            { ...metadata.sources[1], title: "Wrong source" },
          ],
        }),
      ),
    ).toBe(false);
  });
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
  it("exports Start date using only its resolved ID in the project lookup", async () => {
    let projectRequests = 0;
    const response = await call(
      { ...epic, fields: { ...epic.fields, [startField.id]: "2026-11-20" } },
      undefined,
      200,
      [{ id: "unrelatedSystemField" }, startField],
      cloudId,
      (url) => {
        if (!url.searchParams.has("projectIds")) return;
        projectRequests++;
        const query = url.searchParams;
        if (
          query.get("id") !== startField.id ||
          query.get("projectIds") !== "10000" ||
          query.get("expand") !== "stableId"
        )
          return Response.json({}, { status: 400 });
        return Response.json({
          startAt: 0,
          total: 1,
          isLast: true,
          values: [startField],
        });
      },
    );
    expect(response.error).toBeUndefined();
    expect(parse(response.result.split("---\n")[1]).start_date).toBe(
      "2026-11-20",
    );
    expect(projectRequests).toBe(1);
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
  it("fails closed for a malformed description document", async () => {
    expect(
      (
        await call({
          ...epic,
          fields: {
            ...epic.fields,
            description: {
              type: "doc",
              version: 1,
              content: "unreadable",
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
  it("demotes source headings of every level and escapes literal heading text", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            ...[1, 2, 3, 4, 5, 6].map((level) => ({
              type: "heading",
              attrs: { level },
              content: [{ type: "text", text: `Level ${level}` }],
            })),
            { type: "heading", attrs: { level: 1 }, content: [] },
            {
              type: "paragraph",
              content: [{ type: "text", text: "## Children" }],
            },
          ],
        },
      },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.split("## Description\n\n")[1]).toBe(
      "**Level 1**\n\n**Level 2**\n\n**Level 3**\n\n**Level 4**\n\n**Level 5**\n\n**Level 6**\n\n\\#\\# Children\n",
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it("preserves formatting and code pipes in table cells without creating extra columns", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "bold",
                              marks: [{ type: "strong" }],
                            },
                            {
                              type: "text",
                              text: "a|b\nc",
                              marks: [{ type: "code" }],
                            },
                            { type: "hardBreak" },
                            { type: "text", text: "next" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.error).toBeUndefined();
    expect(response.result?.split("## Description\n\n")[1]).toBe(
      "|  |\n| --- |\n| **bold**`a\\|b c` next |\n",
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it.each([
    ["javascript:alert(1)", "label"],
    ["data:text/html,<script>", "label"],
    ["java\nscript:alert(1)", "label"],
    ["https://user:password@example.com", "label"],
    ["https://example.com/path", "[label](https://example.com/path)"],
    ["http://example.com/path", "[label](http://example.com/path)"],
    ["//other.example/path", "[label](https://other.example/path)"],
  ])("applies the safe destination policy to %s", async (href, expected) => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "label",
                  marks: [{ type: "link", attrs: { href } }],
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.result?.split("## Description\n\n")[1]).toBe(
      `${expected}\n`,
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it("escapes entities in titles and child table cells while preserving their metadata", async () => {
    const response = await call(
      { ...epic, fields: { ...epic.fields, summary: "A &copy; B" } },
      undefined,
      200,
      [],
      cloudId,
      (url) =>
        url.pathname.endsWith("/search/jql")
          ? Response.json({
              isLast: true,
              issues: [
                {
                  ...child,
                  fields: { ...child.fields, summary: "C &copy; D" },
                },
              ],
            })
          : undefined,
    );
    expect(response.result).toContain("\n# A &amp;copy; B\n");
    expect(response.result).toContain("C &amp;copy; D](");
    expect(parse(response.result.split("---\n")[1]).title).toBe("A &copy; B");
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it("drops headings with only whitespace and marks, and escapes pipes in table link destinations", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "heading",
              content: [
                { type: "text", text: "  ", marks: [{ type: "em" }] },
                { type: "hardBreak" },
              ],
            },
            {
              type: "table",
              content: [
                {
                  type: "tableRow",
                  content: [
                    {
                      type: "tableCell",
                      content: [
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "guide",
                              marks: [
                                {
                                  type: "link",
                                  attrs: { href: "https://example.com/a|b" },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(response.result?.split("## Description\n\n")[1]).toBe(
      "|  |\n| --- |\n| [guide](https://example.com/a%7Cb) |\n",
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it("uses inline code delimiters that preserve boundary backticks and spaces", async () => {
    const response = await call({
      ...epic,
      fields: {
        ...epic.fields,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "`code`", marks: [{ type: "code" }] },
                { type: "text", text: " / " },
                { type: "text", text: " padded ", marks: [{ type: "code" }] },
                { type: "text", text: " / " },
                { type: "text", text: "   ", marks: [{ type: "code" }] },
              ],
            },
          ],
        },
      },
    });
    expect(response.result?.split("## Description\n\n")[1]).toBe(
      "`` `code` `` / `  padded  ` / `   `\n",
    );
    expect(validateWorkdown(response.result)).toBe(true);
  });
  it.each(["rich-inline", "rich-blocks"])(
    "renders %s safely through the export Command and validates the document",
    async (name) => {
      const fixture = (extension: string) =>
        readFileSync(
          new URL(
            `./fixtures/workdown-export/${name}.${extension}`,
            import.meta.url,
          ),
          "utf8",
        );
      const response = await call({
        ...epic,
        fields: { ...epic.fields, description: JSON.parse(fixture("json")) },
      });
      expect(response.error).toBeUndefined();
      expect(response.result?.split("## Description\n\n")[1]).toBe(
        fixture("workdown"),
      );
      expect(validateWorkdown(response.result)).toBe(true);
    },
  );
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
