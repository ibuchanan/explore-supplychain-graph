# Explore Supplychain Graph

Status: agreed scope; detailed OpenRPC contracts and follow-on designs pending.

## Problem Statement

Teams collaborating across Jira sites need selected context about an Epic to be discoverable on a peer site without mirroring Jira workflows, exposing all source fields, or granting access to the source site. Destination teams need to respond using their own Automation Flows without the sharing app deciding where local work belongs.

Wonder demonstrated the value of a cross-site Teamwork Graph (TWG) share. Explore is a rewrite to investigate architecture, domain structure, and customer-facing assumptions; Wonder's implementation is not a compatibility requirement.

## Solution

Site Admins mutually authorize a one-way Peer Connection. Source Project Admins initiate ongoing Exchanges for selected Epics over that Connection, without per-Exchange destination approval. Sharing in the reverse direction requires a separate Connection.

The app immediately converts each Subject's curated Jira context into one Workdown document, then keeps it current through source events. Workdown is Markdown with Frontmatter; supported fields and treatment of children are fixed conventions, not administrator configuration.

The destination retains the latest document and ingests it as a TWG Document with unrestricted destination visibility. Once ingestion is acknowledged, a Publication becomes observable through Commands, a destination-local event, and an optional destination-owned Automation incoming webhook. Destination Automation Flows may act on this context; the app itself has no direct means to modify Jira work items and does not route incoming content to local projects or Epics.

Delivery is backend-first: business Commands specified with OpenRPC, implemented with help from `forge-ahead-rpc`, and tested before UI is layered on. Work is sliced vertically around Commands: the user defines each Command in the OpenRPC document before its ticket starts, after the OpenRPC path itself is bootstrapped with only the standard discovery method.

## User Stories

1. As a source Site Admin, I want to invite a destination site to a directional Peer Connection, so that sharing starts with explicit site-level trust.
2. As a destination Site Admin, I want to accept an invitation, so that my site controls whether it receives content from that source.
3. As a Site Admin, I want to inspect pending, active, and revoked Connections, so that I understand their lifecycle.
4. As a Site Admin, I want to establish the reverse direction independently, so that receiving does not silently grant permission to send.
5. As either Site Admin, I want to revoke a Connection without the other side's approval, so that I can end participation.
6. As a source Project Admin, I want to initiate an Exchange for an Epic in my project, so that I control when its context crosses the site boundary.
7. As a source Project Admin, I want to use an already authorized Connection without further destination approval, so that site-level trust need not be repeated for each Epic.
8. As a source Project Admin, I want to understand the fixed content-sharing conventions, so that I know what is disclosed.
9. As a source Project Admin, I want the first document published immediately, so that an unchanged Epic need not wait for an event.
10. As a source Project Admin, I want relevant source changes reflected automatically, so that I need not republish every edit manually.
11. As a source Project Admin, I want sharing failures and last successful progress visible, so that failures are not hidden in logs alone.
12. As a source user, I want unsupported Jira content excluded, so that an Exchange does not become an unrestricted Jira export.
13. As a destination reader, I want shared context discoverable through Search, so that I can find relevant work from a peer site.
14. As a destination reader, I want a local read-only document, so that I do not need access to the original Jira site.
15. As a destination reader, I want provenance linking to the original Epic, so that I can understand where the context originated.
16. As a destination reader, I want the latest available Workdown and its sequence number, so that I know which update I am reading.
17. As a destination Site Admin, I want to configure an optional incoming Automation webhook per incoming Connection, so that my own Flow can respond to Publications.
18. As a destination Site Admin, I want webhook credentials protected and managed locally, so that the source cannot choose my automation destination.
19. As a Flow author, I want document identity and update sequence in notifications, so that I can deduplicate repeated deliveries.
20. As a Flow author, I want to retrieve current Workdown through an authenticated app endpoint, so that my Flow need not depend on Search results.
21. As a Flow author, I want to choose local projects and actions myself, so that the sharing app does not impose destination routing.
22. As an integration consumer, I want Publication receipt/status Commands and a destination-local event, so that the webhook is not the only observable integration surface.
23. As an operator, I want transient delivery failures retried within a bounded policy, so that temporary failures do not immediately lose an update.
24. As an operator, I want permanent and exhausted failures exposed, so that I do not mistake retries for guaranteed delivery.
25. As an operator, I want Connection revocation to withdraw app-managed content, so that ending trust also ends ongoing sharing.
26. As an operator, I want cleanup progress and failures visible, so that withdrawal is observable rather than assumed.
27. As a developer, I want business Commands defined before UI, so that transport and presentation do not define the domain.
28. As a developer, I want most behavior tested outside Forge, so that the feedback loop remains fast.
29. As a developer, I want an automated deployed-Forge JSON-RPC test for every Command, so that local tests do not conceal runtime integration failures.
30. As an Explore participant, I want assumptions about Search latency and unrestricted access identified explicitly, so that user feedback can validate or challenge them.

## Implementation Decisions

### Domain and authorization

