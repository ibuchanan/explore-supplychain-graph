# ADR 0003: Directional Peer Connection security

Status: Decided for Explore; implementation and deployed verification pending.

<!-- cspell:words HMAC HKDF -->

## Context

A Forge web trigger has no platform-authenticated caller. Knowing its URL
allows invocation, not authorization. Ticket 02 proved discovery only; it did
not establish caller identity or trusted runtime installation binding.

Two Site Admins authorize a one-way Connection. Neither a Jira API token used
by a developer nor an asserted site ID in a request authenticates a peer.
Unrestricted destination visibility makes mistaken pairing a disclosure risk.

This record decides the protocol responsibilities, not Command names, schemas,
or error codes. Those remain user-authored OpenRPC prerequisites. No runtime,
manifest, scope, egress, or deployment change is authorized by this ADR.

## Decision

### Trust and installation binding

Use an out-of-band invitation bundle, followed by an authenticated HTTPS
handshake. Site Admins exchange the bundle through a channel they already
trust. This is explicit trust in the selected installations, not Atlassian
attestation that a remote endpoint runs an unmodified copy of this app.

Each installation has a descriptor containing app ID, environment, Jira cloud
ID, installation ID, protocol version, and its peer endpoint URL. Obtain local
identity from trusted Forge execution context or independently verified local
installation metadata, never caller-provided JSON, headers, or a URL alone.
Missing or contradictory binding fails closed. Reinstallation is a new
identity and requires a new Connection; never silently inherit old trust.

The app infrastructure layer supplies and wires a dedicated peer
authenticator and adapter with a Connection principal, separate from the
admin-token adapter. Bind every authenticated request to both installation
descriptors, Connection ID, direction, and credential generation. A local
business Command independently checks the authenticated user's current Site
Admin authority on that installation. A peer principal cannot invoke admin
Commands, and an admin token cannot substitute for a peer credential.

### Invitation and acceptance

1. The source Site Admin selects the intended destination's cloud ID and
   environment. The source creates a random Connection ID and a cryptographically
   random 256-bit bootstrap secret, and records a pending outgoing invitation.
   Its absolute expiry is 24 hours after creation, checked in application code.
2. The source returns a one-time invitation bundle containing the source
   descriptor, intended destination identity, Connection ID, expiry, protocol
   version, and bootstrap secret. This is an explicit credential disclosure to
   the initiating admin, not part of ordinary inspection. Do not put the bundle
   in a query string, logs, analytics, or a committed fixture.
3. The destination Site Admin imports that bundle at the destination. This is
   the destination's pending-invitation discovery mechanism: no public directory,
   anonymous push, or polling. Import verifies local target identity, expiry,
   and the admin's authority, then records a pending incoming Connection. The
   admin reviews the displayed source identity and direction before accepting.
   Both sides can now inspect their local pending record without secrets.
4. Acceptance generates a fresh random 256-bit operational secret at the
   destination and sends its descriptor and that secret over TLS in a bootstrap-
   authenticated acceptance request to the pinned source URL. The source checks
   the bound target, expiry, pending state, and replay protection, pins the
   destination descriptor, durably records acceptance, and acknowledges it.
5. The destination becomes active only after verifying the acknowledgment.
   The source records acceptance before acknowledging; loss of the response
   can leave source active and destination pending. The destination retries the
   identical acceptance operation within the bounded retry policy. A persisted
   receipt returns the same acknowledgment without reactivating or issuing
   credentials. After exhaustion, inspection reports uncertain peer progress;
   it must not claim both sides are active. No cross-site atomic commit exists.
6. Before sending document content, the source requires a successful request
   authenticated with the operational credential from the destination, or a
   fresh operationally authenticated readiness acknowledgment. A bootstrap
   acknowledgment alone is not evidence that the destination is ready.

Invitation import and the one-time bundle result must be covered in ticket 10's
user-authored contract; acceptance and readiness belong to ticket 11. If the
proposed contract omits these steps, stop for its update rather than inventing
an agent-owned method. No UI is required to exercise these Command seams.

