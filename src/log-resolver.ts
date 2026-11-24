import api, { assumeTrustedRoute } from "@forge/api";
import Resolver from "@forge/resolver";
import type { Commands } from "./generated/contract";
import { installation } from "./jira";
import { withJiraBudget } from "./jira-budget";
import { listLogs } from "./logs";

const resolver = new Resolver();
resolver.define<Commands["logs.list"]["params"]>(
  "logs.list",
  async ({ payload, context }) =>
    withJiraBudget(async () => {
      try {
        const site = installation({
          installContext: context["installContext"],
        });
        const accountId: unknown = context["accountId"];
        if (
          !site ||
          site.cloudId !== context["cloudId"] ||
          typeof accountId !== "string" ||
          !accountId.trim()
        )
          return { ok: false, error: "forbidden" };
        const result = await listLogs(payload, {
          installation: site,
          principal: {
            accountId,
            // Only business-owned Jira paths reach this reader; never browser URLs.
            authorization: (path, signal) =>
              api
                .asUser()
                .requestJira(assumeTrustedRoute(`/rest/api/3/${path}`), {
                  headers: { Accept: "application/json" },
                  signal,
                }),
          },
        });
        if (result.isOk()) return { ok: true, page: result.value };
        return {
          ok: false,
          error:
            result.error === "forbidden" || result.error === "invalid-params"
              ? result.error
              : "logs-unavailable",
        };
      } catch {
        return { ok: false, error: "logs-unavailable" };
      }
    }),
);
export const handler = resolver.getDefinitions();
