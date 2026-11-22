import api, { assumeTrustedRoute } from "@forge/api";
import type { Principal } from "./jira";

export function eventPrincipal(accountId: string): Principal {
  if (!accountId.trim()) throw new Error("Missing sharing principal");
  return {
    accountId,
    // Paths originate only in our Jira readers, never directly in event payloads.
    authorization: (path, signal) =>
      api
        .asUser(accountId)
        .requestJira(assumeTrustedRoute(`/rest/api/3/${path}`), {
          headers: { Accept: "application/json" },
          signal,
        }),
  };
}