Expired, revoked, or already-consumed invitations cannot authorize a new
acceptance. An exact authenticated retry may retrieve a stored receipt; a
second acceptance with different parameters is rejected. Expired pending
records remain visible as pending with an expired invitation, not active.
A new invitation gets a new ID and secret. Neither import nor acceptance grants
reverse-direction document delivery.

### Message authentication and replay

Use HMAC-SHA-256 with independent keys derived using HKDF-SHA-256 from the
Connection secret. Derivation binds protocol version, both descriptors,
Connection ID, credential generation, sending side, and purpose. Bootstrap,
operational requests, and responses use distinct derivation labels. Both sides
possess shared credentials: this provides integrity and possession-based
peer authentication, not non-repudiation or protection from a compromised peer.

Sign an unambiguous length-prefixed UTF-8 encoding of protocol version, HTTP
method, pinned endpoint identifier, both installation identities, Connection
ID, direction, generation, operation ID, random request nonce, timestamp, and
SHA-256 digest of the exact transmitted body bytes. Authenticate responses with
the request nonce, operation ID, status, and response-body digest. Do not parse
and serialize JSON again to verify a signature. Compare MAC values in constant
time and reject missing, ambiguous, duplicate, or unsupported auth fields.
The concrete header/envelope encoding requires approved contract examples
before implementation; no ad hoc concatenation is permitted.

Reject timestamps more than five minutes from receiver time. Atomically claim
each nonce before any side effect and retain claims for at least ten minutes;
check expiry explicitly rather than trusting asynchronous storage TTL removal.
Every retry uses a fresh timestamp and nonce, but the same operation ID and body.
Persist the operation's request digest and result so retries cannot duplicate
acceptance, delivery, or revocation. Reusing an operation ID with a different
body is rejected. An exact replayed nonce is rejected, not executed again.
Receipt retention must cover the operation's entire retry/validity window;
terminal lifecycle state remains authoritative after receipt expiry.

Direction denotes allowed content flow, not the direction of every network
packet. Acceptance, acknowledgments, readiness, and revocation may travel in
reverse; only the source may send documents. Check allowed operation, local
role, Connection state, and generation at the business boundary on every call.
A valid MAC never overrides these checks.

### Credentials, endpoint safety, and rotation

Keep bootstrap and operational secrets in installation-scoped Forge encrypted
secret storage, not ordinary records. Ordinary inspection includes lifecycle,
expiry, peer identity, generation, and sanitized progress only. Never return
operational secrets. Store the bootstrap secret only while needed for the
handshake; after completion retain derived bootstrap request/response keys
for ten minutes solely for receipt retrieval, not new acceptance, then delete them.
Exact acceptance retries remain subject to the original invitation expiry.
Exclude URLs, bundles, headers, body content, secrets, and raw exceptions from
logs and audit events. Developer SecretSpec credentials are not peer storage.

Only HTTPS endpoints on the approved Forge web trigger host allowlist are
eligible. Pin the complete endpoint after admin-approved pairing; forbid user
info, fragments, query credentials, alternate ports, redirects, private/local
addresses, and arbitrary callback URLs. Authenticate before using any supplied
callback descriptor. Verify actual generated URL forms and required outbound
permissions on the existing approved installation; do not substitute a
permissive wildcard or trust a string suffix check. Verification policy revision
approved 2026-11-17: a second installation is not a ticket closure prerequisite.
Actual remote binding and handshake compatibility remain unverified until
separately exercised; do not enable unverified operational peer traffic or
weaken any endpoint/authentication check to accommodate single-site testing. SDK-generated
local URLs are stable per module, app, site, product, and environment, but that
does not authenticate a supplied remote URL or prove remote installation ID.

