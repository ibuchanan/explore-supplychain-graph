import { beforeEach, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@forge/api", () => ({
  default: { asUser: () => ({ requestJira: read }) },
  assumeTrustedRoute: (path: string) => path,
}));
const list = vi.hoisted(() => vi.fn());
vi.mock("../src/logs", () => ({ listLogs: list }));

import { handler } from "../src/log-resolver";

const cloudId = "00000000-0000-4000-8000-000000000001";
const context = {
  accountId: "admin",
  cloudId,
  installContext: `ari:cloud:jira::site/${cloudId}`,
};
const invoke = (payload: unknown, trusted = context) =>
  handler(
    { call: { functionKey: "logs.list", payload }, context: trusted },
    {
      installContext: trusted.installContext,
      principal: { accountId: trusted.accountId },
    },
  );
beforeEach(() => {
  vi.clearAllMocks();
});
it("binds the Command to trusted session context, not payload identity", async () => {
  list.mockResolvedValue({ isOk: () => true, value: { events: [] } });
  const params = { kind: "audit" };
  await expect(invoke(params)).resolves.toEqual({
    ok: true,
    page: { events: [] },
  });
  const commandContext = list.mock.calls[0]?.[1];
  expect(commandContext.principal.accountId).toBe("admin");
  expect(commandContext.installation.cloudId).toBe(cloudId);
  await commandContext.principal.authorization(
    "myself",
    new AbortController().signal,
  );
  expect(read).toHaveBeenCalledWith("/rest/api/3/myself", expect.any(Object));
});
it("fails closed without trusted identity or with contradictory site binding", async () => {
  await expect(
    invoke({ accountId: "admin" }, { ...context, accountId: "" }),
  ).resolves.toEqual({ ok: false, error: "forbidden" });
  await expect(invoke({}, { ...context, cloudId: "foreign" })).resolves.toEqual(
    { ok: false, error: "forbidden" },
  );
  expect(list).not.toHaveBeenCalled();
});
it("sanitizes Command errors and thrown failures", async () => {
  list.mockResolvedValueOnce({ isOk: () => false, error: "forbidden" });
  await expect(invoke({})).resolves.toEqual({ ok: false, error: "forbidden" });
  list.mockRejectedValueOnce(new Error("secret"));
  await expect(invoke({})).resolves.toEqual({
    ok: false,
    error: "logs-unavailable",
  });
});
