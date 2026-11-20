import { beforeEach, expect, it, vi } from "vitest";
import type { RetainedDocument } from "../src/exchange";

const state = vi.hoisted(() => ({
  records: new Map<string, { version: string; payload: unknown }>(),
  fail: false,
  afterCommit: false,
}));
vi.mock("@forge/kvs", async (original) => {
  const actual = await original<typeof import("@forge/kvs")>();
  return {
    ...actual,
    kvs: {
      entity: () => ({ get: async (key: string) => state.records.get(key) }),
      transact: () => {
        const writes: Array<{
          key: string;
          value: { version: string; payload: unknown };
          conditions?: {
            filters(): Array<{ value?: unknown; condition?: unknown }>;
          };
        }> = [];
        const transaction = {
          set(
            key: string,
            value: { version: string; payload: unknown },
            options: {
              conditions?: {
                filters(): Array<{ value?: unknown; condition?: unknown }>;
              };
            },
          ) {
            writes.push({ key, value, ...options });
            return transaction;
          },
          async execute() {
            if (state.fail) throw new Error("storage offline");
            for (const write of writes) {
              if (!write.conditions) continue;
              const filters = write.conditions.filters();
              const current = state.records.get(write.key) as
                | Record<string, unknown>
                | undefined;
              for (const raw of filters) {
                const filter = raw as unknown as {
                  property: string;
                  condition: string;
                  values: unknown[];
                };
                const actual = current?.[filter.property];
                if (
                  filter.condition === "NOT_EXISTS"
                    ? actual !== undefined
                    : actual !== filter.values[0]
                )
                  throw new Error("condition failed");
              }
            }
            expect(writes).toHaveLength(5);
            for (const write of writes) {
              expect(
                Buffer.byteLength(JSON.stringify(write.value)),
              ).toBeLessThan(240 * 1024);
              state.records.set(write.key, structuredClone(write.value));
            }
            if (state.afterCommit) throw new Error("acknowledgment lost");
          },
        };
        return transaction;
      },
    },
  };
});

import { exchangeStore } from "../src/exchange-storage";

beforeEach(() => {
  state.records.clear();
  state.fail = false;
  state.afterCommit = false;
});
const record: RetainedDocument = {
  document: "stable-source-identity",
  updateSequenceNumber: 1,
  workdown: "😀".repeat(65536),
};
it("persists publication metadata with atomic guards and carries it across newer receipts", async () => {
  await exchangeStore.compareAndSet("publication", 0, record);
  const published = {
    ...record,
    publishedSequence: 1,
    notificationPending: true,
  };
  expect(
    await exchangeStore.compareAndSet("publication", 1, published, {
      revision: (await exchangeStore.read("publication"))?.revision,
    }),
  ).toBe(true);
  expect(await exchangeStore.read("publication")).toMatchObject(published);
  expect(
    await exchangeStore.compareAndSet("publication", 1, published, {
      revision: (await exchangeStore.read("publication"))?.revision,
    }),
  ).toBe(false);
  expect(
    await exchangeStore.compareAndSet(
      "publication",
      1,
      { ...published, notificationPending: false },
      {
        sequence: 1,
        pending: true,
        revision: (await exchangeStore.read("publication"))?.revision,
      },
    ),
  ).toBe(true);
  await exchangeStore.compareAndSet("publication", 1, {
    ...published,
    updateSequenceNumber: 2,
    notificationPending: false,
  });
  expect(
    await exchangeStore.compareAndSet("publication", 1, published, {
      sequence: 1,
      pending: false,
    }),
  ).toBe(false);
  expect(await exchangeStore.read("publication")).toMatchObject({
    updateSequenceNumber: 2,
    publishedSequence: 1,
  });
});
it("rejects corrupt publication metadata rather than exposing a false acknowledgment", async () => {
  await exchangeStore.compareAndSet("corrupt", 0, record);
  const metadata = [...state.records.values()].find(
    (value) => typeof value.payload === "object",
  );
  if (!metadata) throw new Error("Missing metadata fixture");
  metadata.payload = { document: record.document, publishedSequence: 2 };
  await expect(exchangeStore.read("corrupt")).rejects.toThrow(
    "Invalid publication metadata",
  );
});
it("atomically round-trips the full UTF-8 export bound and rejects a stale writer", async () => {
  expect(await exchangeStore.compareAndSet("scoped identity", 0, record)).toBe(
    true,
  );
  expect(await exchangeStore.read("scoped identity")).toMatchObject(record);
  expect(
    await exchangeStore.compareAndSet("scoped identity", 0, {
      ...record,
      workdown: "stale bytes",
    }),
  ).toBe(false);
  expect(await exchangeStore.read("scoped identity")).toMatchObject(record);
  expect(
    await exchangeStore.compareAndSet("scoped identity", 1, {
      ...record,
      updateSequenceNumber: 2,
      workdown: "latest bytes",
    }),
  ).toBe(true);
  expect(await exchangeStore.read("scoped identity")).toMatchObject({
    ...record,
    updateSequenceNumber: 2,
    workdown: "latest bytes",
  });
});
it("confirms an uncertain atomic write by readback and propagates a failed write", async () => {
  state.afterCommit = true;
  expect(await exchangeStore.compareAndSet("key", 0, record)).toBe(false);
  expect(await exchangeStore.read("key")).toMatchObject(record);
  state.afterCommit = false;
  state.fail = true;
  await expect(exchangeStore.compareAndSet("other", 0, record)).rejects.toThrow(
    "storage offline",
  );
  expect(await exchangeStore.read("other")).toBeUndefined();
});
