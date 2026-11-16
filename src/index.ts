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
import { authenticate, installation } from "./jira";
import { options } from "./rpc";

const logger = createForgeLogger({ name: "workdown", pretty: false });
const errorPolicy = defineLogObjectSummaryPolicy({
  kind: "invocationError",
  fields: {},
});

const handle = createWebtrigger({
  ...options,
  installation,
  authenticate,
  context: (installation, principal) => ({ installation, principal }),
});

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
      () => handle(request, context),
      {
        successMessage: "workdown.rpc.completed",
        errorMessage: "workdown.rpc.failed",
        errorPolicy,
        summarizeResult: summarizeResponse,
      },
    ),
  );

export const runAsync = runSync;
