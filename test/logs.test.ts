import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "../src/jira";

type Stored = {
  key: string;
  value: unknown;
  expireTime?: string;
};
const rows: Stored[] = [];
let nextCursor: string | undefined;
const queryCalls: unknown[] = [];
const secrets = new Map<string, unknown>();
let appContext = {
  installationAri: { installationId: "install-1" },
  environmentAri: { environmentId: "env-1" },
};

vi.mock("@forge/api", async (original) => ({
  ...(await original<typeof import("@forge/api")>()),
  getAppContext: () => appContext,
}));
vi.mock("@forge/events", () => ({
  Queue: class {
    push = vi.fn();
  },
}));
vi.mock("@forge/kvs", async (original) => {
  const actual = await original<typeof import("@forge/kvs")>();
  return {
    ...actual,
    kvs: {
      async getSecret(key: string) {
        return secrets.get(key);
      },
      async setSecret(key: string, value: unknown, options?: unknown) {
        if (
          (options as { keyPolicy?: string } | undefined)?.keyPolicy ===
            "FAIL_IF_EXISTS" &&
          secrets.has(key)
        ) {
          throw new Error("exists");
        }
        secrets.set(key, value);
      },
      entity(name: string) {
        return {
          query(options?: unknown) {
            const call: Record<string, unknown> = { name, options };
            queryCalls.push(call);
            const builder = {
              index(indexName: string, indexOptions?: unknown) {
                call["indexName"] = indexName;
                call["indexOptions"] = indexOptions;
                return builder;
              },
              where(condition: unknown) {
                call["where"] = condition;
                return builder;
              },
              sort(sort: unknown) {
                call["sort"] = sort;
                return builder;
              },
              limit(limit: number) {
                call["limit"] = limit;
                return builder;
              },
              cursor(cursor: string) {
                call["cursor"] = cursor;
                return builder;
              },
              async getMany() {
                const bounds = (call["where"] as { values: [string, string] })
                  .values;
                const candidates = rows.filter(
                  (row) =>
                    !row.value ||
                    typeof row.value !== "object" ||
                    !("timeKey" in row.value) ||
                    (String(row.value.timeKey) >= bounds[0] &&
                      String(row.value.timeKey) <= bounds[1]),
                );
                candidates.sort((a, b) =>
                  String(
                    (b.value as { timeKey?: string })?.timeKey,
                  ).localeCompare(
                    String((a.value as { timeKey?: string })?.timeKey),
                  ),
                );
                return {
                  results: candidates.slice(0, Number(call["limit"])),
                  nextCursor,
                };
              },
            };
            return builder;
          },
        };
      },
    },
  };
});

const adminAuth = "Basic YWRtaW46ZmFrZQ==";
const nonAdminAuth = "Basic dXNlcjpmYWtl";
const context = (authorization: Principal["authorization"] = adminAuth) => ({
  installation: {
    cloudId: "00000000-0000-4000-8000-000000000001",
    apiBase:
      "https://api.atlassian.com/ex/jira/00000000-0000-4000-8000-000000000001",
  },
  principal: { accountId: "admin", authorization },
});
const jsonResponse = (data: unknown) => ({
  ok: true,
  status: 200,
  json: async () => data,
});

const auditEvent = (
  id: string,
  time: string,
  extra: Record<string, unknown> = {},
) => ({
  specversion: "1.0",
  id,
  source: "urn:workdown:audit",
  type: "com.forge-ahead.rpc.authorization",
  time,
  data: {
    installationId: "install-1",
    environment: "env-1",
    correlationId: "corr-1",
    reason: "allowed",
    method: "logs.list",
    accountId: "admin",
  },
  ...extra,
});
const stored = (
  kind: "audit" | "operational",
  event: unknown,
  expireTime = "2099-01-01T00:00:00.000Z",
): Stored => ({
  key: `${kind}:${(event as { id: string }).id}`,
  expireTime,
  value: {
    kind,
    timeKey: `${(event as { time: string }).time}#${(event as { id: string }).id}`,
    eventType: (event as { type: string }).type,
    correlationId:
      (event as { data?: { correlationId?: string } }).data?.correlationId ??
      "",
    expiresAt: new Date(
      Date.parse((event as { time: string }).time) +
        (kind === "audit" ? 90 : 7) * 86400000,
    ).toISOString(),
    event,
  },
});

