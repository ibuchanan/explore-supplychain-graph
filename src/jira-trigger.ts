import { getAppContext } from "@forge/api";
import { createForgeLogger } from "@forge-ahead/logging";
import { registeredExchanges } from "./exchange-registry";
import { exchangeStore } from "./exchange-storage";
import { installation, jiraGet } from "./jira";
import { eventPrincipal } from "./jira-event-adapter";
import { createJiraEventHandler } from "./jira-events";
import { exchange } from "./rpc";

const logger = createForgeLogger({ name: "workdown", pretty: false });

export async function onJiraChange(
  event: unknown,
  context: { installContext?: string },
) {
  const site = installation(context);
  if (!site || getAppContext().environmentType !== "DEVELOPMENT") return;
  const handle = createJiraEventHandler({
    registrations: registeredExchanges,
    retained: async (registration) =>
      (
        await exchangeStore.read(
          JSON.stringify([
            site.cloudId,
            registration.connection,
            "source",
            registration.document,
          ]),
        )
      )?.workdown,
    parent: async (issue, registration) => {
      const response = await jiraGet(
        site,
        eventPrincipal(registration.accountId).authorization,
        `issue/${encodeURIComponent(issue)}?fields=parent&failFast=true`,
      );
      if (!response.ok) throw new Error("Parent read unavailable");
      const data = (await response.json()) as {
        fields?: { parent?: { id?: unknown } };
      };
      const parent = data.fields?.parent?.id;
      if (parent === undefined) return undefined;
      if (typeof parent !== "string" || !/^\d+$/.test(parent))
        throw new Error("Invalid parent");
      return parent;
    },
    republish: (registration) =>
      exchange.start(
        {
          connection: registration.connection,
          profile: "jira-epic",
          issue: registration.document.split("/").at(-1) as string,
        },
        {
          installation: site,
          principal: eventPrincipal(registration.accountId),
        },
      ),
  });
  try {
    const outcome = await handle(event, site.cloudId);
    logger.info(outcome, "workdown.jira-change.completed");
  } catch {
    // Raw Jira events, errors and context are disclosure surfaces.
    logger.info({ outcome: "unavailable" }, "workdown.jira-change.failed");
  }
}
