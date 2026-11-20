import { readFileSync } from "node:fs";
import { ok } from "@forge-ahead/errors";
import { describe, expect, it } from "vitest";
import {
  createExchangeCommands,
  type ExchangeStore,
  type RetainedDocument,
} from "../src/exchange";
import { createJiraEventHandler } from "../src/jira-events";

const workdown = readFileSync(
  new URL(
    "./fixtures/workdown-export/epic-empty-description.workdown",
    import.meta.url,
  ),
  "utf8",
);
const cloudId = "00000000-0000-4000-8000-000000000001";
const document = `ari:cloud:jira:${cloudId}:issue/10042`;
const context = {
  installation: {
    cloudId,
    apiBase: `https://api.atlassian.com/ex/jira/${cloudId}`,
  },
  principal: {
    accountId: "sharing-admin",
    authorization: "Basic request-only",
  },
};
const params = {
  issue: "DEMO-42",
  profile: "jira-epic" as const,
  connection: "development-loopback",
};

describe("Jira product event intake", () => {
  it("ignores malformed, foreign-installation, and unsupported source-deletion events", async () => {
    let calls = 0;
    const handler = createJiraEventHandler({
      registrations: async () => [
        {
          cloudId: "foreign",
          document,
          connection: params.connection,
          accountId: "other",
        },
        {
          cloudId,
          document,
          connection: params.connection,
          accountId: "sharing-admin",
        },
      ],
      retained: async () => workdown,
      parent: async () => undefined,
      republish: async () => {
        calls++;
        return {};
      },
    });
    for (const event of [
      null,
      {},
      { eventType: "avi:jira:updated:issue", issue: { id: 10042 } },
      { eventType: "publication.published", issue: { id: "10042" } },
      { eventType: "avi:jira:deleted:issue", issue: { id: "10042" } },
    ]) {
      expect(await handler(event, cloudId)).toEqual({
        attempted: 0,
        failed: 0,
      });
    }
    expect(calls).toBe(0);
  });
  it("fails closed on denied user reads while continuing independent Exchanges", async () => {
    const handler = createJiraEventHandler({
      registrations: async () =>
        ["denied", "permitted"].map((accountId) => ({
          cloudId,
          document,
          accountId,
          connection: params.connection,
        })),
      retained: async () => workdown,
      parent: async () => undefined,
      republish: async (registration) => {
        if (registration.accountId === "denied")
          throw new Error("private permission details");
        return {};
      },
    });
    expect(
      await handler(
        {
          eventType: "avi:jira:updated:issue",
          issue: { id: "10042" },
          atlassianId: "not-the-sharing-principal",
        },
        cloudId,
      ),
    ).toEqual({ attempted: 2, failed: 1 });
  });
  it.each([
    "avi:jira:created:issue",
    "avi:jira:updated:issue",
    "avi:jira:deleted:issue",
  ])(
    "locates prior and current Epics for a child via %s",
    async (eventType) => {
      const other = document.replace("10042", "10043");
      const registrations = [document, other].map((document) => ({
        cloudId,
        connection: params.connection,
        document,
        accountId: "sharing-admin",
      }));
      const selected: string[] = [];
      const handler = createJiraEventHandler({
        registrations: async () => registrations,
        retained: async (registration) =>
          registration.document === document
            ? workdown.replace(
                "---\n\n#",
                `sources_extra: []\nchildren:\n  - source_id: "ari:cloud:jira:${cloudId}:issue/10044"\n---\n\n#`,
              )
            : workdown,
        parent: async () =>
          eventType === "avi:jira:deleted:issue" ? undefined : "10043",
        republish: async (registration) => {
          selected.push(registration.document);
          return {};
        },
      });
      await handler({ eventType, issue: { id: "10044" } }, cloudId);
      expect(selected).toEqual(
        eventType === "avi:jira:deleted:issue" ? [document] : [document, other],
      );
    },
  );
  it("republishes changed bytes through the initial Exchange pipeline, not duplicates", async () => {
    const records = new Map<string, RetainedDocument>();
    const store: ExchangeStore = {
      read: async (key) => records.get(key),
      compareAndSet: async (key, previous, value) => {
        if ((records.get(key)?.updateSequenceNumber ?? 0) !== previous)
          return false;
        records.set(key, structuredClone(value));
        return true;
      },
    };
    let bytes = workdown;
    let publications = 0;
    const commands = createExchangeCommands({
      store,
      environment: () => "DEVELOPMENT",
      generate: async () => ok(bytes),
      isProjectAdmin: async () => true,
      ingest: async () => {
        publications++;
        return true;
      },
      notify: async () => {},
    });
    await commands.start(params, context);
    const handler = createJiraEventHandler({
      registrations: async () => [
        {
          cloudId,
          connection: params.connection,
          document,
          accountId: "sharing-admin",
        },
      ],
      retained: async () => workdown,
      parent: async () => undefined,
      republish: async (registration) =>
        commands.start(
          { ...params, issue: "10042" },
          {
            ...context,
            principal: {
              accountId: registration.accountId,
              authorization: "offline-user",
            },
          },
        ),
    });
    bytes = workdown.replaceAll(
      "Publish partner availability",
      "Updated availability",
    );
    expect(
      await handler(
        { eventType: "avi:jira:updated:issue", issue: { id: "10042" } },
        cloudId,
      ),
    ).toEqual({ attempted: 1, failed: 0 });
    await handler(
      { eventType: "avi:jira:updated:issue", issue: { id: "10042" } },
      cloudId,
    );
    expect(
      await commands.status(
        { connection: params.connection, document },
        context,
      ),
    ).toMatchObject({ value: { retainedSequence: 2, publishedSequence: 2 } });
    expect(publications).toBe(2);
  });
});
