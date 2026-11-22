import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  records: new Map<string, { value: unknown; expireTime: string }>(),
  writes: 0,
  lost: false,
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
    entity: (name: string) => {
      expect(name).toBe("log-event");
      return {
        async set(key: string, value: unknown, options: unknown) {
          state.writes++;
          expect(options).toEqual({
            keyPolicy: "FAIL_IF_EXISTS",
            ttl: { value: key.startsWith("audit:") ? 90 : 7, unit: "DAYS" },
          });
          if (state.records.has(key)) throw Error("exists");
          state.records.set(key, {
            value,
            expireTime: new Date(Date.now() + 90 * 86400000).toISOString(),
          });
          if (state.lost) throw Error("lost");
        },
        async get(key: string) {
          return state.records.get(key);
        },
      };
    },
  },
}));

import { persistEvent } from "../src/log-events";

const event = {
  specversion: "1.0",
  id: "event-1",
  source: "urn:workdown:audit",
  type: "com.forge-ahead.rpc.attempt",
  time: new Date().toISOString(),
  data: {
    installationId: "installation-1",
    environment: "environment-1",
    correlationId: "request-1",
    reason: "started",
    method: "rpc.discover",
  },
};
beforeEach(() => {
  state.records.clear();
  state.writes = 0;
  state.lost = false;
});
it("acknowledges immutable indexed audit events and confirms lost acknowledgments without resetting expiry", async () => {
  state.lost = true;
  await persistEvent("audit", event);
  expect(state.records.get("audit:event-1")?.value).toMatchObject({
    kind: "audit",
    timeKey: `${event.time}#event-1`,
    event,
  });
  const original = structuredClone(state.records.get("audit:event-1"));
  await persistEvent("audit", event);
  expect(state.records.get("audit:event-1")).toEqual(original);
  await expect(
    persistEvent("audit", {
      ...event,
      data: { ...event.data, reason: "failed" },
    }),
  ).rejects.toThrow();
  const retained = state.records.get("audit:event-1");
  if (!retained) throw Error("Missing record");
  retained.expireTime = new Date(0).toISOString();
  await expect(persistEvent("audit", event)).rejects.toThrow();
});

it("rejects substituting event kinds before writing", async () => {
  await expect(persistEvent("operational", event)).rejects.toThrow();
  expect(state.writes).toBe(0);
});

it("stores only allowlisted operational events under their own immutable seven-day keys", async () => {
  const operational = {
    specversion: "1.0",
    id: "operational-1",
    source: "urn:workdown:operational",
    type: "com.workdown.log.info",
    time: new Date().toISOString(),
    data: {
      installationId: "installation-1",
      environment: "environment-1",
      level: "info",
      event: "workdown.publication.summary",
      stage: "ingestion",
      outcome: "succeeded",
    },
  };
  await persistEvent("operational", operational);
  expect(state.records.get("operational:operational-1")?.value).toMatchObject({
    kind: "operational",
    event: operational,
    correlationId: "-",
  });
  await expect(
    persistEvent("operational", {
      ...operational,
      data: { ...operational.data, secret: "private" },
    }),
  ).rejects.toThrow();
  await expect(
    persistEvent("operational", {
      ...operational,
      time: "2026-01-01T00:00:00.000Z",
    }),
  ).rejects.toThrow();
  expect(state.records.size).toBe(1);
});