- Use the project glossary's vocabulary. A Peer Connection is directional despite requiring mutual Site Admin authorization. A site may participate as both Source and Destination through separate Connections.
- Connection lifecycle: pending invitation, destination acceptance into active state, and revocation by either side. The concrete handshake and authentication protocol require a follow-on design before implementation.
- Site Admins authorize Connections. Source Project Admins decide which Epics to share and when sharing begins. Validate project authority at the business boundary; app-level Jira access must not bypass it.
- No per-Exchange destination approval. No destination project, destination Epic, or destination work-routing configuration is required.
- Jira is the only source product. An Epic is the Subject. Shared context is read-only to recipients.
- No standalone stop-Exchange feature or source-Epic-deletion handling in the initial scope. Wonder's internal deletion helpers are not evidence of a supported stop-Exchange user feature. The resulting stale-content limitation is explicit.

### Workdown and TWG

- One Workdown document represents each Exchange's Subject and its included context. Field support and child representation are hard-coded and belong to the separate Workdown specification, not runtime configuration.
- Account for semantic Jira Epic fields that Jira exposes as custom fields. Do not assume those fields have identical custom-field IDs across sites.
- Start with the TWG `atlassian:document` object type; do not project children as separate work-item objects.
- Retain latest-only Workdown at the destination. Expose authenticated reads returning the actual sequence number. Historical revisions are not retrievable by contract.
- Later UI supplies a destination-local read-only view suitable as the Search result URL. Preserve the source Epic URL as provenance, not as the only reading path.
- Use `replicatesPermissions: false`, with unrestricted destination visibility. This is intentional disclosure, not replication of Jira source permissions; see the visibility ADR.

### Refresh, identity, and Publication

- Initiating an Exchange triggers immediate initial generation and delivery. Subsequent freshness is event-driven only. No polling or periodic reconciliation initially.
- Relevant source events invoke the same application behavior as Command-driven initial publication. Detailed event coverage depends on the Workdown content model and must be specified before implementation.
- Keep a stable TWG document `id` and assign a monotonically increasing `updateSequenceNumber` per document when changed Workdown is produced. Unchanged content does not create a Publication.
- Retries preserve identity, sequence, and content. Interpret identity within its Peer Connection/connector context. Exact ID encoding and allocation/concurrency mechanics remain follow-on contract details.
- Publication has no separate ID or revision system: the document identity and sequence identify the event.
- Destination storage uses the same sequence ordering to prevent stale replacement. TWG index ordering alone does not protect app storage or deduplicate external actions.
- Publication occurs after destination acceptance and acknowledged TWG ingestion of that update, not merely an HTTP-level successful request that contains a rejected object.
- For Explore, assume acknowledged ingestion makes the content immediately discoverable through Search. This is a hypothesis to test with customer/user feedback, not a verified platform guarantee.

### Notifications and Automation Flows

- Expose Publication receipt/status through Commands, a destination-local event, and an optional Automation incoming webhook. A Forge app event must not be presented as a native selectable Automation Flows trigger without verification.
- Destination Site Admins manage one optional webhook URL and authentication secret per incoming Peer Connection. Source sites cannot select the destination webhook.
- Event metadata identifies the connection context, document, and sequence, and enables authenticated retrieval of the latest Workdown. Exact schemas and endpoint authentication remain contract work.
- A Flow triggered by sequence 12 may retrieve sequence 13. This is valid; reads disclose the actual sequence and do not promise event-time content.
- Flow authors own routing, deduplication, and Jira actions. Repeated webhook delivery may repeat a Flow; the app does not guarantee exactly-once execution or Jira side effects.
- Native Flow-builder trigger support is a later platform investigation. Multiple subscribers and per-Exchange webhook routing are not initial features.

### Reliability and withdrawal

- For transient peer-delivery, TWG-ingestion, and Automation-notification failures: initial attempt plus three retries, nominally after 5, 15, and 45 seconds with jitter. Respect platform scheduling constraints and rate-limit guidance.
- Retry stages independently. A notification failure must not require regenerating or republishing the document.
- Permanent authorization/validation failures stop immediately. Expose exhausted or permanent failures through status Commands. No operator replay console initially.
- Revocation prevents further sharing and initiates withdrawal from app-managed destination storage and TWG. Surface cleanup progress and failures. A later protocol design must address unreachable peers and races with in-flight deliveries; do not imply immediate guaranteed remote erasure.
- TWG supports object deletion through `deleteObjectsByExternalId`; exact connection/object mapping and cleanup mechanics remain implementation design work.
- Withdrawal cannot recall exported copies or undo Automation actions. Search removal is not promised to be instantaneous.

### Command-first architecture and security

