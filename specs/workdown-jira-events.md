# Jira product event intake — ticket 22

## Local implementation (2026-11-20)

This is a development-loopback implementation, not evidence that automatic
freshness is operational. No deployment, installation, Jira mutation, cloud
payload capture, or event-driven TWG ingestion was performed for this work.
Ticket 22 remains open for the installed-platform gates below.

Final local verification: `npm run check` passed with **243 tests in 14 files**,
including Forge lint, type checking/build, generated-contract freshness, static
checks, and a **27.06 kB / 32 kB** bundle. Documentation lint for this page and
`git diff --check` passed. Existing repository static advisories remain.

The manifest subscribes to Jira issue created, updated, and deleted product
events through a `trigger` module. There is no Forge `event` module, polling,
reconciliation, new Command, or change to OpenRPC. Production and staging
remain disabled by the existing loopback boundary.

An authenticated `exchange.start` retains only the installation cloud ID,
Connection, document identity, and sharing principal account ID in Forge KVS.
It never retains the request API token. Existing Exchanges must be started
again after upgrade to register their principal; there is no token-based
migration. A subsequent authorized start may replace the principal; background
intake does not replace it. Registration failure prevents delivery.

Intake selects a Subject using its numeric identity, current child parent read,
or child identities in the last source document. It does not trust event content
or the event actor as disclosure authorization. For a selected Subject it invokes
the same Exchange implementation as the initial start: current Project Admin
check, complete Workdown generation and eligibility checks, canonical-byte
comparison, conditional sequencing, destination retention, TWG ingestion, and
Publication acknowledgment. Failed reads/permissions never fall back to app
access. Unchanged bytes reuse the sequence and create no new Publication; an
already-unacknowledged sequence may still retry its existing publication stages.

Every background Jira read uses Forge `api.asUser(retainedAccountId)`, including
metadata, children, and Project Admin checks. The added `read:jira-work` scope
has `allowImpersonation: true`; existing graph/storage scopes do not. There is
no added egress. An installation upgrade and scope review require approval.
Forge documents restrictions on offline impersonation: deactivated users and
other app users cannot be impersonated, users must have access to the app, and
an undistributed app can impersonate contributors only. Denied or unavailable
impersonation fails closed. Installed proof for this principal is still required.

## Event coverage and evidence boundary

| Change | Local behavior | Installed evidence |
| --- | --- | --- |
| Epic included-field edit | Updated issue identity selects Subject; regenerate all fields | Pending: delivery, payload shape, final Publication |
| Child creation | Read current parent as retained principal; select registered parent | Pending |
| Child included-field edit | Retained membership selects prior parent; current-parent lookup selects other relevant Subjects | Pending |
| Child deletion | Retained membership selects prior parent without rereading deleted child | Pending: deletion payload and child omission after read |
| Reparenting between Epics | Prior source document selects old Epic; current-parent read selects new Epic, independently | Pending: both actual event delivery and both Publications |
| Issue security change | An issue update, if delivered, invokes fresh eligibility checks | Event availability/payload not verified |
| Project permission or principal-access change | No dedicated subscription; any later selected event rechecks authority | Usable event coverage not verified; no completeness claim |
| Source-Epic deletion | Deliberately ignored; no withdrawal | Unsupported by profile; no live deletion performed |

Official docs say updated issue events occur when any issue field changes, but
that is not installed observation of each included field or eligibility change.
No synthetic payload in local tests is claimed as a sanitized cloud fixture.

## Explicit freshness limitations

- A missed event can leave destination content stale indefinitely. No silent
  reconciliation or polling is added. This is a freshness limitation for a
  product/ADR decision, not a guarantee of event-only freshness.
- Prior-parent retention is the last source document's included child identities.
  An event for a child never retained there, or reparented again before the
  current-parent read, may not locate every intermediate parent. Event changelog
  routing is not relied on until its deployed shape is characterized.
- Registry queries are eventually consistent. Current principal records are
  reread by key, but just-created registrations can be absent from a query.
  Concurrent explicit principal replacement and an in-flight publication are
  not an atomic revocation mechanism; permissions are checked for each read.
- This small development slice scans registered Exchanges and reads retained
  documents; current-parent reads can repeat per Exchange. Large fan-out can
  exhaust invocation budgets. Indexed membership/bounded continuation and the
  separate ticket 29 request-budget work are not implemented here.
- Permission loss fails fresh generation, but does not withdraw already shared
  content. Source deletion and missed eligibility changes remain unsupported
  freshness/withdrawal cases; ticket 28 owns the separate withdrawal work.
- Automatic republishing is not cleared for operational use until installed
  impersonation, event mapping, and final TWG acknowledgment are verified.

## Approval-gated installed verification

1. Review the new Jira read/impersonation scope and trigger subscriptions, then
   obtain approval to deploy/upgrade the existing development installation.
2. Obtain explicit approval for each disposable Epic/child edit, create, delete,
   reparent, and any security/permission mutation. Use operator-selected fixtures;
   do not infer approval from this runbook. Agree restoration/cleanup first.
3. Reuse the configured scenarios and `createDeployedRpc` helper to start the
   Exchange, establish baseline `document.get` bytes and `publication.status`,
   then perform one approved Jira mutation. Do not call `exchange.start` after
   the mutation: that would mask failed event intake.
4. Read status with a bounded observation window; compare against the baseline
   sequence and independently expected changed bytes. Require the new retained
   sequence to have an equal `publishedSequence`. Handoff or an intake success
   log alone is not Publication. Check unchanged-content delivery separately.
5. For reparenting, establish both registered Epics and verify both current
   documents. For deletion, verify the retained prior membership locates the
   affected Epic. Do not delete the source Epic as an incidental test.
6. Capture minimal sanitized Forge logs: event-type labels, presence/type of
   identity/parent/changelog fields, counts, outcomes, and sequence numbers.
   The current handler logs only attempt/failure counts; inspect actual payloads
   only through an explicitly approved, allowlisted diagnostic extension. Never
   log raw events, descriptions, account IDs, credentials, or context. Commit
   sanitized shape fixtures once actual observations exist.
7. Record absent events and unlocatable Subjects explicitly. Stop on any
   contradiction of the approved profile. Actual remote-peer delivery remains
   unverified by this single-installation loopback scenario.

## Official references consulted 2026-11-20

- [Jira product event schemas and required scope](https://developer.atlassian.com/platform/forge/events-reference/jira/)
- [Trigger module](https://developer.atlassian.com/platform/forge/manifest-reference/modules/trigger/)
- [Offline impersonation declaration](https://developer.atlassian.com/platform/forge/manifest-reference/permissions/)
- [Offline impersonation restrictions](https://developer.atlassian.com/platform/forge/security/#user-impersonation)
- [Backend requestJira](https://developer.atlassian.com/platform/forge/apis-reference/fetch-api-product.requestjira/)
- [KVS query and pagination](https://developer.atlassian.com/platform/forge/storage-reference/kvs-api-query/)

Exact REST scope lookups for field search and current permissions both returned
classic `read:jira-work`. Local Forge lint also accepts the manifest. Neither
establishes deployed authorization or event completeness.
