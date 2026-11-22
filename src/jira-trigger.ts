import { getAppContext } from "@forge/api";
import { logger, withOperationalLogs } from "./logging";
import { registeredExchanges } from "./exchange-registry";
import { installation } from "./jira";
import { withJiraBudget } from "./jira-budget";
import { eventPrincipal } from "./jira-event-adapter";
import { createJiraEventHandler } from "./jira-events";
import { exchange } from "./rpc";

export const onJiraChange = (
  event: unknown,
  context: { installContext?: string },
) =>
  withOperationalLogs(() =>
    withJiraBudget(() => handleJiraChange(event, context), 14_750),
  );

async function handleJiraChange(
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
