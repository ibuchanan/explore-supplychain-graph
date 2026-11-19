import { expect, it } from "vitest";
import { createGraphConnectionHandler } from "../src/graph";

it("binds the platform-issued connector identity only from a trusted development lifecycle and clears it on deletion", async () => {
  const records = new Map<string, string>();
  const outcomes: string[] = [];
  const handler = createGraphConnectionHandler({
    environment: () => "DEVELOPMENT",
    report: (outcome) => {
      outcomes.push(outcome);
    },
    set: async (key, value) => {
      records.set(key, value);
    },
    get: async (key) => records.get(key),
    remove: async (key) => {
      records.delete(key);
    },
  });
  const context = {
    installContext: "ari:cloud:jira::site/00000000-0000-4000-8000-000000000001",
  };
  expect(
    await handler({ action: "CREATED", connectionId: "graph-id" }, context),
  ).toEqual({ success: true });
  expect([...records.values()]).toEqual(["graph-id"]);
  expect(
    await handler({ action: "CREATED", connectionId: "other" }, context),
  ).toEqual({ success: false });
  await handler({ action: "DELETED", connectionId: "other" }, context);
  expect([...records.values()]).toEqual(["graph-id"]);
  await handler({ action: "DELETED", connectionId: "graph-id" }, context);
  expect(records.size).toBe(0);
  expect(
    await handler({ action: "CREATED", connectionId: "graph-id" }, {}),
  ).toEqual({ success: false });
  expect(outcomes).toEqual([
    "bound",
    "binding-conflict",
    "deletion-ignored",
    "deleted",
    "invalid-context",
  ]);
});
