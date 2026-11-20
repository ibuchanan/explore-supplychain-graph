import type { AsyncEvent } from "@forge/events";
import { beforeEach, expect, it, vi } from "vitest";

const cloudId = "00000000-0000-4000-8000-000000000001";
const document = `ari:cloud:jira:${cloudId}:issue/10042`;
const state = vi.hoisted(() => ({
  environment: "DEVELOPMENT",
  calls: [] as unknown[][],
  present: true,
}));
vi.mock("@forge/api", () => ({
  getAppContext: () => ({ environmentType: state.environment }),
}));
vi.mock("../src/exchange-registry", () => ({
  registeredExchanges: async (cloudId: string) =>
    state.present
      ? [
          {
            cloudId,
            connection: "development-loopback",
            document: `ari:cloud:jira:${cloudId}:issue/10042`,
            accountId: "retained-admin",
          },
        ]
      : [],
}));
vi.mock("../src/jira-event-adapter", () => ({
  eventPrincipal: (accountId: string) => ({
    accountId,
    authorization: "trusted-reader",
  }),
}));
vi.mock("../src/rpc", () => ({
  exchange: {
    consume: async (...args: unknown[]) => {
      state.calls.push(args);
      return { _retry: true, retryOptions: { retryAfter: 15 } };
    },
  },
}));

import { onRetry } from "../src/retry-trigger";

const context = { installContext: `ari:cloud:jira::site/${cloudId}` };
const event = {
  body: {
    connection: "development-loopback",
    document,
    stage: "ingestion",
    sequence: 1,
  },
  queueName: "workdown-retries",
  jobId: "job",
  eventId: "event",
} satisfies AsyncEvent;
beforeEach(() => {
  state.calls.length = 0;
  state.present = true;
  state.environment = "DEVELOPMENT";
});
it("binds native retry requests to trusted installation and retained sharing authority", async () => {
  expect(await onRetry(event, context)).toMatchObject({
    _retry: true,
    retryOptions: { retryAfter: 15 },
  });
  expect(state.calls).toMatchObject([
    [
      event,
      { installation: { cloudId }, principal: { accountId: "retained-admin" } },
    ],
  ]);
});
it("ignores unregistered, cross-installation and inactive work without resolving a caller-selected principal", async () => {
  state.present = false;
  await onRetry(event, context);
  state.present = true;
  await onRetry(event, {
    installContext: "ari:cloud:jira::site/00000000-0000-4000-8000-000000000002",
  });
  await onRetry(event, {});
  state.environment = "PRODUCTION";
  await onRetry(event, context);
  expect(state.calls).toEqual([]);
});
