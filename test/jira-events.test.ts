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
const registration = {
  cloudId,
  document,
  connection: "development-loopback",
  accountId: "sharing-admin",
};
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
  connection: registration.connection,
};

describe("Jira product event intake", () => {
  it("ignores malformed, foreign-installation, and non-update events", async () => {
    let calls = 0;
    const handler = createJiraEventHandler({
      registrations: async () => [
        { ...registration, cloudId: "foreign" },
        registration,
      ],
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
      { eventType: "avi:jira:created:issue", issue: { id: "10042" } },
      { eventType: "avi:jira:deleted:issue", issue: { id: "10042" } },
    ]) {
      expect(await handler(event, cloudId)).toEqual({
        attempted: 0,
        failed: 0,
      });
    }
    await handler(
      { eventType: "avi:jira:updated:issue", issue: { id: "10042" } },
      "other-installation",
    );
    expect(calls).toBe(0);
  });
  it("fails closed on denied user reads while continuing independent Exchanges", async () => {
    const handler = createJiraEventHandler({
      registrations: async () =>
        ["denied", "permitted"].map((accountId) => ({
          ...registration,
          accountId,
        })),
      republish: async (current) => {
        if (current.accountId === "denied")
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
  ])("ignores child changes and reparenting via %s", async (eventType) => {
    const selected: string[] = [];
    const handler = createJiraEventHandler({
      registrations: async () => [
        registration,
        { ...registration, document: document.replace("10042", "10043") },
      ],
      republish: async (current) => {
        selected.push(current.document);
        return {};
      },
    });
    expect(
      await handler(
        {
          eventType,
          issue: { id: "10044", fields: { parent: { id: "10043" } } },
          changelog: {
            items: [
              { field: "IssueParentAssociation", from: "10042", to: "10043" },
            ],
          },
        },
        cloudId,
      ),
    ).toEqual({ attempted: 0, failed: 0 });
    expect(selected).toEqual([]);
  });
  it("ignores child-only changes but refreshes their snapshot on the next Subject update without duplicate Publications", async () => {
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
      registrations: async () => [registration],
      republish: async (current) =>
        commands.start(
          { ...params, issue: "10042" },
          {
            ...context,
            principal: {
              accountId: current.accountId,
              authorization: "offline-user",
            },
          },
        ),
    });
    bytes = `${workdown}\nChanged child snapshot\n`;
    expect(
      await handler(
        { eventType: "avi:jira:updated:issue", issue: { id: "10044" } },
        cloudId,
      ),
    ).toEqual({ attempted: 0, failed: 0 });
    expect(publications).toBe(1);
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
