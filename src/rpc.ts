import { getAppContext } from "@forge/api";
import { Queue } from "@forge/events";
import { createForgeLogger } from "@forge-ahead/logging";
import {
  createWebDispatcher,
  type OpenRpcDocument,
  type WebOptions,
} from "@forge-ahead/rpc";
import { commandErrors } from "./command-errors";
import { createExchangeCommands } from "./exchange";
import { rememberExchange } from "./exchange-registry";
import { exchangeStore } from "./exchange-storage";
import { webPolicy } from "./generated/policy";
import { inputValidators, outputValidators } from "./generated/validators.js";
import { dispatchPublication, ingestWorkdown } from "./graph";
import type { CommandContext } from "./jira";
import { isProjectAdmin } from "./jira";
import document from "./openrpc.json";
import { exportWorkdown } from "./workdown";
import { validateWorkdown } from "./workdown-validation";

const logger = createForgeLogger({ name: "workdown", pretty: false });
const retryQueue = new Queue({ key: "workdown-retries" });
export const exchange = createExchangeCommands({
  store: exchangeStore,
  remember: rememberExchange,
  environment: () => {
    try {
      return getAppContext().environmentType;
    } catch {
      return "UNKNOWN";
    }
  },
  generate: exportWorkdown,
  isProjectAdmin,
  ingest: ingestWorkdown,
  notify: dispatchPublication,
  notificationEnabled: false,
  schedule: async (body, delayInSeconds) => {
    await retryQueue.push({
      body,
      delayInSeconds,
      concurrency: {
        key: JSON.stringify([body.connection, body.document]),
        limit: 1,
      },
    });
  },
  reportPublication: (stage, outcome) =>
    logger.info({ stage, outcome }, "workdown.publication"),
});

export const options: WebOptions<CommandContext> = {
  catalog: document as unknown as OpenRpcDocument,
  webPolicy,
  handlers: {
    "workdown.export": exportWorkdown,
    "exchange.start": exchange.start,
    "document.get": exchange.get,
    "publication.status": exchange.status,
    "exchange.status": exchange.sourceStatus,
  },
  inputValidators,
  outputValidators: {
    ...outputValidators,
    "workdown.export": (value) =>
      outputValidators["workdown.export"](value) && validateWorkdown(value),
  },
  errorCatalog: commandErrors,
  selection: () => ({
    "workdown.export": "asUser",
    "exchange.start": "asUser",
    "exchange.status": "asUser",
    "document.get": "asApp",
    "publication.status": "asApp",
  }),
  authorize: () => true,
  // The handler uses the same Jira-verified credential, never Forge impersonation.
  canActAsUser: (context) =>
    !!context.principal.authorization && !!context.principal.accountId,
};

// The dependency's discovery projection drops numeric bounds. Restore the
// approved public contract only after its authenticated, validated discovery.
export function completeDiscovery(response: unknown): unknown {
  if (!response || typeof response !== "object" || !("result" in response))
    return response;
  const result = response.result;
  if (!result || typeof result !== "object" || !("openrpc" in result))
    return response;
  return {
    ...response,
    result: {
      ...document,
      methods: document.methods.map(
        ({ "x-forge-ahead": _policy, examples: _examples, ...method }) =>
          method,
      ),
    },
  };
}

export const dispatch = async (request: unknown, context: CommandContext) =>
  completeDiscovery(
    await createWebDispatcher(options).dispatch(request, context),
  ) as Awaited<
    ReturnType<
      ReturnType<typeof createWebDispatcher<CommandContext>>["dispatch"]
    >
  >;
