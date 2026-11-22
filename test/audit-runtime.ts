import { vi } from "vitest";

// Unrelated HTTP suites run the real audit adapter against a local Forge boundary.
vi.mock("@forge/api", async (original) => ({
  ...(await original<typeof import("@forge/api")>()),
  getAppContext: () => ({
    environmentType: "DEVELOPMENT",
    installationAri: { installationId: "test-installation" },
    environmentAri: { environmentId: "test-environment" },
  }),
}));
vi.mock("@forge/kvs", async (original) => {
  const actual = await original<typeof import("@forge/kvs")>();
  const records = new Map<string, unknown>();
  return {
    ...actual,
    kvs: Object.assign(Object.create(actual.kvs), {
      async set(key: string, value: unknown) {
        if (!key.startsWith("audit:v1:"))
          throw new Error("Unexpected KVS write");
        if (records.has(key)) throw new Error("Duplicate audit ID");
        records.set(key, structuredClone(value));
      },
    }),
  };
});
