import { parse } from "yaml";
import type { ExchangeRegistration } from "./exchange";

type Dependencies = {
  registrations: (cloudId: string) => Promise<ExchangeRegistration[]>;
  retained: (registration: ExchangeRegistration) => Promise<string | undefined>;
  parent: (
    issue: string,
    registration: ExchangeRegistration,
  ) => Promise<string | undefined>;
  republish: (registration: ExchangeRegistration) => Promise<object>;
};

// Events select work, never authorize disclosure. All content is regenerated
// under the retained sharing principal's current permissions before delivery.
export function createJiraEventHandler(deps: Dependencies) {
  return async (event: unknown, cloudId: string) => {
    const input = event as {
      eventType?: string;
      issue?: { id?: string };
    } | null;
    const result = { attempted: 0, failed: 0 };
    if (
      !input ||
      ![
        "avi:jira:created:issue",
        "avi:jira:updated:issue",
        "avi:jira:deleted:issue",
      ].includes(input.eventType ?? "") ||
      typeof input.issue?.id !== "string" ||
      !/^\d+$/.test(input.issue.id)
    )
      return result;
    const changed = `ari:cloud:jira:${cloudId}:issue/${input.issue.id}`;
    // ponytail: scan registered Exchanges in this development-only slice;
    // use an indexed membership registry when fan-out warrants it.
    for (const registration of await deps.registrations(cloudId)) {
      if (registration.cloudId !== cloudId) continue;
      // Deleting a Subject is unsupported; never turn it into a withdrawal.
      if (
        registration.document === changed &&
        input.eventType === "avi:jira:deleted:issue"
      )
        continue;
      try {
        let affected = registration.document === changed;
        if (!affected) {
          const bytes = await deps.retained(registration);
          if (bytes) {
            const metadata = parse(
              bytes.slice(4, bytes.indexOf("\n---\n", 4)),
            ) as { children?: { source_id: string }[] };
            affected =
              metadata.children?.some((child) => child.source_id === changed) ??
              false;
          }
          if (!affected && input.eventType !== "avi:jira:deleted:issue") {
            const parent = await deps.parent(input.issue.id, registration);
            affected =
              !!parent &&
              registration.document ===
                `ari:cloud:jira:${cloudId}:issue/${parent}`;
          }
        }
        if (!affected) continue;
        result.attempted++;
        if ("error" in (await deps.republish(registration))) result.failed++;
      } catch {
        result.failed++;
      }
    }
    return result;
  };
}
