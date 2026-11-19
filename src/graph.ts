import { getAppContext } from "@forge/api";
import { kvs } from "@forge/kvs";
import { graph } from "@forge/teamwork-graph";
import { createForgeLogger } from "@forge-ahead/logging";
import type { Binding } from "./exchange";
import { installation } from "./jira";
import {
  createGraphPublisher,
  createPublicationDispatcher,
} from "./publication";

const logger = createForgeLogger({ name: "workdown", pretty: false });
const connectionKey = (cloudId: string) =>
  `workdown-graph:${cloudId}:development-loopback`;
export function createGraphConnectionHandler(deps: {
  environment: () => string;
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
  report?: (
    outcome:
      | "invalid-context"
      | "invalid-request"
      | "inactive-environment"
      | "binding-conflict"
      | "bound"
      | "deleted"
      | "deletion-ignored",
  ) => void;
}) {
  return async (
    request: { action?: unknown; connectionId?: unknown },
    context: { installContext?: string },
  ) => {
    const local = installation(context);
    if (!local) {
      deps.report?.("invalid-context");
      return { success: false };
    }
    if (deps.environment() !== "DEVELOPMENT") {
      deps.report?.("inactive-environment");
      return { success: false };
    }
    if (
      typeof request.connectionId !== "string" ||
      !request.connectionId ||
      !["CREATED", "UPDATED", "DELETED"].includes(String(request.action))
    ) {
      deps.report?.("invalid-request");
      return { success: false };
    }
    const key = connectionKey(local.cloudId);
    const current = await deps.get(key);
    if (request.action === "DELETED") {
      if (current === request.connectionId) {
        await deps.remove(key);
        deps.report?.("deleted");
      } else deps.report?.("deletion-ignored");
    } else {
      if (current && current !== request.connectionId) {
        deps.report?.("binding-conflict");
        return { success: false };
      }
      await deps.set(key, request.connectionId);
      deps.report?.("bound");
    }
    return { success: true };
  };
}
export const onGraphConnectionChange = createGraphConnectionHandler({
  environment: () => getAppContext().environmentType,
  get: (key) => kvs.get<string>(key),
  set: (key, value) => kvs.set(key, value),
  remove: (key) => kvs.delete(key),
  report: (outcome) =>
    logger.info(
      { stage: "graph-connection", outcome },
      "workdown.graph.connection",
    ),
});
export const ingestWorkdown = createGraphPublisher({
  connectionId: async (binding: Binding) => {
    const runtime = getAppContext();
    if (
      runtime.environmentType !== "DEVELOPMENT" ||
      binding.connection !== "development-loopback"
    ) {
      logger.info(
        {
          stage: "graph-binding",
          outcome: "inactive-environment-or-connection",
        },
        "workdown.graph.binding",
      );
      return undefined;
    }
    if (
      !runtime.installation?.contexts.some(
        (context) => context.cloudId === binding.cloudId,
      )
    ) {
      logger.info(
        {
          stage: "graph-binding",
          outcome: runtime.installation
            ? "installation-mismatch"
            : "installation-context-unavailable",
        },
        "workdown.graph.binding",
      );
      return undefined;
    }
    const connectionId = await kvs.get<string>(connectionKey(binding.cloudId));
    logger.info(
      {
        stage: "graph-binding",
        outcome: connectionId ? "bound" : "binding-unavailable",
      },
      "workdown.graph.binding",
    );
    return connectionId;
  },
  setObjects: (request) => graph.setObjects(request),
  report: (outcome, details) =>
    logger.info(
      { stage: "graph-ingestion", outcome, ...details },
      "workdown.graph.ingestion",
    ),
});
// Destination-local application handlers attach here; no HTTP receiver or
// Forge App Event is implied. External notification belongs to its own adapter.
export const dispatchPublication = createPublicationDispatcher([]);
