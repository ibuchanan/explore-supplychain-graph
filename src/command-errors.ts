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
  /** The caller can read the issue, but the profile forbids sharing it (for example issue-level security). Not retryable. */
  "issue-ineligible": { title: "Issue ineligible", code: -32005 },
  /** Eligibility could not be determined. Treated as failure, never permission. May be transient. */
  "eligibility-undetermined": {
    title: "Eligibility undetermined",
    code: -32006,
  },
  /** The direct-child listing was interrupted or incomplete. Never yields a smaller snapshot. May be transient. */
  "children-unreadable": { title: "Children unreadable", code: -32007 },
  "document-too-large": { title: "Document too large", code: -32008 },
  "too-many-children": { title: "Too many children", code: -32009 },
  "connection-unavailable": { title: "Connection unavailable", code: -32010 },
  "delivery-unconfirmed": { title: "Delivery unconfirmed", code: -32011 },
  "storage-unavailable": { title: "Storage unavailable", code: -32012 },
  "document-unavailable": { title: "Document unavailable", code: -32013 },
} as const satisfies Record<string, CatalogProblemDefinition>;