Explore rotates credentials by revoking the old Connection and establishing a
new one with a new ID and secrets. No in-place key overlap or rotation Command
is introduced. Suspected compromise requires revocation, not URL replacement.
Revoked identities cannot be restored by rotating secrets or replaying an
acceptance. Compromise of an installation remains compromise of its local data
and secrets; the protocol does not defend against malicious local app code.

### Revocation, unreachable peers, and withdrawal

Either local Site Admin can durably revoke without peer approval. Commit a
terminal local tombstone before acknowledging the Command; block new Exchanges,
content sends, reads of withdrawn content, and data-bearing peer operations.
Never delete the tombstone merely because cleanup or notification failed.

Send an authenticated revocation control message under the existing credential.
A revoked Connection accepts only narrowly scoped authenticated revocation
messages and receipts needed to converge cleanup, never document delivery,
acceptance, or reactivation. Retain the credential in secret storage only while
needed for revocation notification/receipt handling (at most ten minutes
after local revocation), then delete it;
retain non-secret terminal state. This control-plane exception clarifies the
later ticket's phrase “no further peer traffic”: it forbids sharing traffic,
not the messages needed to stop sharing. It grants no new business feature.

Use the agreed initial attempt plus three retries, nominally after 5, 15, and
45 seconds with jitter, respecting platform constraints. Permanent failures
stop immediately. Inspection distinguishes local revocation, peer acknowledgment,
notification exhaustion, and withdrawal progress/failure. The local state stays
revoked even when the peer is unreachable. Without polling or reconciliation,
a peer can remain unaware indefinitely after retries exhaust. In particular,
source-side revocation cannot immediately prevent reads of already-held content
at an unreachable destination. Never report guaranteed remote erasure.

Serialize local lifecycle transitions and document acceptance per Connection
with an atomic state/version check. A worker's earlier active-state read is
not authorization to commit later. Revocation fences new commits; in-flight
external TWG ingestion may still finish. Track that work durably and include
its object identities in withdrawal; a late acknowledgment cannot recreate
active state or trigger a new Publication/Automation notification. Cleanup
must cover acknowledged and uncertain ingestion attempts and expose failures.

The storage adapter must prove conditional transitions and durable work/receipt
recording under concurrency before shipping these Commands. Ordinary KVS
last-write-wins updates and a process-local mutex do not satisfy this boundary;
KVS multi-write atomicity alone does not establish compare-and-swap semantics.
Select and verify a supported conditional storage mechanism in implementation,
or stop and record the blocker. No distributed lock or remote transaction is
assumed. Withdrawal cannot recall copies or undo Automation actions, and TWG
Search deletion is not necessarily immediate.

### Audit ownership and critical methods

Invitation creation/import, acceptance, and revocation change cross-site trust:
mark them critical in the RPC exposure policy. Inspection is standard/read-only.
Peer operations that change trust are critical as well; peer authentication
must not bypass the audit requirement.

The app's Forge infrastructure adapter owns the backbone `AuditPort`. Its
publisher acknowledges only after writing the allowlisted CloudEvent to an
installation-scoped Forge storage audit record keyed by event ID. Restrict
reads to local Site Admins and backend audit processing; never expose records
through peer inspection. This local durable sink requires no external service.
Retention and deletion must be documented before rollout; it is not a
tamper-proof ledger against malicious installation code. The adapter supplies
trusted local installation/environment identity, correlation ID,
allowlisted method/reason,
and verified account ID for human callers. A Connection principal is not a
human account ID. Peer identity can be correlated through a separate allowlisted
lifecycle record; never squeeze it into the account ID field.

A critical attempt must receive durable audit acknowledgment before mutation.
An unavailable publisher or uncertain acknowledgment fails closed. Record
outcomes durably with lifecycle work so a failure after commit is observable;
do not roll back a revocation or claim no mutation merely because outcome
publishing failed. Logs, a no-op publisher, and “event queued” without durable
acknowledgment are not substitutes. Authentication/authorization failures use
sanitized reasons and never copy raw requests into the audit sink.

