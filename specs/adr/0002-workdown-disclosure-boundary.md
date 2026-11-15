# ADR 0002: Workdown disclosure boundary for the Explore Jira Epic profile

## Context

Explore shares curated Jira Epic context across sites. [ADR 0001](0001-unrestricted-destination-visibility.md) makes shared content unrestricted at the destination, so the Workdown content rules are the only control over what leaves the source site. The [Workdown specification](../workdown-spec.md) defines a generic work-item format and a separate Explore Jira Epic profile.

## Decision

Approve the Explore Jira Epic profile in the Workdown specification as the disclosure boundary, including:

- an explicit allowlist of fields; everything not listed is excluded, with no passthrough and no wildcard extension;
- direct children only, completed children included, no recursion, issue links, or legacy Epic Link fallback;
- no `parent` for an Epic;
- exclusion of items with issue-level security, and failure rather than partial sharing when eligibility is uncertain;
- failure of the whole candidate on any incomplete read, retaining the last successful document;
- the Atlassian Resource Identifier of the issue as `source_id`.

The field allowlist is not PII or secret redaction. Text inside an allowed description is disclosed as written.

## Alternatives Considered

- Configurable per-project field profiles: more flexible, but moves the disclosure decision to each administrator and out of reviewed code; excluded by the agreed scope.
- Share comments, links, or people fields: richer context, but a larger disclosure surface with no cross-site permission mapping.
- Redact descriptions for PII or secrets: a heavy, unreliable guarantee for an exploration; the boundary is instead stated plainly.

## Consequences

- Source Project Admins must understand that the description is shared verbatim.
- Changing the allowlist, child rule, or eligibility rule requires a new review and an update to this ADR.
- Source permission changes and missed events can leave stale content at the destination; withdrawal and freshness limits remain as in the overall specification.
- Approval does not satisfy the event and ingestion implementation gates or fix the byte and child-count limits.

## Related

- [Workdown specification](../workdown-spec.md)
- [Workdown scope](../workdown.md)
- [ADR 0001](0001-unrestricted-destination-visibility.md)
- [Overall specification](../supplychain-graph.md)
