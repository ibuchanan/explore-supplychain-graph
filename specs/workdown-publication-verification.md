# Ticket 21: Publication implementation and verification

## Decisions confirmed 2026-11-19

The user clarified that `publication.published` is a JSON-RPC 2.0 notification,
not a Forge App Event, and selected internal destination-local dispatch.
The notification has `jsonrpc`, `method`, and identity-only `params`, without
an `id`. No Forge `event` or `trigger` module is involved. External HTTP delivery
and Automation integration remain later work.

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
  Automatic retry scheduling remains ticket 26. To keep pending state bounded,
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
on the scratch ticket: **223 tests / 10 files pass**, full check passes, and
bundle size is **23.77 kB / 32 kB**. Runtime dependency audit reports six moderate and no
high/critical advisories; no unrelated dependency upgrades were attempted.

## Outstanding platform gates — ticket remains open

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
