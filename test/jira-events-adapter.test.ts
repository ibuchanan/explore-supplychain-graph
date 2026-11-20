import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  accountIds: [] as string[],
  paths: [] as string[],
  appCalls: 0,
  denied: false,
}));
vi.mock("@forge/api", () => ({
  default: {
    asUser: (accountId: string) => {
      state.accountIds.push(accountId);
      return {
        requestJira: async (path: string) => {
          state.paths.push(path);
          if (state.denied) throw new Error("private authorization details");
          return {
            ok: true,
            status: 200,
            json: async () => ({ fields: { parent: { id: "10042" } } }),
          };
        },
      };
    },
    asApp: () => {
      state.appCalls++;
      throw new Error("must not use app access");
    },
  },
  assumeTrustedRoute: (path: string) => path,
}));

import { jiraGet } from "../src/jira";
import { eventPrincipal } from "../src/jira-event-adapter";

beforeEach(() => {
  state.accountIds.length = 0;
  state.paths.length = 0;
  state.appCalls = 0;
  state.denied = false;
});
it("routes Jira reads as the retained account without caller tokens or app fallback", async () => {
  const principal = eventPrincipal("sharing-admin");
  const response = await jiraGet(
    { cloudId: "site", apiBase: "unused" },
    principal.authorization,
    "issue/10044?fields=parent",
  );
  expect(await response.json()).toEqual({
    fields: { parent: { id: "10042" } },
  });
  expect(state.accountIds).toEqual(["sharing-admin"]);
  expect(state.paths).toEqual(["/rest/api/3/issue/10044?fields=parent"]);
  state.denied = true;
  await expect(
    jiraGet(
      { cloudId: "site", apiBase: "unused" },
      principal.authorization,
      "field/search",
    ),
  ).rejects.toThrow();
  expect(state.appCalls).toBe(0);
});
