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
} as const satisfies Record<string, CatalogProblemDefinition>;
