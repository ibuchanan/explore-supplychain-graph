import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  repeated: false,
}));
vi.mock("@forge/kvs", () => ({
  WhereConditions: { beginsWith: (prefix: string) => prefix },
  kvs: {
    set: async (key: string, value: unknown) => {
      state.values.set(key, structuredClone(value));
    },
    get: async (key: string) => state.values.get(key),
    query: () => {
      let prefix = "";
      let cursor = "";
      const query = {
        where: (_field: string, value: string) => {
          prefix = value;
          return query;
        },
        limit: () => query,
        cursor: (value: string) => {
          cursor = value;
          return query;
        },
        getMany: async () => {
          const rows = [...state.values].filter(([key]) =>
            key.startsWith(prefix),
          );
          const index = cursor ? Number(cursor) : 0;
          return {
            results: rows
              .slice(index, index + 1)
              .map(([key, value]) => ({ key, value })),
            ...(state.repeated
              ? { nextCursor: "1" }
              : index + 1 < rows.length
                ? { nextCursor: String(index + 1) }
                : {}),
          };
        },
      };
      return query;
    },
  },
}));

import {
  registeredExchanges,
  rememberExchange,
} from "../src/exchange-registry";

const cloudId = "00000000-0000-4000-8000-000000000001";
const registration = {
  cloudId,
  connection: "development-loopback",
  document: `ari:cloud:jira:${cloudId}:issue/10042`,
  accountId: "sharing-admin",
};
beforeEach(() => {
  state.values.clear();
  state.repeated = false;
});
it("paginates isolated registrations and replaces principals only on explicit starts", async () => {
  await rememberExchange(registration);
  await rememberExchange({ ...registration, accountId: "replacement-admin" });
  await rememberExchange({
    ...registration,
    document: registration.document.replace("10042", "10043"),
  });
  expect(await registeredExchanges(cloudId)).toEqual([
    { ...registration, accountId: "replacement-admin" },
    {
      ...registration,
      document: registration.document.replace("10042", "10043"),
    },
  ]);
  expect(await registeredExchanges("other-site")).toEqual([]);
  expect(JSON.stringify([...state.values.values()])).not.toContain(
    "authorization",
  );
});
it("rejects corrupt principal records and repeated pagination cursors", async () => {
  await rememberExchange(registration);
  const key = [...state.values.keys()][0] as string;
  state.values.set(key, { ...registration, accountId: "" });
  await expect(registeredExchanges(cloudId)).rejects.toThrow(
    "Invalid Exchange registration",
  );
  await rememberExchange(registration);
  state.repeated = true;
  await expect(registeredExchanges(cloudId)).rejects.toThrow(
    "Repeated registry cursor",
  );
});
