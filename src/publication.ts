import type { types } from "@forge/teamwork-graph";
import { parse } from "yaml";
import type {
  Binding,
  PublicationNotification,
  RetainedDocument,
} from "./exchange";
import { validatePublicationNotification } from "./generated/validators.js";
export function createPublicationDispatcher(
  handlers: Array<(notification: PublicationNotification) => Promise<void>>,
) {
  return async (notification: unknown): Promise<void> => {
    if (!validatePublicationNotification(notification))
      throw new Error("Invalid Publication notification");
    for (const handler of handlers)
      await handler(notification as PublicationNotification);
  };
}

export function createGraphPublisher(deps: {
  connectionId: (binding: Binding) => Promise<string | undefined>;
  setObjects: (request: types.SetObjectsRequest) => Promise<unknown>;
}) {
  return async (
    record: RetainedDocument,
    binding: Binding,
  ): Promise<boolean> => {
    const connectionId = await deps.connectionId(binding);
    if (!connectionId) return false;
    const metadata = parse(
      record.workdown.slice(4, record.workdown.indexOf("\n---\n", 4)),
    ) as {
      title: string;
      resource: string;
      created_at?: string;
      updated_at?: string;
    };
    const timestamp = metadata.updated_at ?? metadata.created_at;
    if (!timestamp) return false;
    // Plain text preserves the canonical Markdown and Frontmatter without
    // claiming Markdown rendering or structured Frontmatter indexing.
    const response = await deps.setObjects({
      connectionId,
      objects: [
        {
          schemaVersion: "1.0",
          id: record.document,
          updateSequenceNumber: record.updateSequenceNumber,
          displayName: metadata.title,
          url: metadata.resource,
          createdAt: metadata.created_at ?? timestamp,
          lastUpdatedAt: timestamp,
          permissions: [
            {
              accessControls: [
                { principals: [{ type: "ATLASSIAN_WORKSPACE" }] },
              ],
            },
          ],
          "atlassian:document": {
            type: { category: "DOCUMENT" },
            content: { mimeType: "text/plain", text: record.workdown },
          },
        },
      ],
    });
    if (!response || typeof response !== "object") return false;
    const result = response as types.BulkObjectResponse;
    return (
      result.success === true &&
      !result.results?.rejected?.length &&
      result.results?.accepted?.some(
        (accepted) =>
          accepted.entityType === "atlassian:document" &&
          accepted.entityId?.["id"] === record.document,
      ) === true
    );
  };
}
