import type { ExchangeRegistration } from "./exchange";

type Dependencies = {
  registrations: (cloudId: string) => Promise<ExchangeRegistration[]>;
  republish: (registration: ExchangeRegistration) => Promise<object>;
};

// Events select work, never authorize disclosure. Only updates to the shared
// Subject itself refresh its document; included children are snapshot context.
export function createJiraEventHandler(deps: Dependencies) {
  return async (event: unknown, cloudId: string) => {
    const input = event as {
      eventType?: string;
      issue?: { id?: string };
    } | null;
    const result = { attempted: 0, failed: 0 };
    if (
      input?.eventType !== "avi:jira:updated:issue" ||
      typeof input.issue?.id !== "string" ||
      !/^\d+$/.test(input.issue.id)
    )
      return result;
    const changed = `ari:cloud:jira:${cloudId}:issue/${input.issue.id}`;
    for (const registration of await deps.registrations(cloudId)) {
      if (registration.cloudId !== cloudId || registration.document !== changed)
        continue;
      result.attempted++;
      try {
        if ("error" in (await deps.republish(registration))) result.failed++;
      } catch {
        result.failed++;
      }
    }
    return result;
  };
}
