import { getAppContext } from "@forge/api";
import { createForgeLogger } from "@forge-ahead/logging";
import { registeredExchanges } from "./exchange-registry";
import { installation } from "./jira";
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