- Specify business-level Commands with OpenRPC, using `forge-ahead-rpc` and the backbone example as architectural guidance, not inherited domain implementation.
- Command includes read-only operations. Exact method names, parameter/result schemas, and error contracts are not approved by this scope document.
- Responsibility groups include Connection invitation/acceptance/inspection/revocation, Exchange initiation/inspection, current-document retrieval, Publication/delivery status, and destination webhook configuration. Grouping is not a ticket inventory.
- Keep business behavior independent of JSON-RPC transport, Forge runtime adapters, and eventual UI. Jira events reuse application behavior rather than implementing a second publication pipeline.
- Security outcomes: authenticate peer installations and direction, authorize callers, detect tampering, protect secrets, and reject traffic on revoked Connections. Protocol choice, replay defenses, invitation expiry, and credential lifecycle need a focused design before the affected Commands are built.

### Delivery sequence

1. Review the overall scope and separate Workdown outline.
2. Resolve Workdown semantics and Connection/security design needed for implementation; document meaningful trade-offs where appropriate. Unknown platform behavior (issue security, Jira events, TWG ingestion) is characterized on a deployed site during the first implementation ticket that touches it, with evidence captured via `forge logs`; it does not gate ticket creation.
3. Bootstrap the OpenRPC document with only the standard discovery method, proving the local and deployed-Forge JSON-RPC path.
4. Create local tickets as vertical slices, each centered on one Command (or a closely related few). Before a Command-centric ticket starts, the user defines the Command in the OpenRPC document and approves it; each slice then owns its contract, built test-first with local and deployed-Forge automated coverage. A full method inventory is not a prerequisite for starting slices.
5. Layer UI on the tested contracts, including the local document reading experience.

## Testing Decisions

- Test external behavior: results, authorization, observable state, published content, and outgoing integration effects. Do not couple tests to private helpers or incidental call ordering.
- The primary seam is the business Command boundary, exercised with controlled caller/install context and Jira, storage, peer, TWG, and notification dependencies. Most coverage runs outside Forge.
- Local integration tests exercise OpenRPC-backed JSON-RPC validation, dispatch, context propagation, serialization, and error mapping against those same Commands.
- Every JSON-RPC method must also have at least one automated test invoking it through JSON-RPC in the deployed Forge runtime. A local dispatcher test does not satisfy this requirement. Stateful setup and cleanup must be designed without adding unsupported user features solely for tests.
- Cover directional Connection authorization, source project authority, rejection after revocation, initial publication, changed versus unchanged content, monotonically ordered updates, stale/duplicate delivery, latest-only reads, retry exhaustion, independent notification retries, protected webhook configuration, and connection-level withdrawal.
- Workdown has focused fixture-based Jira-to-document tests against its separate specification, including semantic custom fields and the chosen child representation.
- Deployed cross-site scenarios verify actual peer delivery, TWG acceptance/deletion, authenticated local reads, and Automation webhook invocation. Verify runtime behavior beyond the per-method minimum where workflows cross platform boundaries.
- Search discoverability timing and unrestricted visibility need deployed observation and customer/user feedback. They cannot be proven by mocked ingestion success.
- Prior art: the RPC backbone's OpenRPC/dispatcher/handler tests guide contract and runtime seams; Wonder's pairing, projection, and delivery tests supply scenarios, not code or implementation obligations.

## Out of Scope

- Reusing or preserving Wonder's implementation, wire protocol, or UI.
- Non-Jira source products.
- Direct Jira work-item mutation by this app, workflow mirroring, or destination routing.
- Per-Exchange destination approval or automatic reverse-direction trust.
- Configurable field profiles, child-selection UI, and manual editing of generated Workdown.
- Polling, periodic reconciliation, and completeness guarantees after missed source events.
- Standalone stop-Exchange operations and source-Epic-deletion handling initially.
- Historical document archives, separate Publication IDs, and exactly-once Flow execution.
- Native selectable Automation trigger, multiple webhook subscribers, or per-Exchange webhook routing initially.
- Operator replay console and guaranteed recall of already disclosed content.
- Method tickets, final OpenRPC schemas, final Workdown field definitions, and concrete connection protocol in this drafting pass.

## Further Notes

### Explicit Explore assumptions and limitations

- Search is assumed immediately current after ingestion acknowledgment; gather feedback before treating this as a lasting guarantee.
- Unrestricted destination access is intentional and subject to feedback. Source permission changes do not translate into destination ACL changes.
- Event-only refresh can leave stale content after missed events. Bounded retries are not reconciliation.
- Source deletion and individual Exchange withdrawal are excluded, so content may persist until Connection-level withdrawal.
- Destination latest-only reads may be newer than the triggering Publication.

### Related documents and references

- [Domain glossary](../GLOSSARY.md)
- [Workdown scope and open decisions](workdown.md)
- [Unrestricted visibility ADR](adr/0001-unrestricted-destination-visibility.md)
- [Forge TWG connector module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/teamwork-graph-connector/)
- [TWG setObjects](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-operations/set-objects/)
- [TWG deletion by external ID](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-operations/delete-objects-by-external-id/)
- [Forge Automation integration](https://developer.atlassian.com/platform/forge/building-automations/)

Specifications and ADRs live under `specs/`. Future method-sized tickets live under `.scratch/`; do not publish them to an external issue tracker as part of this workflow.
