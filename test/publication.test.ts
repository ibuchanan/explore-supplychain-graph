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