There is currently no app audit publisher. Ticket 10 must supply this adapter
and test its failure behavior, or remain blocked. Reuse the backbone event and
port contracts rather than inventing a second audit protocol. This ADR does
not claim that console output or an unverified Forge event meets the contract.

## Alternatives considered

- Public unauthenticated invitation push: easier discovery, but permits spam
  and cannot establish installation identity. Explicit import avoids that trust
  bootstrap ambiguity and needs no public directory.
- Reuse a developer Jira API token: authenticates a human with excessive scope,
  not the Connection; leaks admin authority across sites and couples trust to a
  developer credential. Rejected for peer calls.
- Bearer secret over TLS: simpler, but does not bind the exact body, direction,
  or replay window. HMAC binds those at the cost of nonce and receipt storage.
- Asymmetric signatures or a trusted broker: stronger key separation or central
  attestation, but adds key-distribution/broker lifecycle. Not needed for the
  explicitly admin-paired shared-secret trust model in Explore.
- Automatic credential rotation and reconciliation: useful later, but expands
  lifecycle and scheduling scope. Reconnect and visible bounded failure are
  the initial policy, not claims of guaranteed convergence.

## Implementation and test gates

This documentation-only ticket adds no testable Command or new test seam.
Tickets 10–12 must use the already approved business Command, JSON-RPC, and
deployed peer seams, one red/green behavior at a time. Cover wrong admin/site,
wrong direction, body tampering, expired/replayed invitations and requests,
conflicting retries, missing audit acknowledgment, terminal-state races, and
unreachable-peer status. Under the verification policy revision approved
2026-11-17, use isolated local peer identities for these cases and the existing
installation for targeted authentication, runtime, storage, and endpoint checks.
Never bypass installation binding or add test-only production Commands. If a
peer case cannot enter the real boundary safely on one installation, retain
local evidence and explicitly mark the remote property unverified. Actual
inter-installation pairing/transfer is a separate scenario requiring a named
residual risk, expected signal/cost, and user approval, not a repeated ticket
closure gate. This changes evidence requirements, not the trust model or
operational clearance. Never put real bundles or endpoint URLs in fixtures or
committed evidence.

Required before implementation can be called complete:

- User-authored OpenRPC definitions include invitation import, secret-bearing
  one-time output, readiness, idempotent receipts, and sanitized status/error
  behavior; peer wire encoding and signature examples are approved too.
- Verify local runtime installation binding, admin authority, SDK URL creation,
  host validation, secret storage, conditional writes, and audit acknowledgment
  on the first implementation slice that uses each platform behavior.
- Review minimum storage/admin-check scopes and peer egress changes separately;
  deploy, install, or create cloud endpoints only with explicit approval.

No change to the agreed product scope is intended. Explicit import is the
chosen discovery handshake; reconnect is the chosen rotation policy. The
revocation control-plane exception above is a wording clarification that must
be preserved in tickets 12 and 18 and their contracts. Any requirement for
automatic discovery, in-place rotation, or guaranteed remote convergence would
change this decision and requires user approval, not silent implementation.

## References

- [Overall specification](../supplychain-graph.md)
- [Destination visibility](0001-unrestricted-destination-visibility.md)
- [Development invocation and credentials](../../DEVELOPMENT.md)
- [Forge web triggers and authentication](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger/)
- [SDK web trigger URL lifecycle](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger-api/)
- [Forge secret storage](https://developer.atlassian.com/platform/forge/storage-reference/kvs-api-secret/)
- [Forge KVS isolation and conflict handling](https://developer.atlassian.com/platform/forge/storage-reference/kvs/)
- [Forge KVS transactions](https://developer.atlassian.com/platform/forge/storage-reference/kvs-transactions/)

Platform documentation was consulted on 2026-11-16; documentation is not
substitute evidence for the deployed gates above. Backbone audit/authentication
contracts were inspected in the installed `@forge-ahead/rpc` package.
