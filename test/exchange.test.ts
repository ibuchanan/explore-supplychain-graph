import { readFileSync } from "node:fs";
import { err, ok } from "@forge-ahead/errors";
import { createWebDispatcher } from "@forge-ahead/rpc";
import { describe, expect, it } from "vitest";
import {
  createExchangeCommands,
  createLoopbackReceiver,
  type ExchangeStore,
  type RetainedDocument,
} from "../src/exchange";
import { options } from "../src/rpc";

const workdown = readFileSync(
  new URL(
    "./fixtures/workdown-export/epic-empty-description.workdown",
    import.meta.url,
  ),
  "utf8",
);
const document =
  "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10042";
function memory(): ExchangeStore {
  const records = new Map<string, RetainedDocument>();
  return {
    async read(key) {
      return records.get(key);
    },
    async compareAndSet(key, previous, value, publication) {
      const current = records.get(key);
      if ((current?.updateSequenceNumber ?? 0) !== previous) return false;
      if (
        publication &&
        (current?.publishedSequence !== publication.sequence ||
          current?.notificationPending !== publication.pending)
      )
        return false;
      records.set(key, structuredClone(value));
      return true;
    },
  };
}
const params = {
  connection: "development-loopback",
  profile: "jira-epic" as const,
  issue: "DEMO-42",
};
const context = {
  installation: {
    cloudId: "00000000-0000-4000-8000-000000000001",
    apiBase:
      "https://api.atlassian.com/ex/jira/00000000-0000-4000-8000-000000000001",
  },
  principal: { accountId: "source-admin", authorization: "Basic fake" },
};
const read = { connection: params.connection, document };
const defaults = () => ({
  store: memory(),
  environment: () => "DEVELOPMENT",
  generate: async () => ok<string, string>(workdown),
  isProjectAdmin: async () => true,
  now: () => 0,
  random: () => 0.5,
});

