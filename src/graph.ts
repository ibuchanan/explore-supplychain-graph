import { getAppContext } from "@forge/api";
import { kvs } from "@forge/kvs";
import { graph } from "@forge/teamwork-graph";
import type { Binding } from "./exchange";
import { installation } from "./jira";
import {
  createGraphPublisher,
  createPublicationDispatcher,
} from "./publication";

const connectionKey = (cloudId: string) =>
  `workdown-graph:${cloudId}:development-loopback`;
export function createGraphConnectionHandler(deps: {
  environment: () => string;
  get: (key: string) => Promise<string | undefined>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}) {
  return async (
    request: { action?: unknown; connectionId?: unknown },
    context: { installContext?: string },
  ) => {
    const local = installation(context);
    if (
      !local ||
      deps.environment() !== "DEVELOPMENT" ||
      typeof request.connectionId !== "string" ||
      !request.connectionId ||
      !["CREATED", "UPDATED", "DELETED"].includes(String(request.action))
    )
      return { success: false };
    const key = connectionKey(local.cloudId);
    const current = await deps.get(key);
    if (request.action === "DELETED") {
      if (current === request.connectionId) await deps.remove(key);
    } else {
      if (current && current !== request.connectionId)
        return { success: false };
      await deps.set(key, request.connectionId);
    }
    return { success: true };
  };
}
export const onGraphConnectionChange = createGraphConnectionHandler({
  environment: () => getAppContext().environmentType,
  get: (key) => kvs.get<string>(key),
  set: (key, value) => kvs.set(key, value),
  remove: (key) => kvs.delete(key),
});
export const ingestWorkdown = createGraphPublisher({
  connectionId: async (binding: Binding) => {
    if (
      getAppContext().environmentType !== "DEVELOPMENT" ||
      binding.connection !== "development-loopback" ||
      !getAppContext().installation?.contexts.some(
        (context) => context.cloudId === binding.cloudId,
      )
    )
      return undefined;
    return kvs.get<string>(connectionKey(binding.cloudId));
  },
  setObjects: (request) => graph.setObjects(request),
});
// Destination-local application handlers attach here; no HTTP receiver or
// Forge App Event is implied. External notification belongs to its own adapter.
export const dispatchPublication = createPublicationDispatcher([]);
