import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  records: new Map<string, { value: unknown; expireTime: string }>(),
  fail: false,
  pending: undefined as Promise<void> | undefined,
  afterCommit: false,
  readFail: false,
}));
vi.mock("@forge/api", () => ({
  getAppContext: () => ({
    installationAri: { installationId: "installation-1" },
    environmentAri: { environmentId: "environment-1" },
  }),
}));
vi.mock("@forge/kvs", () => ({
  MetadataField: { EXPIRE_TIME: "EXPIRE_TIME" },
  kvs: {
    entity: () => ({
      async set(
        key: string,
        value: unknown,
        options: { keyPolicy: string; ttl: { value: number; unit: string } },
      ) {
        if (state.pending) await state.pending;
        if (state.fail) throw new Error("private storage failure");
        if (options.keyPolicy === "FAIL_IF_EXISTS" && state.records.has(key))
          throw new Error("exists");
        expect(options.ttl).toEqual({ value: 90, unit: "DAYS" });
        state.records.set(key, {
          value: structuredClone(value),
          expireTime: new Date(Date.now() + 90 * 86400000).toISOString(),
        });
        if (state.afterCommit) throw new Error("acknowledgment lost");
      },
      async get(key: string) {
        if (state.readFail) throw new Error("readback unavailable");
        if (state.fail) throw new Error("private read failure");
        return structuredClone(state.records.get(key));
      },
    }),
  },
}));

import { audit } from "../src/audit";
import { runAsync, runSync } from "../src/index";

const forgeContext = {
  installContext: "ari:cloud:jira::site/00000000-0000-4000-8000-000000000001",
};
const request = (method = "rpc.discover") => ({
  method: "POST",
  headers: {
    "Content-Type": ["application/json"],
    Authorization: ["Basic dGVzdDpmYWtl"],
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
});

it.each([runSync, runAsync])(
  "persists verified authentication through the production webtrigger",
  async (handler) => {
    vi.stubGlobal("fetch", async (url: string) =>
      Response.json(
        url.endsWith("/myself")
          ? {
              accountId: "verified-human",
              active: true,
              accountType: "atlassian",
            }
          : { permissions: { ADMINISTER: { havePermission: true } } },
      ),
    );
    const response = await handler(request(), forgeContext);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).result.openrpc).toBeDefined();
    expect(
      [...state.records.values()].map(
        ({ value }) => (value as { event: unknown }).event,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "com.forge-ahead.rpc.authentication",
        data: expect.objectContaining({
          installationId: "installation-1",
          environment: "environment-1",
          accountId: "verified-human",
          reason: "authenticated",
        }),
      }),
    ]);
  },
);

const event = {
  specversion: "1.0" as const,
  id: "event-1",
  source: "urn:workdown:audit",
  type: "com.forge-ahead.rpc.attempt" as const,
  time: "2026-11-22T10:00:00.000Z",
  data: {
    installationId: "installation-1",
    environment: "environment-1",
    correlationId: "correlation-1",
    reason: "started" as const,
    method: "exchange.start",
    accountId: "verified-human",
  },
};
beforeEach(() => {
  state.records.clear();
  state.fail = false;
  state.pending = undefined;
  state.afterCommit = false;
  state.readFail = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("fails closed before a critical handler when durable audit is unavailable or times out", async () => {
  const { createWebtrigger } = await import("@forge-ahead/rpc/webtrigger");
  const { ok } = await import("@forge-ahead/errors");
  const { options } = await import("../src/rpc");
  const { installation } = await import("../src/jira");
  const handler = vi.fn(async () => {
    expect(
      [...state.records.values()].map(
        ({ value }) => (value as { event: typeof event }).event.type,
      ),
    ).toContain("com.forge-ahead.rpc.attempt");
    return ok({});
  });
  // Existing Command, with critical policy confined to this local test catalog.
  const critical = createWebtrigger({
    ...options,
    catalog: {
      ...options.catalog,
      methods: options.catalog.methods.map((method) =>
        method.name === "document.get"
          ? {
              ...method,
              "x-forge-ahead": {
                web: true,
                execution: "asApp",
                audit: "critical",
              },
            }
          : method,
      ),
    },
    webPolicy: {
      ...options.webPolicy,
      "document.get": { execution: "asApp", audit: "critical" },
    },
    handlers: { ...options.handlers, "document.get": handler },
    inputValidators: { "document.get": () => true },
    outputValidators: { "document.get": () => true },
    installation,
    authenticate: async () => ({
      kind: "authenticated" as const,
      principal: {
        accountId: "verified-human",
        authorization: "Basic dGVzdDpmYWtl",
      },
    }),
    context: (installation, principal) => ({ installation, principal }),
    audit,
  });
  const success = await critical(request("document.get"), forgeContext);
  expect(JSON.parse(success.body).result).toEqual({});
  expect(handler).toHaveBeenCalledOnce();
  expect(
    [...state.records.values()].map(
      ({ value }) => (value as { event: typeof event }).event.type,
    ),
  ).toEqual([
    "com.forge-ahead.rpc.authentication",
    "com.forge-ahead.rpc.authorization",
    "com.forge-ahead.rpc.attempt",
    "com.forge-ahead.rpc.outcome",
  ]);
  handler.mockClear();
  state.fail = true;
  const unavailable = await critical(request("document.get"), forgeContext);
  expect(JSON.parse(unavailable.body).error.code).toBe(-32603);
  expect(handler).not.toHaveBeenCalled();
  state.fail = false;
  vi.useFakeTimers();
  state.pending = new Promise(() => {});
  const stalled = critical(request("document.get"), forgeContext);
  await vi.runAllTimersAsync();
  const timedOut = await stalled;
  expect(JSON.parse(timedOut.body).error.code).toBe(-32603);
  expect(handler).not.toHaveBeenCalled();
});

it("keeps standard methods available when the store is unavailable", async () => {
  state.fail = true;
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.endsWith("/myself")
        ? {
            accountId: "verified-human",
            active: true,
            accountType: "atlassian",
          }
        : { permissions: { ADMINISTER: { havePermission: true } } },
    ),
  );
  const response = await runSync(request(), forgeContext);
  expect(JSON.parse(response.body).result.openrpc).toBeDefined();
  await expect(audit.publish(event)).rejects.toThrow();
});

