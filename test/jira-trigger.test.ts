import { beforeEach, expect, it, vi } from "vitest";

const cloudId = "00000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({
  environment: "DEVELOPMENT",
  starts: [] as unknown[],
  principals: [] as string[],
  deny: false,
  log: [] as unknown[],
  scopes: [] as string[],
}));
vi.mock("@forge/api", () => ({
  getAppContext: () => ({ environmentType: state.environment }),
}));
vi.mock("@forge-ahead/logging", () => ({
  createForgeLogger: () => ({
    info: (...args: unknown[]) => state.log.push(args),
  }),
}));
vi.mock("../src/exchange-registry", () => ({
  registeredExchanges: async (site: string) => {
    state.scopes.push(site);
    return [
      {
        cloudId: site,
        connection: "development-loopback",
        document: `ari:cloud:jira:${site}:issue/10042`,
        accountId: "retained-admin",
      },
    ];
  },
}));
vi.mock("../src/jira-event-adapter", () => ({
  eventPrincipal: (accountId: string) => {
    state.principals.push(accountId);
    return {
      accountId,
      authorization: async () => {
        throw new Error("private access detail");
      },
    };
  },
}));
vi.mock("../src/rpc", () => ({
  exchange: {
    start: async (...args: unknown[]) => {
      if (state.deny) throw new Error("private access detail");
      state.starts.push(args);
      return { value: {} };
    },
  },
}));

import { onJiraChange } from "../src/jira-trigger";

const context = { installContext: `ari:cloud:jira::site/${cloudId}` };
beforeEach(() => {
  state.environment = "DEVELOPMENT";
  state.starts.length = 0;
  state.principals.length = 0;
  state.log.length = 0;
  state.scopes.length = 0;
  state.deny = false;
});
it("binds Subject updates to the installed site and retained sharing principal", async () => {
  await onJiraChange(
    {
      eventType: "avi:jira:updated:issue",
      issue: { id: "10042" },
      atlassianId: "event-actor",
      secret: "private payload",
    },
    context,
  );
  expect(state.scopes).toEqual([cloudId]);
  expect(state.starts).toMatchObject([
    [
      {
        issue: "10042",
        profile: "jira-epic",
        connection: "development-loopback",
      },
      { installation: { cloudId }, principal: { accountId: "retained-admin" } },
    ],
  ]);
  expect(state.principals).toEqual(["retained-admin"]);
  expect(JSON.stringify(state.log)).not.toMatch(
    /private payload|event-actor|retained-admin|10042/,
  );
});
it("ignores child-only updates without resolving a sharing principal", async () => {
  await onJiraChange(
    {
      eventType: "avi:jira:updated:issue",
      issue: { id: "10044", fields: { parent: { id: "10042" } } },
    },
    context,
  );
  expect(state.starts).toEqual([]);
  expect(state.principals).toEqual([]);
});
it("reports failed Subject republishing without logging raw exceptions", async () => {
  state.deny = true;
  await onJiraChange(
    { eventType: "avi:jira:updated:issue", issue: { id: "10042" } },
    context,
  );
  expect(state.starts).toEqual([]);
  expect(state.log).toContainEqual([
    { attempted: 1, failed: 1 },
    "workdown.jira-change.completed",
  ]);
  expect(JSON.stringify(state.log)).not.toContain("private access detail");
});
it("does not operate outside development or without trusted installation context", async () => {
  const event = { eventType: "avi:jira:updated:issue", issue: { id: "10042" } };
  await onJiraChange(event, {});
  state.environment = "PRODUCTION";
  await onJiraChange(event, context);
  expect(state.starts).toEqual([]);
  expect(state.scopes).toEqual([]);
});
