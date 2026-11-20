# Jira product event intake — ticket 22

## Current policy — Epic-only update reasons (2026-11-20)

The user explicitly chose to ignore child-only changes as reasons to update an
Exchange. **Only an `avi:jira:updated:issue` whose issue identity exactly matches
the registered Subject Epic triggers republishing.** Child creation, edits,
deletion, and reparenting do not select either parent Epic. Source-Epic deletion
remains unsupported. Initial or repeated authorized `exchange.start` still
regenerates the complete eligible document, as does a selected Epic update;
child data is not removed from the document format or export behavior.

Child titles and membership can remain stale indefinitely until an Epic update
or explicit Exchange start. A read-only export may show newer child information
without updating retained/published content. No polling, background
reconciliation, prior-parent retention, or child-created search consistency fix
is introduced. This limitation is stated in the README, admin connection guide,
and Search guide. It is an application policy, not a claim that Jira emits no
child events.

The local implementation removes parent lookup and retained-child routing and
subscribes only to issue updates. Tests cover ignored child create/update/delete
and reparenting payloads, exact Subject matching, retained-principal delegation,
and regeneration of child snapshot content on a later Subject update. No scope,
egress, Command, or document-format change is needed. **This policy change has
not been deployed or cloud-verified.** The earlier installed successes/failure
below describe the superseded child-triggering implementation and are preserved
as historical evidence, not current acceptance requirements. MSD-20 remains an
adopted fixture; no cleanup is requested.

Local verification of this revision: `npm run check` passes **244 tests in 14
files**, type checking, Forge lint, build/format/contract checks, and a
**26.49 kB / 32 kB** bundle. README, admin/Search guides, and this evidence page
pass Markdown lint. Broader glossary/spec lint still reports existing long
lines; unrelated formatting and user edits were preserved.


## Historical local implementation (2026-11-20, before Epic-only decision)

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

## Installed read-only verification — 2026-11-20 08:49 local

After the user reported deployment and authorized installed-app verification:

- Forge installation list reports development Jira major **7 (Latest)**,
  app version **7**, **Up-to-date**. This reports installation state, not a
  source-commit fingerprint or proof of trigger execution.
- SecretSpec-backed deployed suite, filtered to authenticated discovery and
  export only: **3 passed / 3 skipped** in about 10 seconds. Discovery matches
  the local approved contract; the company-managed known-value export passes;
  the team-managed scenario returns its independently expected eligibility
  denial. Skips are two previously deferred secured/unreadable Epic cases and
  the deliberately excluded Exchange-start case (which writes/ingests).
- Sanitized development log read: 1351 bytes, four recognized RPC completion
  records: unauthorized request (401), two successes (200), and expected
  eligibility denial (-32006 over HTTP 200). No runtime-error markers or Jira
  event-intake records were observed in this bounded read. The read ran
  concurrently with the tests; no claim of exhaustive invocation correlation.
- No Exchange start, storage write, ingestion request, Jira edit/create/delete,
  deployment, installation, or upgrade was performed. Event subscriptions,
  offline-principal generation, child routing, and resulting TWG Publication
  remain unverified on the installed platform.

Next verification needs explicit approval for Exchange registration/ingestion
and an operator-approved reversible Jira fixture mutation, followed by status
and document reads without another manual start masking the event outcome.

## Approved installed Epic-summary event verification — 2026-11-20 08:55 local

The user explicitly authorized starting the configured test Exchange, a reversible
Epic edit, observing automatic Publication, and restoring the original content.
The SecretSpec-backed targeted check **passed in 35.5 seconds** on the existing
development installation:

| Stage | Retained sequence | Published sequence | Independent content check |
| --- | --- | --- | --- |
| Initial authenticated Exchange start | 1 | 1 | Baseline established |
| Temporary Epic summary edit | 2 | 2 | Retained title matches the temporary source summary |
| Original Epic summary restored | 3 | 3 | Source reread equals original; retained title matches original |

Only the initial baseline called `exchange.start`. Neither changed nor restored
Publication was induced by a later manual start. Subsequent calls were reads
of `publication.status` and `document.get`, bounded to 65 seconds per stage;
no scheduled polling or reconciliation was added to the app. The test changed
only the configured Epic's summary and verified restoration in a `finally`
block with a concurrent-edit guard. No child was created, edited, deleted, or
reparented. Jira edit history, sequence 3, and the credential-free Exchange
registration remain as expected verification effects.

