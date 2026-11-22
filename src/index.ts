import { randomUUID } from "node:crypto";
import {
  createForgeLogger,
  defineLogObjectSummaryPolicy,
  withLogContext,
} from "@forge-ahead/logging";
import {
  createWebtrigger,
  type WebtriggerResponse,
} from "@forge-ahead/rpc/webtrigger";
import { audit } from "./audit";
import { authenticate, authenticateAdmin, installation } from "./jira";
import { withJiraBudget } from "./jira-budget";
import { completeDiscovery, options } from "./rpc";

const logger = createForgeLogger({ name: "workdown", pretty: false });
const errorPolicy = defineLogObjectSummaryPolicy({
  kind: "invocationError",
  fields: {},
});

const authenticatedHandle = createWebtrigger({
  ...options,
  audit,
  installation,
  authenticate,
  context: (installation, principal) => ({ installation, principal }),
});
const adminHandle = createWebtrigger({
  ...options,
  audit,
  installation,
  authenticate: authenticateAdmin,
  context: (installation, principal) => ({ installation, principal }),
});
const handle: typeof adminHandle = async (request, context) => {
  let method: unknown;
  try {
    method = JSON.parse(request.body ?? "").method;
  } catch {
    /* Malformed requests retain the existing admin admission policy. */
  }
  const response = await (method === "exchange.start" ||
    method === "exchange.status" ||
    method === "document.get" ||
    method === "publication.status"
    ? authenticatedHandle
    : adminHandle)(request, context);
  if (method === "rpc.discover" && response.statusCode === 200)
    return {
      ...response,
      body: JSON.stringify(completeDiscovery(JSON.parse(response.body))),
    };
  return response;
};

function summarizeResponse(
  response: WebtriggerResponse,
): Record<string, unknown> {
  if (response.statusCode !== 200)
    return { statusCode: response.statusCode, outcome: "failure" };
  const envelope = JSON.parse(response.body) as { error?: { code?: unknown } };
  return {
    statusCode: response.statusCode,
    outcome: envelope.error ? "failure" : "success",
    ...(typeof envelope.error?.code === "number"
      ? { rpcErrorCode: envelope.error.code }
      : {}),
  };
}

export const runSync: typeof handle = async (request, context) =>
  withLogContext({ operation: "webtrigger", requestId: randomUUID() }, () =>
    logger.invocation(
      { eventType: "webtrigger" },
      () => withJiraBudget(() => handle(request, context)),
      {
        successMessage: "workdown.rpc.completed",
        errorMessage: "workdown.rpc.failed",
        errorPolicy,
        summarizeResult: summarizeResponse,
      },
    ),
  );

export const runAsync = runSync;
