# ADR 0001: Unrestricted visibility for shared content at the destination

Status: Accepted for Explore; assumption subject to customer/user feedback.

## Context

The app shares curated Jira Epic context across sites through a TWG connector. Readers on the destination may not have access to the source Jira site. Source users, groups, and project permissions do not automatically map to destination identities.

Explore is testing the value and architecture of ongoing searchable context, not building a cross-site permission-mapping system. Source Project Admins choose when an Epic crosses an already authorized one-way Peer Connection. Destination work routing is outside the app.

Visibility is consequential: changing it after disclosure cannot recall documents already read, exported, or used by Automation.

## Decision

Use `replicatesPermissions: false` in the TWG connector and make incoming shared documents unrestricted within the destination site's access boundary.

Do not replicate source Jira permissions, map cross-site users/groups, or require a destination project/ Epic for access scoping. The destination-local reading surface must respect the intended destination-site boundary; unrestricted does not mean unauthenticated public internet access.

Describe the audience clearly when enabling sharing. Treat unrestricted access as an explicit Explore assumption to validate with customer/user feedback, not a permanent production policy.

## Alternatives Considered

- Replicate source permissions: requires meaningful cross-site principal mapping and a permission-update lifecycle, materially expanding the exploration.
- Restrict documents to a configured destination project/group: introduces audience configuration and destination routing assumptions not needed for this phase.
- Do not index content until an audience model exists: avoids disclosure risk but prevents testing the chosen searchable-sharing experience.

## Consequences

- Destination users can discover shared context without source-site access or per-Exchange audience setup.
- Curated Workdown rules become an important disclosure boundary, but do not make sensitive supported fields safe automatically.
- Source permission restrictions are not preserved at the destination. Site-level trust and source Project Admin selection must not be represented as equivalent to source ACL enforcement.
- Ending a Connection initiates app-managed withdrawal but cannot recall exported copies or undo Automation effects.
- A later restricted-audience design requires an explicit reconsideration, including treatment of previously disclosed content.

## Related

- [Overall specification](../spec.md)
- [Workdown scope](../workdown.md)
- [Domain glossary](../../GLOSSARY.md)
