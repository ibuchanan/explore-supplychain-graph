# Ticket 20 Exchange Commands

The user approved the singular method names and contract on 2026-11-19.
The binding declaration is now [`src/openrpc.json`](../src/openrpc.json).
The former draft JSON has been removed; this document records implementation
choices and evidence, not another contract source.

## Interface and authority

| Command | Inputs | Successful result |
| --- | --- | --- |
| `exchange.start` | `connection`, `profile: jira-epic`, `issue` | Connection, loopback marker, document identity, destination-held sequence |
| `document.get` | `connection`, `document` | Connection, loopback marker, document identity, stored sequence, Workdown |

Both authenticate an active Atlassian account against the installation's Jira
site. Start additionally checks current `ADMINISTER_PROJECTS` in the source
issue context at the business boundary, using `issueId` for numeric IDs and
`issueKey` otherwise, then performs the existing caller-scoped export checks.
Reads do not query source Jira or require Project Admin authority. Per ADR 0001,
content is unrestricted within the authenticated destination boundary, not public.
The existing discovery/export transport retains its Site Admin admission policy.
No caller-supplied tenant identity, endpoint, or destination Jira target is used.

The only recognized Connection is `development-loopback`. Trusted
`getAppContext().environmentType` must be `DEVELOPMENT`; missing runtime context,
staging, and production fail closed. Every successful result marks loopback.
Real peer Connections, revocation, Publication, TWG, and notifications are not
implemented by this slice. Standard audit metadata is retained for both Commands;
trust-changing Commands remain separate critical-audit work under ADR 0003.

## Identity, allocation, and receipt

- Document identity is the stable Jira source ARI, scoped by Connection and
  installation. Source and destination roles use separate retained records.
  Their internal keys are SHA-256 hashes of JSON-encoded identity tuples, not
  raw caller strings or mutable issue keys. No separate Exchange ID is added.
- The source retains one current candidate. Exact byte equality reuses its
  positive safe-integer sequence; changed bytes advance it by one through a
  conditional transaction. Three conflicting attempts fail without a success
  claim; sequence exhaustion fails without wrapping.
- An internal receipt seam accepts a trusted Connection/installation binding,
  never a public unauthenticated peer RPC. Loopback invokes this seam only after
  caller authentication, Project Admin checking, and successful generation.
  Logical peers can use isolated stores in tests. It is not real cross-site
  authentication or delivery evidence.
- The destination independently retains latest-only content. A stale receipt
  acknowledges the newer retained sequence. Identical duplicates are safe;
  same-sequence/different-byte candidates are rejected. Conditional updates retry
  up to three times to prevent a stale writer replacing newer content.
- Durable source candidates survive uncertain delivery. A repeat start with
  unchanged Jira content reuses the bytes and sequence. Source edits may create
  a newer candidate; there is no historical replay or automatic queue yet.
- Start acknowledges durable destination acceptance, not Publication or Search
  visibility. A generation failure creates no new candidate and preserves the
  previous document. Storage/receipt failures are sanitized and never imply
  rollback or missing data. Reads validate identity, sequence, size and Workdown.

## Forge persistence and contract tooling

`storage:app` and custom entity `exchange-document` are newly declared.
A single conditional Custom Entity Store transaction writes one version/identity
record and four base64-encoded 64 KiB byte chunks. Each object stays below the
240 KiB Forge object bound even at the 256 KiB UTF-8 export limit. Empty chunks
use the entity's `any` payload. UTF-8 is decoded only after byte concatenation.
Readers fetch the version before and after chunks and check all chunk versions;
concurrent replacement retries, never returns mixed content. No history, lock,
TTL, external service, or extra index is introduced. Entity declaration lifecycle
restrictions and upgrade approval must be reviewed before deployment.

The installed RPC generator cannot preserve the approved integer schema/bounds,
and its discovery projection drops numeric bounds. App-local
`scripts/command-contract.mjs` generates types, Ajv standalone input/output
validators, and policy from the one active contract. It preserves HandlerMap and
Caller interfaces and fails unsupported type/policy declarations. Authenticated
successful discovery restores the public application contract with method policy
and examples removed, retaining numeric constraints. No external dependency was
modified. Existing `workdown.export` remains unchanged.

## Verification — 2026-11-19

- Red/green observed for contract activation, start/read walking slice, changed
  sequence allocation, corrupted retained content, non-admin authenticated reads,
  and missing delivery acceptance.
- **207 local tests / 8 files pass**, including separate logical peer stores,
  stale/conflicting receipt rejection, uncertain delivery, concurrent identical
  changes, storage adapter chunk bounds at full UTF-8 size, dispatcher validation,
  authentication, production gating, generation failure, and tenant isolation.
- OpenRPC validation, all examples, and negative numeric-bound checks pass.
  Typecheck/build, generated freshness, formatting/static checks, and size check
  pass; bundle is **19.94 kB brotlied / 32 kB limit**.
- `npm run check` was run. Its only remaining failure is `forge lint`'s
  `MAJOR_VERSION_RULE` approval gate for the added storage scope: **0 errors,
  0 warnings, 1 approval required**. No approval was auto-accepted.
- Existing-site deployed tests for authenticated start/read, repeat/concurrent
  start and retained Workdown are added to the shared scenario harness, but were
  **not run**. They write app storage and need explicit execution approval.
  Deployed non-admin Project Admin/read evidence and changed-content sequence
  races still need controlled fixtures and platform verification.
- Forge transaction behavior, first conditional creation, storage consistency,
  and actual concurrency are **not cloud verified**. SDK-backed fakes establish
  adapter intent only. No actual inter-installation delivery was exercised.
- Production dependency audit reports **5 moderate advisories**, no high or
  critical advisories. Dependency remediation is not silently mixed into this
  feature. Review before release.

At initial implementation, no deployment, installation, upgrade, or live-site
write was performed. No second installation is required for verification; real
peer operation is not enabled by local tests.

### Installed-app verification attempt — 2026-11-19

The user supplied successful development **4.0.0** deployment and installation
upgrade output, including approval of `storage:app`. That resolves the earlier
scope/upgrade approval gate; it does not establish runtime behavior.

- `npm run check` now passes, including Forge lint. After the fix below,
  **208 tests / 8 files** pass; the size check remains **19.94 kB / 32 kB**.
- The deployed suite first rejected the outdated ignored scenario file before
  network calls. Its missing child/description expectations were copied from
  the checked-in public fixture for the same issue, not from exported output.
- The next deployed run failed all **4 active tests**, with **2 previously
  deferred security scenarios skipped**. Discovery and start returned HTTP
  **424**, not the expected authentication response; exports also returned 424.
- Recent development `forge logs` identified a startup `MODULE_NOT_FOUND` for
  `ajv/dist/runtime/ucs2length` in `src/generated/validators.js`. No request,
  credential, endpoint, issue content, or returned Workdown is recorded here.
- Ajv-generated standalone validators retain runtime helper imports. Ajv was
  declared only as a development dependency. Moved the existing dependency to
  production dependencies without changing its resolved version. A regression
  check of generated helpers against production dependency declarations failed
  before the fix and passed afterward. This declaration check is not proof of
  a working deployed bundle.
- No agent deployment or installation was performed. The fix needs an approved
  redeployment and another installed-app run. No successful storage transaction,
  first conditional creation, concurrent start, retained read, non-admin read,
  or changed-content race was established by this failed cloud attempt.

Ticket 20 remains open for successful single-installation platform verification.
Actual cross-installation delivery remains unverified and is not enabled.