it.each([
  { data: { ...event.data, reason: "private exception" } },
  { data: { ...event.data, method: "private-request-method" } },
  { data: { ...event.data, installationId: "wrong-installation" } },
  { id: "../invalid-key" },
])(
  "rejects non-allowlisted or misattributed event fields (%j)",
  async (changes) => {
    await expect(
      audit.publish({ ...event, ...changes } as typeof event),
    ).rejects.toThrow();
    expect(state.records.size).toBe(0);
  },
);

it("supplies runtime installation/environment identity and only verified human IDs", () => {
  expect(
    audit.identity({ cloudId: "untrusted-site", apiBase: "unused" }),
  ).toEqual({ installationId: "installation-1", environment: "environment-1" });
  expect(
    audit.accountId?.({
      accountId: "verified-human",
      authorization: "Basic dGVzdDpmYWtl",
    }),
  ).toBe("verified-human");
  expect(
    audit.accountId?.({
      accountId: "connection-principal",
      authorization: async () => {
        throw new Error("unused");
      },
    }),
  ).toBe("");
});

it("confirms a committed write after lost acknowledgment but refuses unavailable readback", async () => {
  state.afterCommit = true;
  await expect(audit.publish(event)).resolves.toBeUndefined();
  state.readFail = true;
  await expect(audit.publish({ ...event, id: "event-2" })).rejects.toThrow();
  expect(state.records.has("audit:event-2")).toBe(true);
});

it("stores bounded rejection reasons without a fabricated human or unknown method", async () => {
  const missing = request();
  delete (missing.headers as Record<string, string[]>)["Authorization"];
  expect((await runSync(missing, forgeContext)).statusCode).toBe(401);
  expect(
    [...state.records.values()].map(
      ({ value }) => (value as { event: unknown }).event,
    ),
  ).toEqual([
    expect.objectContaining({
      data: expect.objectContaining({ reason: "invalid-credentials" }),
    }),
  ]);
  expect(JSON.stringify([...state.records.values()])).not.toContain(
    "accountId",
  );
  state.records.clear();
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json(
      url.endsWith("/myself")
        ? {
            accountId: "verified-human",
            active: true,
            accountType: "atlassian",
          }
        : { permissions: { ADMINISTER: { havePermission: true } } },
    ),
  );
  const response = await runSync(
    request("private-unknown-method"),
    forgeContext,
  );
  expect(JSON.parse(response.body).error.code).toBe(-32601);
  expect(state.records.size).toBe(2);
  expect(JSON.stringify([...state.records.values()])).not.toContain(
    "private-unknown-method",
  );
});

it("acknowledges identical duplicates without extending retention and rejects conflicts", async () => {
  await audit.publish(event);
  const stored = structuredClone(state.records.get("audit:event-1"));
  await expect(audit.publish(event)).resolves.toBeUndefined();
  await expect(
    audit.publish({ ...event, data: { ...event.data, reason: "failed" } }),
  ).rejects.toThrow();
  expect(state.records.get("audit:event-1")).toEqual(stored);
});

it("does not acknowledge expired records still returned during asynchronous deletion", async () => {
  await audit.publish(event);
  const stored = state.records.get("audit:event-1");
  if (!stored) throw new Error("Missing fixture");
  stored.expireTime = new Date(Date.now() - 1).toISOString();
  await expect(audit.publish(event)).rejects.toThrow();
});

it("acknowledges only after storing an allowlisted event with 90-day expiry", async () => {
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acknowledged = false;
  const publishing = audit
    .publish({
      ...event,
      secret: "private",
      data: { ...event.data, authorization: "private" },
    } as typeof event)
    .then(() => {
      acknowledged = true;
    });
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  expect(state.records.size).toBe(0);
  release();
  await publishing;
  expect(acknowledged).toBe(true);
  expect(state.records.get("audit:event-1")?.value).toMatchObject({ event });
});
