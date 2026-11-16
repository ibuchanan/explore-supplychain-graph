import { createWebDispatcher, type WebOptions } from "@forge-ahead/rpc";
import { commandErrors } from "./command-errors";
import { webPolicy } from "./generated/policy";
import { inputValidators, outputValidators } from "./generated/validators.js";
import type { CommandContext } from "./jira";
import document from "./openrpc.json";
import { exportWorkdown } from "./workdown";
import { validateWorkdown } from "./workdown-validation";

export const options: WebOptions<CommandContext> = {
  catalog: document,
  webPolicy,
  handlers: { "workdown.export": exportWorkdown },
  inputValidators,
  outputValidators: {
    "workdown.export": (value) =>
      outputValidators["workdown.export"](value) && validateWorkdown(value),
  },
  errorCatalog: commandErrors,
  selection: () => ({ "workdown.export": "asUser" }),
  authorize: () => true,
  // The handler uses the same Jira-verified credential, never Forge impersonation.
  canActAsUser: (context) =>
    !!context.principal.authorization && !!context.principal.accountId,
};

export const dispatch = (request: unknown, context: CommandContext) =>
  createWebDispatcher(options).dispatch(request, context);
