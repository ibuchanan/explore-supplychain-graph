import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createGraphPublisher,
  createPublicationDispatcher,
} from "../src/publication";

const workdown = readFileSync(
  new URL(
    "./fixtures/workdown-export/epic-empty-description.workdown",
    import.meta.url,
  ),
  "utf8",
);
const record = {
  document: "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10042",
  updateSequenceNumber: 7,
  workdown,
};
const binding = {
  cloudId: "00000000-0000-4000-8000-000000000001",
  connection: "development-loopback",
};
it("reports bounded ingestion outcomes without content, identities or raw SDK errors", async () => {
  const outcomes: unknown[] = [];
  const deps = {
    connectionId: async () => undefined as string | undefined,
    setObjects: async () => ({
      success: false,
      error: "private-sdk-diagnostic",
    }),
    report: (outcome: string) => {
      outcomes.push(outcome);
    },
  };
  expect(await createGraphPublisher(deps)(record, binding)).toBe(false);
  expect(outcomes).toEqual(["connection-unavailable"]);
  deps.connectionId = async () => "private-connection";
  expect(await createGraphPublisher(deps)(record, binding)).toBe(false);
  expect(outcomes).toEqual(["connection-unavailable", "not-acknowledged"]);
  deps.setObjects = async () => {
    throw new Error("private-sdk-diagnostic");
  };
  expect(await createGraphPublisher(deps)(record, binding)).toBe(false);
  expect(outcomes).toEqual([
    "connection-unavailable",
    "not-acknowledged",
    "exception",
  ]);
  expect(JSON.stringify(outcomes)).not.toContain("private");
});
it("reports only bounded response counts and HTTP status for an unacknowledged SDK result", async () => {
  const reports: unknown[] = [];
  const ingest = createGraphPublisher({
    connectionId: async () => "private-connection",
    setObjects: async () => ({
      success: false,
      error: "private-error",
      originalError: { status: 403, responseBody: "private-body" },
    }),
    report: (...args) => {
      reports.push(args);
    },
  });
  expect(await ingest(record, binding)).toBe(false);
  expect(reports).toEqual([
    [
      "not-acknowledged",
      {
        sdkSuccess: false,
        acceptedCount: 0,
        rejectedCount: 0,
        matchingAccepted: false,
        httpStatus: 403,
      },
    ],
  ]);
});
it("reports a validated service trace ID but excludes malformed IDs and raw errors", async () => {
  const reports: unknown[][] = [];
  let traceId: unknown = "0123456789abcdef0123456789abcdef";
  const ingest = createGraphPublisher({
    connectionId: async () => "private-connection",
    setObjects: async () => ({
      success: false,
      error: "private-error",
      originalError: { status: 401, traceId, responseBody: "private-body" },
    }),
    report: (...args) => {
      reports.push(args);
    },
  });
  expect(await ingest(record, binding)).toBe(false);
  expect(reports[0]).toEqual([
    "not-acknowledged",
    {
      sdkSuccess: false,
      acceptedCount: 0,
      rejectedCount: 0,
      matchingAccepted: false,
      httpStatus: 401,
      traceId: "0123456789abcdef0123456789abcdef",
    },
  ]);
  for (const invalid of [
    undefined,
    null,
    123,
    {},
    "",
    "private-body",
    "a".repeat(129),
    "0123456789abcdef0123456789abcdef\n",
  ]) {
    traceId = invalid;
    expect(await ingest(record, binding)).toBe(false);
    expect(reports.at(-1)?.[1]).not.toHaveProperty("traceId");
  }
  expect(JSON.stringify(reports)).not.toContain("private");
});
it("dispatches only valid identity-only JSON-RPC notifications to local handlers and propagates delivery failure", async () => {
  const seen: unknown[] = [];
  const dispatch = createPublicationDispatcher([
    async (event) => {
      seen.push(event);
    },
  ]);
  const notification = {
    jsonrpc: "2.0",
    method: "publication.published",
    params: {
      connection: binding.connection,
      loopback: true,
      document: record.document,
      updateSequenceNumber: 7,
    },
  };
  await dispatch(notification);
  expect(seen).toEqual([notification]);
  await expect(dispatch({ ...notification, id: 1 })).rejects.toThrow();
  await expect(
    dispatch({ ...notification, params: { ...notification.params, workdown } }),
  ).rejects.toThrow();
  await expect(
    createPublicationDispatcher([
      async () => {
        throw new Error("consumer unavailable");
      },
    ])(notification),
  ).rejects.toThrow("consumer unavailable");
});
it("ingests exact Workdown bytes as a workspace-visible document and rejects partial or absent acknowledgments", async () => {
  const requests: unknown[] = [];
  let response: unknown = {
    success: true,
    results: {
      accepted: [
        { entityType: "atlassian:document", entityId: { id: record.document } },
      ],
    },
  };
  const ingest = createGraphPublisher({
    connectionId: async () => "platform-connection",
    setObjects: async (request) => {
      requests.push(request);
      return response;
    },
  });
  expect(await ingest(record, binding)).toBe(true);
  expect(requests[0]).toMatchObject({
    connectionId: "platform-connection",
    objects: [
      {
        id: record.document,
        updateSequenceNumber: 7,
        permissions: [
          {
            accessControls: [{ principals: [{ type: "ATLASSIAN_WORKSPACE" }] }],
          },
        ],
        "atlassian:document": {
          type: { category: "DOCUMENT" },
          content: { mimeType: "text/plain", text: workdown },
        },
      },
    ],
  });
  for (const invalid of [
    undefined,
    { success: true },
    { success: false },
    { success: true, results: { accepted: [] } },
    {
      success: true,
      results: {
        accepted: [
          { entityType: "atlassian:document", entityId: { id: "other" } },
        ],
      },
    },
    {
      success: true,
      results: {
        accepted: [
          {
            entityType: "atlassian:document",
            entityId: { id: record.document },
          },
        ],
        rejected: [{}],
      },
    },
  ]) {
    response = invalid;
    expect(await ingest(record, binding)).toBe(false);
  }
});
