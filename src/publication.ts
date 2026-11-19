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
  report?: (
    outcome:
      | "connection-unavailable"
      | "source-time-unavailable"
      | "not-acknowledged"
      | "acknowledged"
      | "exception",
    details?: {
      sdkSuccess: boolean;
      acceptedCount: number;
      rejectedCount: number;
      matchingAccepted: boolean;
      httpStatus?: number;
      traceId?: string;
    },
  ) => void;
}) {
  return async (
    record: RetainedDocument,
    binding: Binding,
  ): Promise<boolean> => {
    try {
      const connectionId = await deps.connectionId(binding);
      if (!connectionId) {
        deps.report?.("connection-unavailable");
        return false;
      }
      const metadata = parse(
        record.workdown.slice(4, record.workdown.indexOf("\n---\n", 4)),
      ) as {
        title: string;
        resource: string;
        created_at?: string;
        updated_at?: string;
      };
      const timestamp = metadata.updated_at ?? metadata.created_at;
      if (!timestamp) {
        deps.report?.("source-time-unavailable");
        return false;
      }
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
      if (!response || typeof response !== "object") {
        deps.report?.("not-acknowledged");
        return false;
      }
      const result = response as types.BulkObjectResponse;
      const matchingAccepted =
        result.results?.accepted?.some(
          (accepted) =>
            accepted.entityType === "atlassian:document" &&
            accepted.entityId?.["id"] === record.document,
        ) === true;
      const acknowledged =
        result.success === true &&
        !result.results?.rejected?.length &&
        matchingAccepted;
      const status =
        result.originalError &&
        typeof result.originalError === "object" &&
        "status" in result.originalError
          ? result.originalError.status
          : undefined;
      const traceId =
        result.originalError &&
        typeof result.originalError === "object" &&
        "traceId" in result.originalError
          ? result.originalError.traceId
          : undefined;
      deps.report?.(acknowledged ? "acknowledged" : "not-acknowledged", {
        sdkSuccess: result.success === true,
        acceptedCount: result.results?.accepted?.length ?? 0,
        rejectedCount: result.results?.rejected?.length ?? 0,
        matchingAccepted,
        ...(typeof traceId === "string" &&
        traceId.length === 32 &&
        /^[0-9a-f]{32}$/i.test(traceId)
          ? { traceId }
          : {}),
        ...(typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
          ? { httpStatus: status }
          : {}),
      });
      return acknowledged;
    } catch {
      deps.report?.("exception");
      return false;
    }
  };
}
