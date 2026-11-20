# Publication implementation and verification

<!-- cspell:words openrpc reingesting workdown Workdown Frontmatter -->
<!-- cspell:words readback devb stargate webtrigger Rovo -->

## Native retry implementation — 2026-11-20

The local implementation now adds safe stage progress and Forge-native retries;
see [the current retry specification](workdown-retries.md). This supersedes the
historical statements below that no failure enum exists and automatic scheduling
is unimplemented. Unchanged starts no longer bypass retry backoff, and an empty
notification dispatcher reports disabled. Existing cloud evidence below predates
these changes and does not verify the new consumer or status fields.

## Current evidence

As of 2026-11-19, deployed Publication acknowledgment and manual Rovo Search
discovery pass on the development installation. See
[the latest results](#publication-and-rovo-search-verified--2026-11-19) and the
[manual Search guide](../docs/how-to/search-workdown.md). Earlier diagnostic
sections below are historical, not current blockers.

## Decisions confirmed 2026-11-19

The user clarified that `publication.published` is a JSON-RPC 2.0 notification,
not a Forge App Event, and selected internal destination-local dispatch.
The notification is declared under the OpenRPC `x-notifications` extension,
renamed from `x-events` at the user's request to avoid confusion with Forge events.
It has `jsonrpc`, `method`, and identity-only `params`, without an `id`.
No Forge `event` or `trigger` module is involved. External HTTP delivery and
Automation integration remain later work.

The approved `publication.status` contract is active in `src/openrpc.json`, with
latest retained and latest acknowledged sequences read from one consistent
snapshot. No history, publication timestamp, failure enum, or separate ID is
introduced. Generated standalone validators cover nullable status and the
notification envelope; there is no runtime schema compilation.

## Implemented boundaries

- Existing authenticated Project Admin start and trusted development-only
  loopback receipt remain the entry path. Status uses the same destination
  authentication and installation boundary as `document.get`, not source access.
- Destination retention is independent of TWG success. One conditional metadata
  update records acknowledged ingestion only while that retained sequence and
  previous publication metadata still match. Concurrent or late acknowledgments
  cannot regress status or publish an update superseded before the write.
- Stable document ID and sequence are passed to `graph.setObjects`. Success
  requires a matching accepted object and no rejected objects; HTTP success,
  empty results, and mismatched accepted identity are insufficient.
- Notification dispatch follows durable acknowledgment. Pending delivery is
  retained across content replacement and retried on repeat start, without
  reingesting an already-published sequence. Delivery can repeat after an
  uncertain completion; consumers deduplicate by Connection/document/sequence.
  Automatic retry scheduling remains unimplemented follow-on work. To keep pending state bounded,
  a pending older notification is dispatched before acknowledging another
  Publication; newer bytes can still be retained while that consumer fails.
- The internal dispatcher validates and invokes application handlers. Its
  production composition currently has **no consumers**. It is not an external
  subscription service, durable event archive, or claim that a Flow ran.
- The `workdown-documents` connector uses `replicatesPermissions: false`,
  workspace ACLs, and `upsert` fidelity. Automatic deletion propagation is not
  implemented; disconnecting the platform connector removes its indexed data.
  Source deletion and peer revocation withdrawal remain later work.
- The trusted connector lifecycle stores a platform-issued connection ID scoped
  to the local cloud ID and development loopback. This platform connection is
  distinct from a Peer Connection. A second active binding is rejected. No
  caller-supplied endpoint or connection ID is used for graph ingestion.

## Representation and permission review

`text/plain` is the documented document-content example and is the implemented
candidate representation. The entire canonical Workdown, including Frontmatter,
is supplied as text, not transformed into YAML-derived graph properties.
SDK request equality proves submitted bytes only, **not** service acceptance,
readback preservation, Search indexing, Markdown rendering, or HTML/link safety.
The source URL is the provisional graph URL. The later destination-local viewer
is absent; readers must use authenticated `document.get` without source access.
This URL/viewer gap must be resolved before claiming the complete experience.

Manifest additions: `graph:connector`, its lifecycle function, a conditional
publication storage attribute, and `write:object:jira`. No new backend egress,
read-object, delete-object, or Forge App Events permission is requested.
A plain `forge lint` found no errors or warnings but requires major-version
approval for the scope change. The existing `npm run check` lint script includes
`--approve MAJOR_VERSION_RULE`; that validation flag is not deployment or
installation authorization. No deploy, upgrade, install, connector activation,
or live ingestion was performed.

## Local evidence

Vertical red/green cycles covered contract activation, unpublished status,
acknowledged ingestion and notification, durable metadata, corrupt metadata
rejection, and preserving a failed notification across newer receipts. Additional
checks cover concurrent/superseded acknowledgments, rejection, independent retry,
notification validation, authenticated status dispatch, and connector binding.
Existing-site deployed status assertions were added but not run.

The required full check includes tests, typecheck/build, contract freshness,
format/static checks, Forge lint and bundle size. Its final result is recorded
in the local work record: **223 tests / 10 files pass**, full check passes, and
bundle size is **23.77 kB / 32 kB**. Runtime dependency audit reports six
moderate and no high/critical advisories; no unrelated dependency upgrades
were attempted.

## Development-site follow-up — 2026-11-19

The user deployed development version 5.0.0, upgraded the installation on
`one-atlas-devb.atlassian.net` with `write:object:jira`, and reported connector
activation. The deployed discovery suite passed four tests with two deferred
security-fixture checks skipped. That suite permits an unpublished retained
sequence and does not prove ingestion acknowledgment.

The separate `npm run test:deployed:publication` check then failed with
`retainedSequence: 1` and `publishedSequence: null`. This establishes that the
current retained update was not recorded as published, not which ingestion or
storage boundary failed. Existing Forge logs showed successful RPC completion
but no ingestion diagnostics; the cloud cause remains unresolved.

A follow-up diagnostic patch reports fixed stage/outcome labels for connector
lifecycle, runtime binding admission, graph acknowledgment, publication storage,
and notification delivery. No document content, connection/document identity,
credentials, SDK response bodies, or raw exception messages are logged.
Authorization checks and acknowledgment requirements remain unchanged. Local
regressions include sanitized SDK exceptions and acknowledgment-storage failure
without loss of retained content. `npm run check` passes **225 tests / 10 files**;
bundle size is **24.3 kB / 32 kB**. Existing static advisories remain.

These diagnostics have not been deployed or exercised on the platform. After
user-controlled deployment, rerun `npm run test:deployed:publication` and inspect
bounded Forge logs before changing any admission or acknowledgment logic. This
patch is not evidence that the cloud failure is fixed. No additional live
mutation, connector reactivation, or ingestion retry was performed by the agent.

### Development 5.1.0 diagnostic result

The user deployed 5.1.0 and reran the strict test at 17:11:45 local time;
retained sequence 1 still had a null published sequence. Forge logs for that
invocation at `2026-11-19T22:11:53Z` show `graph-binding: bound` followed by
`graph-ingestion: not-acknowledged`, then successful RPC completion. Thus the
binding lookup succeeded and the SDK call returned a result that failed the
acknowledgment predicate; no acknowledgment-storage write was attempted.
This does not distinguish SDK failure, rejected objects, or absent/mismatched
acceptance. The installed SDK returns API failures as `success: false` with an
`originalError` rather than necessarily throwing.

A second local diagnostic slice adds only SDK success, accepted/rejected counts,
matching-identity boolean, and a validated numeric HTTP status when available.
Raw response/error text remains excluded; publication criteria are unchanged.
The regression was observed failing before implementation, then passing.
Full `npm run check`: **226 tests / 10 files**, **24.46 kB / 32 kB**.
This response-classification patch has not been deployed; cloud cause and
acknowledgment remain unresolved. No agent ingestion retry was performed.

### Development 5.2.0: graph HTTP 401

The user deployed 5.2.0 and reran the strict test at 17:17:18 local time.
Logs at `2026-11-19T22:17:26.527Z` show a bound connector followed by
`sdkSuccess: false`, `acceptedCount: 0`, `rejectedCount: 0`,
`matchingAccepted: false`, and `httpStatus: 401`. Invocation:
`d43b4264-d443-4632-ae9d-d2f6a1aa7b4d`.

This identifies graph-service authentication/authorization rejection, not an
object validation rejection or publication-storage failure. The precise cause
of that HTTP 401 is not yet established. Read-only `forge install list --json`
reports the Jira development installation as major version `5 (Latest)`,
`Up-to-date`. The manifest declares the documented ingestion scope
`write:object:jira`. SDK 5.4.0 uses Forge app authentication through
`__fetchProduct` with provider `app`, remote `stargate`, type `fpp`; it does not
forward the caller's Basic credential to the graph endpoint. The official
connector tutorial explicitly supports ingestion from a webtrigger.

No additional code, scope, deployment, connector reactivation, or ingestion
retry was performed for this investigation. Another deploy or broadened scope
is not justified by the current evidence. Next investigation needs the graph
service's authentication failure reason or a platform trace, without disclosing
request content or credentials. This work remained open.

### Trace diagnostic and connector review — 2026-11-19 17:43

Added optional graph-service `traceId` from the SDK's dedicated
`originalError.traceId` field. Only exactly 32 hexadecimal characters are
reported; absent, non-string, oversized, newline-bearing, or other malformed
values are omitted. No extraction from arbitrary error text or response body.
Existing graph logging already forwards these explicitly selected diagnostic
fields. Admission and acknowledgment criteria are unchanged. Regression red
then green; full `npm run check`: **227 tests / 10 files**, **24.53 kB / 32 kB**.
Not deployed and no live retry performed.

Consulted `forge-connector`: current named SDK import, KVS storage and
success/rejection checking match its guidance. Its read/write/delete scope
troubleshooting suggestion concerns HTTP 403, not an established HTTP 401 fix.
No scope expansion was made. The official connector tutorial explicitly uses a
web trigger, so a task runner is not proven necessary:
<https://developer.atlassian.com/platform/teamwork-graph/build-a-teamwork-graph-connector/>.

The user independently confirmed Wonder objects through Rovo Search. Discourse
uses the exact same installed API 8.5.0 / graph SDK 5.4.0 versions and identical
transport, with ingestion in a platform-managed connector task runner. Next
checks: obtain the service trace on an authorized deployed retry; verify in
Atlassian Administration that the active Workdown connection belongs to this
app/environment/site and corresponds to the saved lifecycle binding; if still
unresolved, approve a controlled same-object ingestion comparison between
connector callback and webtrigger contexts. Do not disconnect/reconnect blindly:
connector deletion removes ingested data. No callback ingestion hook, extra
scope, or orchestration module was added by this review.

### Development 5.3.0: service trace captured

User deployed 5.3.0 and reran the strict check at 17:47:39 local time;
retained sequence 1 remained unpublished. At `2026-11-19T22:47:46.833Z`,
graph ingestion returned HTTP 401, SDK success false, zero accepted/rejected
objects, and no matching acceptance. Binding lookup succeeded.

- Graph service trace ID: `c2582436ceff409783076c3ff9b1511e`
- Forge invocation ID: `c80cebba-789b-4ca5-aba2-d14cd93e38a1`
- App: `ari:cloud:ecosystem::app/dafd6b90-4561-4a15-960f-758ff81672cd`
- Environment: development; deployment 5.3.0
- Jira site: `one-atlas-devb.atlassian.net`

Trace instrumentation is now verified on-platform. The service rejection reason
is still unknown; no available tool here resolves this graph service trace into
backend authentication logs. No further instrumentation, deployment, scope
change, or agent ingestion retry was performed. Use this correlation evidence
for platform investigation, or explicitly approve a controlled invocation-context
comparison. This work remained open.

## Publication and Rovo Search verified — 2026-11-19

This update supersedes the earlier unresolved HTTP 401 status. The missing
`read:object:jira` and `delete:object:jira` scopes were added alongside the
existing write scope, following the official connector module reference.
The developer deployed and upgraded the development installation. The next
observed graph request returned HTTP 202 with SDK success, one accepted object,
and no rejections. The original backend authentication reason was not recovered.

Runtime diagnostics then established an acceptance-shape mismatch: the service
returned the matching document ID in `accepted.entityId.entityId`; the matcher
expected `accepted.entityId.id`. Commit `c65ea47` supports the observed field
with the documented field as fallback, preserving exact type/identity and
zero-rejection requirements. Temporary identity diagnostics were removed.
Local validation passed 228 tests and the full repository checks.

After the developer redeployed, `npm run test:deployed:publication` passed at
18:57 local time: retained sequence 1 and published sequence 1. This proves
app-recorded acknowledgment for the current configured Epic, not indexing.

The developer subsequently verified the Workdown in the Rovo Search UI:

- With **Type: Document**, each of `lost in a maze`, `reporting system`, and
  `2025-08-16` returned exactly the one Workdown document.
- Searching words unique to the included child's title also returned it;
  the exact query words were not recorded.
- Opening the Workdown result navigated to the source Epic.
- Source and child issue-key queries were intercepted as exact issue matches,
  so they were unsuitable for the Document-filter check, not app failures.

The description phrases support body-text discovery. The date is a configured
Start date value, but its absence elsewhere was not checked: structured date
metadata and exact Frontmatter retention are not established. Child-title
search does not establish child-description indexing. Prior ingestion attempts
prevent a clean indexing-latency measurement. These are user-observed UI
results, not agent browser automation or a public Search API test.

The [Search guide](../docs/how-to/search-workdown.md) captures the repeatable
procedure, observations, and evidence boundaries. Source navigation does not
verify a separate Workdown viewer or its HTML/link safety. Rovo Chat behavior,
all-user visibility, freshness, deletion, and cross-site delivery remain
unverified.

## Accepted closure scope — 2026-11-20

Deployment/activation, matching ingestion acknowledgment, and Epic Workdown
Search discovery are verified. The user accepts this as sufficient evidence of
TWG ingestion. Exact TWG content/Frontmatter readback, additional Search token
coverage, structured metadata indexing, and measured indexing latency are not
closure gates; they remain unverified rather than newly proven. The app controls
submission and acknowledgment handling, not Rovo Search feature behavior.

No additional fixture framework, standalone export profile, or destination-local
viewer is required for Publication. The current source-Epic URL remains provisional;
source-independent viewing and viewer HTML/link safety are not established. Any
future viewer must satisfy the format specification's security requirements.

The user explicitly deferred deletion API characterization and platform
connector / document mapping to later withdrawal work. No deletion was
performed or authorized by that deferral. Real peer delivery remains
disabled/unverified.

The Forge/TWG limits and quotas review is now documented in
[Workdown platform boundaries](workdown-platform-boundaries.md). It keeps the
current byte/child caps unchanged provisionally, distinguishes billable allowances
from hard limits, and identifies the missing invocation-wide request/deadline
budget and storage amplification. This is not a cloud capacity test or a runtime
fix. On 2026-11-20 the user explicitly accepted the app-controlled budget gap
as a non-blocking hardening follow-up and approved closing the ingestion slice.
The gap remains unimplemented; operational capacity is not claimed. The original
verification scope below is historical and superseded where it conflicts with
this accepted scope; it does not add closure gates.

## Original platform verification scope

1. Approve deployment/installation after reviewing the new scope and connector;
   explicitly activate the connector on the approved development site.
2. Ingest approved synthetic standalone and child-bearing documents. Capture
   sanitized response shapes/status/counts, not document bodies or diagnostics.
   Confirm accepted identity shape and `text/plain`/Frontmatter readback.
3. Independently search body-only and Frontmatter-only tokens, recording latency
   from acknowledgment. Do not equate an acknowledgment with discoverability.
4. Verify actual storage conditional publication races and worst-case serialized
   payloads on Forge. Provisional export limits remain provisional.
5. Exercise `deleteObjectsByExternalId` in an explicitly authorized disposable
   scenario. Record platform connection/document mapping for withdrawal; no
   deletion has been performed or exposed as a new Command.
6. Establish and check the authenticated local viewer's raw HTML and safe-link
   behavior. There is no rendering surface to verify in this backend slice.
7. Actual inter-installation delivery remains unverified and disabled.

## Official references consulted 2026-11-19

- [Connector manifest](https://developer.atlassian.com/platform/forge/manifest-reference/modules/teamwork-graph-connector/)
- [setObjects and response](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-operations/set-objects/)
- [Document content](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-types-connectors/document/)
- [Connector capabilities and deletion](https://developer.atlassian.com/platform/teamwork-graph/connector-requirements-and-best-practices/)
- [Workspace ACL](https://developer.atlassian.com/platform/teamwork-graph/permissions/)
- [KVS/Custom Entity limits](https://developer.atlassian.com/platform/forge/limits-kvs-ce/):
  240 KiB raw per stored value, 25 operations and 4 MB payload per transaction.
  Existing storage uses four bounded base64 chunks and one metadata value in
  five operations; local round-trip coverage reaches the 256 KiB UTF-8 app cap.
  This does not establish a TWG content-text limit.
