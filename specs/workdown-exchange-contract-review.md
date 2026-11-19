# Ticket 20 Command contract review

Status: **draft for user approval**, 2026-11-19. Not implemented or exposed.

The [OpenRPC draft](workdown-exchange.openrpc.draft.json) proposes additions to
`src/openrpc.json`; the active export contract and generated artifacts are
unchanged. Approval of the ticket's test seams is already recorded; approval of
these Command definitions is separate.

## Proposed interface

| Command | Inputs | Successful result |
| --- | --- | --- |
| `exchange.start` | `connection`, `profile: jira-epic`, `issue` | Connection, loopback marker, document identity, actual destination-held sequence |
| `document.get` | `connection`, `document` | Connection, loopback marker, document identity, actual stored sequence, Workdown bytes |

- Start requires current source Project Admin authority and caller-scoped export
  checks. Read requires an authenticated destination-site reader, not source
  access or Project Admin authority. Neither accepts caller-supplied installation
  identity, an endpoint, or a destination Jira target.
- Ticket 20 recognizes only `development-loopback`, disabled outside
  development. Results explicitly say `loopback: true`. The general boolean
  leaves room for accepted real Connections later; it does not enable them now.
- Propose the stable Jira `source_id` ARI as document identity within a
  Connection. There is no separate Exchange ID. Keys may change without
  changing identity. Internal storage and TWG key encoding remains an
  implementation design, not a raw concatenation of untrusted keys.
- Start is repeat-safe per Connection and Subject. Each call attempts immediate
  generation and delivery; changed bytes allocate a new positive safe-integer
  sequence, unchanged bytes reuse it. Gaps are allowed. Retries of a candidate
  retain its bytes and sequence. Concurrent allocation needs atomic storage
  evidence, not only local fakes.
- Start succeeds after durable destination acceptance (including an existing
  same or newer sequence), not after TWG ingestion. Read returns latest-only
  storage; it may be newer than the start acknowledgment. Neither response
  claims a Publication or Search visibility.
- Generation failure retains previous successful content and creates no
  candidate. A delivery/storage error is not a rollback guarantee; a candidate
  or destination document may already exist. No automatic retry promise or
  durable retry queue is introduced before ticket 26.

## Expected failures

Existing export errors `-32002` through `-32009` also apply to start, along with
standard invalid-parameter and forbidden errors. New proposed codes:

| Code | Message | Meaning |
| --- | --- | --- |
| `-32010` | Connection unavailable | Unknown, wrong direction, inactive, revoked, or development loopback disabled; no state details |
| `-32011` | Delivery unconfirmed | Delivery acknowledgment absent or unusable; acceptance may already have happened |
| `-32012` | Storage unavailable | Persistence/read/atomic allocation unavailable or outcome uncertain; not a missing-record response |
| `-32013` | Document unavailable | No current retained document in the accessible active incoming Connection |

Errors contain only stable code/message, no restricted diagnostics or partial
content. Authentication failures remain the transport's responsibility; business
permission failures are `Forbidden`. Authorization must precede disclosure of
Connection/document state. Storage corruption and unexpected exceptions remain
sanitized internal errors, not fabricated successful or missing results.

No new retry metadata is proposed: delivery-unconfirmed requires checking current
state or safely repeating start, not assuming failure meant no write. Storage
unavailability may be transient but may also have an uncertain write outcome.
The existing export retry classifications remain unchanged.

## Binding and implementation obligations

Intent → caller-facing Commands → reviewed `x-forge-ahead` metadata → existing
webtrigger/dispatcher → business authorization, generation, delivery and storage.

- `exchange.start`: `web: true`, `execution: asUser`, `audit: standard`.
  This shares curated content under existing trust, rather than changing trust.
  ADR 0003 marks invite/import/accept/revoke critical; this draft does not silently
  add a durable critical-audit gate for start. Confirm this classification.
- `document.get`: `web: true`, `execution: asApp`, `audit: standard` for app-owned
  destination storage. `asApp` grants no caller permission and never bypasses
  destination membership or lifecycle checks.
- The existing web adapter requires Jira Site Admin authority for every request.
  Ticket 20 must support Project Admin starts and authenticated destination reads
  without weakening `workdown.export`'s existing policy. Approval of these
  contracts approves the intended audience, not an authentication bypass.
- No peer-receipt Command is declared here. Loopback needs an authenticated
  delivery/receipt seam with trusted installation context, never a test-only
  unauthenticated public method. Real peer protocol remains ADR 0003 work.
- Handwritten handlers, runtime error catalog entries, execution selection,
  input/output validators and Workdown/identity consistency checks remain to be
  implemented after approval. String length is not the Workdown UTF-8 byte limit.
- Sequence assignment, byte comparison and persistence ordering need an explicit
  atomic design before implementation. Store sequence and bytes consistently;
  reject stale deliveries and conflicting same-sequence/different-byte inputs.
  Fence local reads/acceptance against revocation. Do not infer concurrency
  correctness from a JSON Schema or from TWG index ordering.

## Tooling gap and approval boundary

The installed `@forge-ahead/rpc` generator rejects schema-level `description`
annotations and numeric bounds; its documented profile also excludes integer
schemas. The draft deliberately preserves numeric
`updateSequenceNumber`, rather than silently changing it to a string to fit the
generator. A reviewed generator enhancement or an explicitly approved alternative
validation/type-generation approach is required before activation.

This file and its OpenRPC companion are review artifacts, not another active
contract source. On approval, merge the methods/components into `src/openrpc.json`
and remove the draft JSON (retain only useful durable decision documentation).
Do not regenerate active artifacts, change runtime exposure, deploy, or install
merely to validate this proposal. No scope, egress, or manifest changes are made.

Approval requested for the interface, stable identity encoding, repeat/uncertain
write semantics, audience, error codes, and audit classification above. The
integer generator gap remains a separate implementation blocker, not permission
to modify an external dependency.
