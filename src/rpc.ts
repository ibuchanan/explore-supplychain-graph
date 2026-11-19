import { getAppContext } from "@forge/api";
import {
  createWebDispatcher,
  type OpenRpcDocument,
  type WebOptions,
} from "@forge-ahead/rpc";
import { commandErrors } from "./command-errors";
import { createExchangeCommands } from "./exchange";
import { exchangeStore } from "./exchange-storage";
import { webPolicy } from "./generated/policy";
import { inputValidators, outputValidators } from "./generated/validators.js";
import { dispatchPublication, ingestWorkdown } from "./graph";
import type { CommandContext } from "./jira";
import { isProjectAdmin } from "./jira";
import document from "./openrpc.json";
import { exportWorkdown } from "./workdown";
import { validateWorkdown } from "./workdown-validation";

const exchange = createExchangeCommands({
  store: exchangeStore,
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
});

export const options: WebOptions<CommandContext> = {
  catalog: document as unknown as OpenRpcDocument,
  webPolicy,
  handlers: {
    "workdown.export": exportWorkdown,
    "exchange.start": exchange.start,
    "document.get": exchange.get,
    "publication.status": exchange.status,
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