describe("Exchange business Commands", () => {
  it("reads source delivery progress only after current Subject authorization", async () => {
    let authorized = true;
    const business = createExchangeCommands({
      ...defaults(),
      isProjectAdmin: async () => authorized,
    });
    await business.start(params, context);
    expect(await business.sourceStatus(read, context)).toMatchObject({
      value: {
        ...read,
        preparedSequence: 1,
        delivery: {
          state: "succeeded",
          sequence: 1,
          lastSuccessfulSequence: 1,
          attempts: 1,
        },
      },
    });
    authorized = false;
    expect(await business.sourceStatus(read, context)).toEqual({
      error: "forbidden",
    });
  });
  it("does not disclose when principal retention fails", async () => {
    let deliveries = 0;
    const commands = createExchangeCommands({
      ...defaults(),
      remember: async () => {
        throw new Error("private storage detail");
      },
      deliver: async () => {
        deliveries++;
        return ok(1);
      },
    });
    expect(await commands.start(params, context)).toEqual({
      error: "storage-unavailable",
    });
    expect(deliveries).toBe(0);
  });
  it("retains the authorized sharing principal without retaining the API token", async () => {
    const registrations: unknown[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      remember: async (registration) => {
        registrations.push(registration);
      },
    });
    await commands.start(params, context);
    await commands.start(params, {
      ...context,
      principal: {
        accountId: "source-admin",
        authorization: async () => Response.json({}),
      },
    });
    expect(registrations).toEqual([
      {
        cloudId: context.installation.cloudId,
        connection: params.connection,
        document,
        accountId: "source-admin",
      },
    ]);
  });
  it("reports acknowledgment storage failure without exposing errors or losing retained content", async () => {
    const store = memory();
    const outcomes: unknown[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      store: {
        ...store,
        compareAndSet: async (key, previous, value, publication) => {
          if (value.publishedSequence)
            throw new Error("private-storage-diagnostic");
          return store.compareAndSet(key, previous, value, publication);
        },
      },
      ingest: async () => true,
      reportPublication: (stage, outcome) => {
        outcomes.push({ stage, outcome });
      },
    });
    expect(await commands.start(params, context)).toHaveProperty("value");
    expect(await commands.status(read, context)).toMatchObject({
      value: { retainedSequence: 1, publishedSequence: null },
    });
    expect(outcomes).toEqual([
      { stage: "acknowledgment-storage", outcome: "exception" },
    ]);
    expect(await commands.get(read, context)).toMatchObject({
      value: { workdown },
    });
  });
  it("publishes only acknowledged ingestion and dispatches an identity-only JSON-RPC notification once", async () => {
    const notifications: unknown[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      ingest: async () => true,
      notify: async (notification) => {
        notifications.push(notification);
      },
    });
    await commands.start(params, context);
    expect(await commands.status(read, context)).toMatchObject({
      value: {
        ...read,
        loopback: true,
        retainedSequence: 1,
        publishedSequence: 1,
      },
    });
    await commands.start(params, context);
    expect(notifications).toEqual([
      {
        jsonrpc: "2.0",
        method: "publication.published",
        params: { ...read, loopback: true, updateSequenceNumber: 1 },
      },
    ]);
    expect(await commands.get(read, context)).toEqual({
      value: { ...read, loopback: true, updateSequenceNumber: 1, workdown },
    });
  });
  it("does not publish a superseded acknowledgment or regress the latest retained sequence", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let bytes = workdown;
    const notifications: unknown[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      generate: async () => ok(bytes),
      ingest: async (record) => {
        if (record.updateSequenceNumber === 1) {
          entered();
          await gate;
        }
        return true;
      },
      notify: async (event) => {
        notifications.push(event);
      },
    });
    const first = commands.start(params, context);
    await started;
    bytes = workdown.replace("No description provided.", "Newer description.");
    await commands.start(params, context);
    release();
    await first;
    expect(await commands.status(read, context)).toMatchObject({
      value: { retainedSequence: 2, publishedSequence: 2 },
    });
    expect(notifications).toEqual([
      {
        jsonrpc: "2.0",
        method: "publication.published",
        params: { ...read, loopback: true, updateSequenceNumber: 2 },
      },
    ]);
  });
  it("retains a rejected newer update without inventing a Publication and retries pending notification independently", async () => {
    let bytes = workdown;
    let acknowledged = true;
    let clock = 0;
    let notifyFails = true;
    let ingestions = 0;
    const delivered: number[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      generate: async () => ok(bytes),
      now: () => clock,
      ingest: async () => {
        ingestions++;
        return acknowledged;
      },
      notify: async (event) => {
        if (notifyFails) throw new Error("consumer offline");
        delivered.push(event.params.updateSequenceNumber);
      },
    });
    await commands.start(params, context);
    expect(await commands.status(read, context)).toMatchObject({
      value: { retainedSequence: 1, publishedSequence: 1 },
    });
    notifyFails = false;
    await commands.start(params, context);
    expect(ingestions).toBe(1);
    await commands.consume(
      { body: { ...read, stage: "notification", sequence: 1 } },
      context,
    );
    expect(delivered).toEqual([]);
    acknowledged = false;
    bytes = workdown.replace("No description provided.", "Not yet ingested.");
    await commands.start(params, context);
    expect(await commands.status(read, context)).toMatchObject({
      value: { retainedSequence: 2, publishedSequence: 1 },
    });
    expect(await commands.get(read, context)).toMatchObject({
      value: { workdown: bytes },
    });
    expect(delivered).toEqual([]);
    acknowledged = true;
    clock = 60000;
    await commands.consume(
      { body: { ...read, stage: "notification", sequence: 1 } },
      context,
    );
    await commands.consume(
      { body: { ...read, stage: "ingestion", sequence: 2 } },
      context,
    );
    await Promise.all([
      commands.start(params, context),
      commands.start(params, context),
    ]);
    expect(await commands.status(read, context)).toMatchObject({
      value: { retainedSequence: 2, publishedSequence: 2 },
    });
    expect(delivered).toEqual([1, 2]);
  });
  it("does not discard a failed Publication notification when newer content is retained", async () => {
    let fail = true;
    let clock = 0;
    let bytes = workdown;
    const sequences: number[] = [];
    const commands = createExchangeCommands({
      ...defaults(),
      generate: async () => ok(bytes),
      now: () => clock,
      ingest: async () => true,
      notify: async (event) => {
        if (fail) throw new Error("offline");
        sequences.push(event.params.updateSequenceNumber);
      },
    });
    await commands.start(params, context);
    bytes = workdown.replace("No description provided.", "New content.");
    await commands.start(params, context);
    fail = false;
    clock = 60000;
    await commands.consume(
      { body: { ...read, stage: "notification", sequence: 1 } },
      context,
    );
    await commands.consume(
      { body: { ...read, stage: "ingestion", sequence: 2 } },
      context,
    );
    expect(sequences).toEqual([1, 2]);
  });
  it("keeps status destination-authenticated, installation-scoped, and fails closed on storage errors", async () => {
    const commands = createExchangeCommands(defaults());
    expect(await commands.status(read, context)).toMatchObject({
      error: "document-unavailable",
    });
    expect(
      await commands.status(read, {
        ...context,
        principal: { accountId: "", authorization: "" },
      }),
    ).toEqual({ error: "forbidden" });
    expect(
      await commands.status({ ...read, connection: "revoked" }, context),
    ).toEqual({ error: "connection-unavailable" });
    await commands.start(params, context);
    expect(
      await commands.status(read, {
        ...context,
        installation: {
          ...context.installation,
          cloudId: "00000000-0000-4000-8000-000000000002",
        },
      }),
    ).toEqual({ error: "document-unavailable" });
    const failed = createExchangeCommands({
      ...defaults(),
      store: {
        ...memory(),
        read: async () => {
          throw new Error("private diagnostics");
        },
      },
    });
    expect(await failed.status(read, context)).toEqual({
      error: "storage-unavailable",
    });
  });
  it("reports accepted content as unpublished until TWG acknowledges it", async () => {
    const commands = createExchangeCommands(defaults());
    await commands.start(params, context);
    expect(await commands.status(read, context)).toMatchObject({
      value: {
        ...read,
        loopback: true,
        retainedSequence: 1,
        publishedSequence: null,
      },
    });
  });
  it("serves both Commands through validated dispatcher inputs and outputs", async () => {
    const business = createExchangeCommands(defaults());
    const dispatch = createWebDispatcher({
      ...options,
      handlers: {
        ...options.handlers,
        "exchange.start": business.start,
        "document.get": business.get,
        "publication.status": business.status,
      },
    }).dispatch;
    expect(
      await dispatch(
        { jsonrpc: "2.0", id: 1, method: "exchange.start", params },
        context,
      ),
    ).toMatchObject({ result: { document, updateSequenceNumber: 1 } });
    expect(
      await dispatch(
        { jsonrpc: "2.0", id: 2, method: "document.get", params: read },
        context,
      ),
    ).toMatchObject({
      result: { document, workdown, updateSequenceNumber: 1 },
    });
    expect(
      await dispatch(
        { jsonrpc: "2.0", id: 3, method: "publication.status", params: read },
        context,
      ),
    ).toMatchObject({
      result: {
        ...read,
        loopback: true,
        retainedSequence: 1,
        publishedSequence: null,
      },
    });
    expect(
      await dispatch(
        {
          jsonrpc: "2.0",
          id: 3,
          method: "exchange.start",
          params: { ...params, endpoint: "https://attacker.invalid" },
        },
        context,
      ),
    ).toMatchObject({ error: { code: -32602 } });
  });
  it("keeps two peer roles isolated and rejects stale and conflicting duplicate deliveries", async () => {
    const destination = memory();
    const receive = createLoopbackReceiver(destination, () => "DEVELOPMENT");
    const binding = {
      cloudId: context.installation.cloudId,
      connection: params.connection,
    };
    const newer = workdown.replace(
      "No description provided.",
      "Newer retained description.",
    );
    expect(
      await receive(
        { document, workdown: newer, updateSequenceNumber: 2 },
        binding,
      ),
    ).toEqual({ value: 2 });
    expect(
      await receive({ document, workdown, updateSequenceNumber: 1 }, binding),
    ).toEqual({ value: 2 });
    expect(
      await receive({ document, workdown, updateSequenceNumber: 2 }, binding),
    ).toEqual({ error: "invalid-params" });
    const reader = createExchangeCommands({
      ...defaults(),
      store: destination,
    });
    expect(await reader.get(read, context)).toMatchObject({
      value: { workdown: newer, updateSequenceNumber: 2 },
    });
    const source = createExchangeCommands({ ...defaults(), deliver: receive });
    expect(await source.start(params, context)).toMatchObject({
      value: { updateSequenceNumber: 2 },
    });
  });
  it("reuses a durable candidate after an uncertain delivery", async () => {
    const destination = memory();
    const receive = createLoopbackReceiver(destination, () => "DEVELOPMENT");
    let uncertain = true;
    const source = createExchangeCommands({
      ...defaults(),
      deliver: async (candidate, binding) => {
        const result = await receive(candidate, binding);
        if (uncertain) {
          uncertain = false;
          throw new Error("lost acknowledgment");
        }
        return result;
      },
    });
    expect(await source.start(params, context)).toEqual({
      error: "delivery-unconfirmed",
    });
    expect(await source.start(params, context)).toEqual({
      error: "delivery-unconfirmed",
    });
  });
  it("starts immediately and reads retained bytes as a destination reader without source access", async () => {
    const commands = createExchangeCommands(defaults());
    expect(await commands.start(params, context)).toEqual({
      value: { ...read, loopback: true, updateSequenceNumber: 1 },
    });
    expect(
      await commands.get(read, {
        ...context,
        principal: {
          accountId: "destination-reader",
          authorization: "Basic reader",
        },
      }),
    ).toEqual({
      value: { ...read, loopback: true, updateSequenceNumber: 1, workdown },
    });
  });
  it("reuses unchanged sequences and advances changed bytes under concurrent starts", async () => {
    let bytes = workdown;
    const commands = createExchangeCommands({
      ...defaults(),
      generate: async () => ok(bytes),
    });
    await commands.start(params, context);
    expect(await commands.start(params, context)).toMatchObject({
      value: { updateSequenceNumber: 1 },
    });
    bytes = workdown.replace(
      "No description provided.",
      "Changed description.",
    );
    const results = await Promise.all([
      commands.start(params, context),
      commands.start(params, context),
    ]);
    for (const result of results)
      expect(result).toMatchObject({ value: { updateSequenceNumber: 2 } });
    expect(await commands.get(read, context)).toMatchObject({
      value: { workdown: bytes, updateSequenceNumber: 2 },
    });
  });
  it("does not report success without an accepted same-or-newer candidate", async () => {
    const commands = createExchangeCommands({
      ...defaults(),
      store: { ...memory(), compareAndSet: async () => false },
    });
    expect(await commands.start(params, context)).toEqual({
      error: "delivery-unconfirmed",
    });
  });
  it("rejects corrupted retained Workdown instead of disclosing it", async () => {
    const commands = createExchangeCommands({
      ...defaults(),
      store: {
        ...memory(),
        read: async () => ({
          document,
          updateSequenceNumber: 1,
          workdown: "secret corrupt bytes",
        }),
      },
    });
    expect(await commands.get(read, context)).toEqual({
      error: "internal-error",
    });
  });
  it.each(["PRODUCTION", "STAGING", "UNKNOWN"])(
    "disables loopback in %s without generation or storage",
    async (environment) => {
      const commands = createExchangeCommands({
        ...defaults(),
        environment: () => environment,
        generate: async () => {
          throw new Error("must not generate");
        },
        store: {
          read: async () => {
            throw new Error("must not read");
          },
          compareAndSet: async () => {
            throw new Error("must not write");
          },
        },
      });
      expect(await commands.start(params, context)).toEqual({
        error: "connection-unavailable",
      });
      expect(await commands.get(read, context)).toEqual({
        error: "connection-unavailable",
      });
    },
  );
  it.each(["pending", "revoked", "incoming", "unknown"])(
    "rejects non-loopback Connection %s",
    async (connection) => {
      const commands = createExchangeCommands(defaults());
      expect(await commands.start({ ...params, connection }, context)).toEqual({
        error: "connection-unavailable",
      });
      expect(await commands.get({ ...read, connection }, context)).toEqual({
        error: "connection-unavailable",
      });
    },
  );
  it("requires authentication and rechecks Project Admin authority without retaining anything", async () => {
    const commands = createExchangeCommands({
      ...defaults(),
      isProjectAdmin: async () => false,
      generate: async () => {
        throw new Error("must not generate");
      },
    });
    expect(await commands.start(params, context)).toEqual({
      error: "forbidden",
    });
    const anonymous = {
      ...context,
      principal: { accountId: "", authorization: "" },
    };
    expect(await commands.start(params, anonymous)).toEqual({
      error: "forbidden",
    });
    expect(await commands.get(read, anonymous)).toEqual({ error: "forbidden" });
    expect(await commands.get(read, context)).toEqual({
      error: "document-unavailable",
    });
  });
  it("preserves the last successful document after generation fails", async () => {
    let fail = false;
    const commands = createExchangeCommands({
      ...defaults(),
      generate: async () => (fail ? err("issue-ineligible") : ok(workdown)),
    });
    await commands.start(params, context);
    fail = true;
    expect(await commands.start(params, context)).toEqual({
      error: "issue-ineligible",
    });
    expect(await commands.get(read, context)).toMatchObject({
      value: { workdown, updateSequenceNumber: 1 },
    });
  });
  it("keeps installation identities isolated", async () => {
    const commands = createExchangeCommands(defaults());
    await commands.start(params, context);
    expect(
      await commands.get(read, {
        ...context,
        installation: {
          ...context.installation,
          cloudId: "00000000-0000-4000-8000-000000000002",
        },
      }),
    ).toEqual({ error: "document-unavailable" });
  });
  it("reports storage failure, not a missing document or successful delivery", async () => {
    const commands = createExchangeCommands({
      ...defaults(),
      store: {
        ...memory(),
        read: async () => {
          throw new Error("private storage diagnostics");
        },
      },
    });
    expect(await commands.start(params, context)).toEqual({
      error: "storage-unavailable",
    });
    expect(await commands.get(read, context)).toEqual({
      error: "storage-unavailable",
    });
  });
});