describe("logs.list reader", () => {
  beforeEach(() => {
    rows.length = 0;
    queryCalls.length = 0;
    secrets.clear();
    nextCursor = undefined;
    appContext = {
      installationAri: { installationId: "install-1" },
      environmentAri: { environmentId: "env-1" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth =
          init?.headers && "Authorization" in init.headers
            ? init.headers.Authorization
            : undefined;
        if (url.endsWith("/myself"))
          return jsonResponse({
            accountId: auth === adminAuth ? "admin" : "user",
            active: true,
            accountType: "atlassian",
          });
        if (url.endsWith("/mypermissions?permissions=ADMINISTER"))
          return jsonResponse({
            permissions: { ADMINISTER: { havePermission: auth === adminAuth } },
          });
        throw new Error(url);
      }),
    );
  });

  it("authorizes the current human as Jira ADMINISTER and queries one newest-first candidate page", async () => {
    const { listLogs } = await import("../src/logs");
    rows.push(stored("audit", auditEvent("b", "2026-11-22T10:00:00.000Z")));

    await expect(
      listLogs(
        {
          kind: "audit",
          limit: 5,
          from: "2026-11-21T00:00:00.000Z",
          to: "2026-11-22T12:00:00.000Z",
        },
        context(adminAuth),
      ),
    ).resolves.toMatchObject({
      value: {
        kind: "audit",
        events: [auditEvent("b", "2026-11-22T10:00:00.000Z")],
        order: "newest-first",
      },
    });
    expect(queryCalls).toHaveLength(1);
    expect(queryCalls[0]).toMatchObject({
      name: "log-event",
      indexName: "by-kind-time",
      indexOptions: { partition: ["audit"] },
      sort: "DESC",
      limit: 5,
    });
  });

  it("rejects non-admin callers instead of accepting app authorization", async () => {
    const { listLogs } = await import("../src/logs");
    await expect(
      listLogs({ kind: "audit" }, context(nonAdminAuth)),
    ).resolves.toEqual({ error: "forbidden" });
    await expect(
      listLogs(
        { kind: "audit" },
        context(async () => jsonResponse({})),
      ),
    ).resolves.toEqual({ error: "logs-unavailable" });
    expect(queryCalls).toHaveLength(0);
  });

  it("validates retained UTC bounds semantically", async () => {
    const { listLogs } = await import("../src/logs");
    await expect(
      listLogs(
        { kind: "audit", from: "2026-02-30T00:00:00.000Z" },
        context(adminAuth),
      ),
    ).resolves.toEqual({ error: "invalid-params" });
    await expect(
      listLogs(
        {
          kind: "operational",
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-01-02T00:00:00.000Z",
        },
        context(adminAuth),
      ),
    ).resolves.toEqual({ error: "invalid-params" });
  });

  it("filters and projects only valid unexpired records for the trusted runtime identity", async () => {
    const { listLogs } = await import("../src/logs");
    rows.push(
      stored("audit", auditEvent("ok", "2026-11-22T10:00:00.000Z")),
      stored(
        "audit",
        auditEvent("wrong-type", "2026-11-22T09:00:00.000Z", {
          type: "com.workdown.log.info",
        }),
      ),
      stored(
        "audit",
        auditEvent("wrong-install", "2026-11-22T08:00:00.000Z", {
          data: {
            installationId: "other",
            environment: "env-1",
            correlationId: "corr-1",
            reason: "allowed",
          },
        }),
      ),
      stored(
        "audit",
        auditEvent("expired", "2026-11-22T07:00:00.000Z"),
        "2000-01-01T00:00:00.000Z",
      ),
    );
    await expect(
      listLogs(
        {
          kind: "audit",
          type: "com.forge-ahead.rpc.authorization",
          correlationId: "corr-1",
          from: "2026-11-21T00:00:00.000Z",
          to: "2026-11-22T12:00:00.000Z",
        },
        context(adminAuth),
      ),
    ).resolves.toMatchObject({
      value: { events: [auditEvent("ok", "2026-11-22T10:00:00.000Z")] },
    });
  });

  it("returns encrypted installation-bound cursors and rejects changed filters", async () => {
    const { listLogs } = await import("../src/logs");
    nextCursor = "forge-cursor-1";
    const first = await listLogs(
      {
        kind: "audit",
        limit: 1,
        from: "2026-11-21T00:00:00.000Z",
        to: "2026-11-22T12:00:00.000Z",
      },
      context(adminAuth),
    );
    expect("value" in first && first.value.nextCursor).toEqual(
      expect.any(String),
    );

    const cursor = "value" in first ? (first.value.nextCursor ?? "") : "";
    nextCursor = undefined;
    await expect(
      listLogs(
        {
          kind: "audit",
          limit: 1,
          from: "2026-11-21T00:00:00.000Z",
          to: "2026-11-22T12:00:00.000Z",
          cursor,
        },
        context(adminAuth),
      ),
    ).resolves.toMatchObject({ value: expect.any(Object) });
    expect(queryCalls.at(-1)).toMatchObject({ cursor: "forge-cursor-1" });
    await expect(
      listLogs(
        {
          kind: "audit",
          limit: 2,
          from: "2026-11-21T00:00:00.000Z",
          to: "2026-11-22T12:00:00.000Z",
          cursor,
        },
        context(adminAuth),
      ),
    ).resolves.toEqual({ error: "invalid-params" });
  });

  it("continues default bounds across time without extending the original token lifetime", async () => {
    const { listLogs } = await import("../src/logs");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T12:00:00.000Z"));
    nextCursor = "page-two";
    const first = await listLogs({ kind: "audit" }, context());
    if (!first.isOk() || !first.value.nextCursor) throw Error("Missing cursor");
    vi.setSystemTime(new Date("2026-11-22T12:01:00.000Z"));
    const second = await listLogs(
      { kind: "audit", cursor: first.value.nextCursor },
      context(),
    );
    expect(second.isOk()).toBe(true);
    if (!second.isOk() || !second.value.nextCursor)
      throw Error("Missing continuation");
    vi.setSystemTime(new Date("2026-11-22T12:15:00.001Z"));
    expect(
      await listLogs(
        { kind: "audit", cursor: second.value.nextCursor },
        context(),
      ),
    ).toMatchObject({ error: "invalid-params" });
    vi.useRealTimers();
  });
  it("fails closed with logs-unavailable when authority is indeterminate before touching storage", async () => {
    const { listLogs } = await import("../src/logs");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        jsonResponse(
          url.endsWith("/myself")
            ? { accountId: "admin", active: true, accountType: "atlassian" }
            : {},
        ),
      ),
    );
    expect(await listLogs({ kind: "audit" }, context())).toMatchObject({
      error: "logs-unavailable",
    });
    expect(queryCalls).toHaveLength(0);
  });
  it("rejects tampered and foreign continuation tokens without a storage query", async () => {
    const { listLogs } = await import("../src/logs");
    nextCursor = "private-forge-cursor";
    const first = await listLogs({ kind: "audit" }, context());
    if (!first.isOk() || !first.value.nextCursor) throw Error("Missing token");
    const cursor = first.value.nextCursor;
    expect(cursor).not.toContain("private-forge-cursor");
    const count = queryCalls.length;
    expect(
      await listLogs({ kind: "audit", cursor: `!${cursor}` }, context()),
    ).toMatchObject({ error: "invalid-params" });
    appContext.environmentAri.environmentId = "other-environment";
    expect(await listLogs({ kind: "audit", cursor }, context())).toMatchObject({
      error: "invalid-params",
    });
    expect(queryCalls).toHaveLength(count);
  });

  it("excludes malformed candidates but preserves sparse-page continuation", async () => {
    const { listLogs } = await import("../src/logs");
    rows.push(
      { key: "bad", value: null },
      stored("audit", auditEvent("outside", "2026-11-21T00:00:00.000Z")),
    );
    nextCursor = "more-candidates";
    expect(
      await listLogs(
        { kind: "audit", from: "2026-11-22T00:00:00.000Z" },
        context(),
      ),
    ).toMatchObject({ value: { events: [], nextCursor: expect.any(String) } });
  });

  it("uses descending equal-millisecond ID ties and inclusive-from exclusive-to boundaries", async () => {
    const { listLogs } = await import("../src/logs");
    const time = "2026-11-22T10:00:00.000Z";
    rows.push(
      stored("audit", auditEvent("a", time)),
      stored("audit", auditEvent("c", time)),
      stored("audit", auditEvent("b", time)),
      stored("audit", auditEvent("to", "2026-11-22T11:00:00.000Z")),
    );
    const page = await listLogs(
      { kind: "audit", from: time, to: "2026-11-22T11:00:00.000Z" },
      context(),
    );
    if (!page.isOk()) throw Error("Missing page");
    expect(page.value.events.map((event) => event.id)).toEqual(["c", "b", "a"]);
  });
});
