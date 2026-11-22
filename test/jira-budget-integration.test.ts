import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  records: new Map<string, unknown>(),
  elapsed: 0,
  lookupElapsed: 0,
  requests: 0,
  ingestions: 0,
  signals: [] as AbortSignal[],
}));
vi.mock("@forge/api", () => ({
  getAppContext: () => ({
    environmentType: "DEVELOPMENT",
    installationAri: { installationId: "test-installation" },
    environmentAri: { environmentId: "test-environment" },
  }),
  assumeTrustedRoute: (path: string) => path,
  default: {
    asUser: () => ({
      requestJira: (path: string, init: RequestInit) => {
        state.signals.push(init.signal as AbortSignal);
        return fetch(
          `https://api.atlassian.com/rest/api/3${path.replace("/rest/api/3", "")}`,
          init,
        );
      },
    }),
  },
}));
vi.mock("../src/exchange-storage", () => ({
  exchangeStore: {
    read: async (key: string) => structuredClone(state.records.get(key)),
    compareAndSet: async (
      key: string,
      previous: number,
      value: { updateSequenceNumber: number },
    ) => {
      const current = state.records.get(key) as
        | { updateSequenceNumber: number }
        | undefined;
      if ((current?.updateSequenceNumber ?? 0) !== previous) return false;
      state.records.set(key, structuredClone(value));
      return true;
    },
  },
}));
vi.mock("../src/exchange-registry", () => ({
  rememberExchange: async () => {},
  registeredExchanges: async (cloudId: string) => {
    vi.advanceTimersByTime(state.lookupElapsed);
    return [
      {
        cloudId,
        connection: "development-loopback",
        document: `ari:cloud:jira:${cloudId}:issue/10042`,
        accountId: "admin",
      },
    ];
  },
}));
vi.mock("../src/graph", () => ({
  ingestWorkdown: async () => {
    state.ingestions++;
  },
  dispatchPublication: async () => {},
}));

import type { AsyncEvent } from "@forge/events";
import { runSync } from "../src/index";
import { onJiraChange } from "../src/jira-trigger";
import { onRetry } from "../src/retry-trigger";

const cloudId = "00000000-0000-4000-8000-000000000001";
const context = { installContext: `ari:cloud:jira::site/${cloudId}` };
const document = `ari:cloud:jira:${cloudId}:issue/10042`;
const params = {
  connection: "development-loopback",
  profile: "jira-epic",
  issue: "10042",
};
async function rpc(method: string, input: object = params) {
  const response = await runSync(
    {
      method: "POST",
      headers: {
        "Content-Type": ["application/json"],
        Authorization: ["Basic ZmFrZQ=="],
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: input }),
    },
    context,
  );
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body);
}
beforeEach(() => {
  vi.useFakeTimers();
  state.records.clear();
  state.elapsed = 0;
  state.lookupElapsed = 0;
  state.requests = 0;
  state.ingestions = 0;
  state.signals = [];
  vi.stubGlobal("fetch", async (url: string) => {
    state.requests++;
    const path = new URL(url).pathname;
    vi.advanceTimersByTime(state.elapsed);
    if (path.endsWith("/myself"))
      return Response.json({
        accountId: "admin",
        active: true,
        accountType: "atlassian",
      });
    if (path.endsWith("/mypermissions"))
      return Response.json({
        permissions: {
          ADMINISTER: { havePermission: true },
          ADMINISTER_PROJECTS: { havePermission: true },
        },
      });
    if (path.endsWith("/field/search")) {
      return Response.json({ startAt: 0, total: 0, isLast: true, values: [] });
    }
    if (path.endsWith("/serverInfo"))
      return Response.json({ baseUrl: "https://source.example.com" });
    if (path.endsWith("/search/jql"))
      return Response.json({ isLast: true, issues: [] });
    if (path.includes("/issue/"))
      return Response.json({
        id: "10042",
        key: "DEMO-42",
        fields: {
          summary: "Shared subject",
          issuetype: { name: "Epic", hierarchyLevel: 1 },
          updated: "2026-11-15T10:30:00.000Z",
          description: null,
          security: null,
          project: { id: "10000", simplified: false },
          status: null,
          resolution: null,
          priority: null,
          labels: [],
          created: null,
          duedate: null,
        },
      });
    throw new Error("Unexpected request");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("returns HTTP 503 after a stalled authentication request reaches 10 seconds", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  const response = runSync(
    {
      method: "POST",
      headers: {
        "Content-Type": ["application/json"],
        Authorization: ["Basic ZmFrZQ=="],
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "rpc.discover" }),
    },
    context,
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect((await response).statusCode).toBe(503);
  expect(signal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it("does not issue Jira reads after retry registration lookup consumes 35 seconds", async () => {
  state.lookupElapsed = 35_000;
  await onRetry(
    {
      body: {
        connection: params.connection,
        document,
        stage: "delivery",
        sequence: 1,
      },
    } as unknown as AsyncEvent,
    context,
  );
  expect(state.requests).toBe(0);
});

it("preserves source and destination state when an authenticated refresh exhausts its deadline", async () => {
  expect(await rpc("exchange.start")).toHaveProperty(
    "result.updateSequenceNumber",
    1,
  );
  const read = { connection: params.connection, document };
  const previous = await Promise.all([
    rpc("document.get", read),
    rpc("publication.status", read),
    rpc("exchange.status", read),
  ]);
  state.elapsed = 7_000;
  expect(await rpc("exchange.start")).toMatchObject({
    error: { code: -32004 },
  });
  state.elapsed = 0;
  expect(
    await Promise.all([
      rpc("document.get", read),
      rpc("publication.status", read),
      rpc("exchange.status", read),
    ]),
  ).toEqual(previous);
  expect(state.ingestions).toBe(1);
});

it("uses the 15-second product-event deadline and preserves the last Publication", async () => {
  expect(await rpc("exchange.start")).toHaveProperty(
    "result.updateSequenceNumber",
    1,
  );
  const read = { connection: params.connection, document };
  const previousDocument = await rpc("document.get", read);
  const previousPublication = await rpc("publication.status", read);
  expect(state.ingestions).toBe(1);
  state.elapsed = 5_000;
  state.requests = 0;
  await onJiraChange(
    { eventType: "avi:jira:updated:issue", issue: { id: "10042" } },
    context,
  );
  expect(state.requests).toBe(3); // permission, Subject, catalog; no server or children.
  expect(state.signals.length).toBe(3);
  expect(state.signals.every((signal) => signal instanceof AbortSignal)).toBe(
    true,
  );
  expect(state.ingestions).toBe(1);
  state.elapsed = 0;
  expect(await rpc("document.get", read)).toEqual(previousDocument);
  expect(await rpc("publication.status", read)).toEqual(previousPublication);
});
