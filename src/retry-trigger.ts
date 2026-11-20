import { getAppContext } from "@forge/api";
import type { AsyncEvent } from "@forge/events";
import { registeredExchanges } from "./exchange-registry";
import { installation } from "./jira";
import { eventPrincipal } from "./jira-event-adapter";
import { exchange } from "./rpc";

export async function onRetry(
  event: AsyncEvent,
  context: { installContext?: string },
) {
  const site = installation(context);
  if (!site || getAppContext().environmentType !== "DEVELOPMENT") return;
  const body = event.body;
  if (
    !body ||
    typeof body["connection"] !== "string" ||
    typeof body["document"] !== "string"
  )
    return;
  const registration = (await registeredExchanges(site.cloudId)).find(
    (row) =>
      row.connection === body["connection"] &&
      row.document === body["document"],
  );
  if (!registration) return;
  return exchange.consume(event, {
    installation: site,
    principal: eventPrincipal(registration.accountId),
  });
}