A follow-up sanitized development log read returned 6526 bytes, including two
`workdown.jira-change.completed` records, each `attempted: 1, failed: 0`, plus
two recorded acknowledgment-storage and two recorded notification-storage
outcomes. No runtime-error markers were found in that bounded read. Raw event
payloads, source content, account IDs, URLs, and credentials were not printed
or retained as evidence. Temporary test and recovery files were removed after
source restoration was verified.

This establishes installed Jira issue-update intake for this Epic-summary
change, generation under the retained principal through the configured offline
read adapter, and final acknowledged TWG Publication for both edit and
restoration. It is stronger than peer-adapter handoff. It does not establish
Search indexing latency, external notification consumption, raw event payload
shape, every included field, child events, reparenting/deletion, permission or
principal changes, non-contributor impersonation, or actual remote-peer delivery.
Ticket 22 remains open for those named coverage/decision gates; automatic
freshness is not generally proven by this one successful scenario.

## Approved installed child checks — 2026-11-20 10:30–10:32 local

The user approved an edit/restoration of configured child MSD-5 and creation
and deletion of one disposable child under MSD-1. Reparenting was not approved.
The targeted installed check **failed overall** in 108.6 seconds:

| Stage | Retained / published | Result |
| --- | --- | --- |
| Initial Exchange baseline | 3 / 3 | Established before mutations |
| MSD-5 temporary summary edit | 4 / 4 | Automatic Publication; retained child identity/title match |
| MSD-5 original summary restored | 5 / 5 | Automatic Publication; source summary independently restored |
| Disposable child MSD-20 created under MSD-1 | 5 / 5 | No changed Publication within 65 seconds |
| Delete only the newly created MSD-20 | Not reached | Jira DELETE returned HTTP 401; cleanup blocked |

Follow-up read-only checks confirm MSD-5 still belongs to MSD-1 and its original
summary is restored. **MSD-20 still exists**, with its exact test-created identity,
parent, and synthetic summary verified. Jira child search returns MSD-5 and
MSD-20, while retained document sequence 5 includes MSD-5 but omits MSD-20.
This is an observed source/destination freshness failure, not merely an
unverified case. No manual Exchange start was used after any mutation to mask it.

A bounded sanitized log read returned 10867 bytes: four Jira-change completions,
each `attempted: 1, failed: 0`, and four publication records corresponding to
two acknowledgment-storage and two notification-storage outcomes. Without
payload/type/identity correlation these counts do not establish which event
caused each completion, nor why creation failed. Search visibility/event timing
is a hypothesis, not an established root cause. No fix, retry mutation,
reconciliation, new deployment, or instrumentation was applied.

The same principal's project permissions report CREATE_ISSUES, EDIT_ISSUES,
and DELETE_ISSUES all true, but the actual API DELETE returned 401. Credential
scope/endpoint authorization is a possible cause, not proven. The test stopped
writes and did not attempt another authentication route. **Operator action is
required to delete MSD-20**, or securely update the test token with appropriate
scope and authorize a guarded cleanup retry. Do not paste credentials in chat.
Deletion-event Publication is still unverified, and deleting a child never
retained in sequence 5 cannot by itself prove retained-prior-parent routing.

Expected residual effects are Jira history, sequences 4/5, the Exchange registry,
a consumed issue key, and the still-existing disposable MSD-20 until cleanup.
The temporary verification script and detailed recovery file were removed after
recording the outstanding cleanup here and on ticket 22; original source content
and credentials are not retained in this evidence. A separate user modification
to ADR 0003 was left untouched.

### Fixture disposition — 2026-11-20 10:42 local

The user chose to **keep MSD-20 as a fixture**. Cleanup is no longer requested;
future checks must not delete it under the earlier disposable-child approval.
Read-only child search reconfirmed MSD-1's native-ID lexical child order as
MSD-5, MSD-20. The private `test/deployed.local.json` expected child list was
updated accordingly; no Jira mutation or Exchange start accompanied adoption.
The earlier cleanup-failure notes above describe the historical attempt, not
an outstanding request to delete the adopted fixture. Keeping it does not
resolve the automatic-creation Publication failure or prove deletion behavior.
The read-only company-managed deployed export test passed with both expected
children (1 passed, 5 filtered/skipped; 6.3 seconds). This proves the on-demand
export now sees MSD-20, not that the retained Publication was repaired; no
manual Exchange start or ingestion was invoked.

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
