import type { CatalogProblemDefinition } from "@forge-ahead/errors";

/**
 * Application errors for the Commands in `openrpc.json`.
 *
 * `forbidden` (-32001) and `invalid-params` (-32602) are built in. Each Command
 * ticket adds only the errors it needs; codes must be unique within
 * -32099..-32002.
 */
export const commandErrors = {
  /** The issue does not satisfy the requested export profile's assumptions. */
  "profile-mismatch": { title: "Profile mismatch", code: -32002 },
  /** A field maps ambiguously or has an incompatible schema. Known absence is omitted. Not retryable. */
  "field-unresolved": { title: "Field unresolved", code: -32003 },
  /** A field or its value could not be read (authorization, request or incomplete response). May be transient. */
  "field-unreadable": { title: "Field unreadable", code: -32004 },
} as const satisfies Record<string, CatalogProblemDefinition>;
