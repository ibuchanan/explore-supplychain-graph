import { readFileSync } from "node:fs";
import { ok } from "@forge-ahead/errors";
import { expect, it } from "vitest";
import {
  createExchangeCommands,
  type ExchangeStore,
  type RetainedDocument,
} from "../src/exchange";

const cloudId = "00000000-0000-4000-8000-000000000001";
const document = `ari:cloud:jira:${cloudId}:issue/10042`;
const context = {
  installation: {
    cloudId,
    apiBase: `https://api.atlassian.com/ex/jira/${cloudId}`,
  },
  principal: { accountId: "admin", authorization: "Basic fake" },
};
const params = {
  connection: "development-loopback",
  profile: "jira-epic" as const,
  issue: "10042",
};
const read = { connection: params.connection, document };
const workdown = readFileSync(
  new URL(
    "./fixtures/workdown-export/epic-empty-description.workdown",
    import.meta.url,
  ),
  "utf8",
);
function fixture(failure: unknown = { status: 429, retryAfter: "5" }) {
  const records = new Map<string, RetainedDocument>();
  const queued: Array<{ body: unknown; delay: number }> = [];
  const store: ExchangeStore = {
    read: async (key) => structuredClone(records.get(key)),
    compareAndSet: async (key, previous, value) => {
      if ((records.get(key)?.updateSequenceNumber ?? 0) !== previous)
        return false;
      records.set(key, structuredClone(value));
      return true;
    },
  };
  let now = Date.parse("2026-11-20T14:00:00.000Z");
  let calls = 0;
  let authorized = true;
  const commands = createExchangeCommands({
    store,
    environment: () => "DEVELOPMENT",
    generate: async () => ok(workdown),
    isProjectAdmin: async () => authorized,
    now: () => now,
    random: () => 0.5,
    schedule: async (body, delay) => {
      queued.push({ body, delay });
    },
    ingest: async () => {
      calls++;
      throw failure;
    },
  });
  return {
    commands,
    queued,
    context,
    calls: () => calls,
    deny: () => {
      authorized = false;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it("requests native retries at 5, 15 and 45 seconds then records exhaustion without throwing", async () => {
  const f = fixture();
  await f.commands.start(params, context);
  expect(f.queued).toHaveLength(1);
  expect(f.queued[0]?.delay).toBe(5);
  expect(await f.commands.status(read, context)).toMatchObject({
    value: {
      ingestion: {
        state: "retrying",
        attempts: 1,
        lastFailure: "rate-limited",
      },
    },
  });
  const body = f.queued[0]?.body;
  f.advance(5000);
  const retry = await f.commands.consume({ body }, context);
  expect(retry).toMatchObject({ retryOptions: { retryAfter: 15 } });
  f.advance(15000);
  expect(
    await f.commands.consume(
      { body, retryContext: { retryCount: 1 } },
      context,
    ),
  ).toMatchObject({ retryOptions: { retryAfter: 45 } });
  f.advance(45000);
  expect(
    await f.commands.consume(
      { body, retryContext: { retryCount: 2 } },
      context,
    ),
  ).toBeUndefined();
  expect(f.calls()).toBe(4);
  expect(await f.commands.status(read, context)).toMatchObject({
    value: {
      ingestion: { state: "exhausted", attempts: 4, nextAttemptAt: null },
    },
  });
  await f.commands.start(params, context);
  await f.commands.consume({ body, retryContext: { retryCount: 3 } }, context);
  expect(f.calls()).toBe(4);
});

it.each([
  [{ status: 403 }, "failed", "authorization"],
  [{ status: 422 }, "failed", "validation"],
  [
    { status: 429, retryAfter: "901" },
    "retry-delay-unsupported",
    "rate-limited",
  ],
  [
    { status: 429, retryAfter: "Fri, 20 Nov 2026 14:16:00 GMT" },
    "retry-delay-unsupported",
    "rate-limited",
  ],
] as const)(
  "stops automatic work safely for %j",
  async (failure, state, lastFailure) => {
    const f = fixture(failure);
    await f.commands.start(params, context);
    expect(f.queued).toHaveLength(0);
    expect(await f.commands.status(read, context)).toMatchObject({
      value: {
        ingestion: { state, lastFailure, attempts: 1, nextAttemptAt: null },
      },
    });
    await f.commands.start(params, context);
    expect(
      await f.commands.consume(
        { body: { ...read, stage: "ingestion", sequence: 1 } },
        context,
      ),
    ).toBeUndefined();
    expect(f.calls()).toBe(1);
  },
);
it("does not perform an external call on an early or cross-installation retry", async () => {
  const f = fixture();
  await f.commands.start(params, context);
  expect(
    await f.commands.consume({ body: f.queued[0]?.body }, context),
  ).toMatchObject({ retryOptions: { retryAfter: 5 } });
  await f.commands.consume(
    { body: f.queued[0]?.body },
    {
      ...context,
      installation: {
        ...context.installation,
        cloudId: "00000000-0000-4000-8000-000000000002",
      },
    },
  );
  expect(f.calls()).toBe(1);
});
it("honors a supported provider delay without clamping to the nominal backoff", async () => {
  const f = fixture({ status: 429, retryAfter: "900" });
  await f.commands.start(params, context);
  expect(f.queued[0]?.delay).toBe(900);
  f.advance(899000);
  expect(
    await f.commands.consume({ body: f.queued[0]?.body }, context),
  ).toMatchObject({ retryOptions: { retryAfter: 1 } });
  expect(f.calls()).toBe(1);
});

it("records lost sharing authority as permanent without attempting external work", async () => {
  const f = fixture();
  await f.commands.start(params, context);
  f.advance(5000);
  f.deny();
  expect(
    await f.commands.consume({ body: f.queued[0]?.body }, context),
  ).toBeUndefined();
  expect(f.calls()).toBe(1);
  expect(await f.commands.status(read, context)).toMatchObject({
    value: {
      ingestion: {
        state: "failed",
        lastFailure: "authorization",
        nextAttemptAt: null,
      },
    },
  });
});
