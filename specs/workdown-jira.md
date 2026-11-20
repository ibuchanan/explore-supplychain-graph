# Workdown Jira mapping and profile

This document contains Jira-specific profile rules, identity construction, and
implementation research extracted from [workdown-spec.md](workdown-spec.md). The
Explore Jira Epic profile's disclosure allowlist and child-inclusion rules were
approved on 2026-11-15 by Ian Buchanan; approval and implementation readiness are
documented separately. See [ADR 0002](adr/0002-workdown-disclosure-boundary.md)
for the disclosure decision, [Event and ingestion implementation
gates](#event-and-ingestion-implementation-gates) for research findings, and
[workdown-spec.md](workdown-spec.md) for the core format. Remaining
implementation gates and field-mapping resolution are documented below as
research findings, distinct from the approved profile. Approval does not satisfy
the implementation gates or settle the byte and child-count numeric limits,
which must be confirmed by deployed verification before the converter ships.

## Accepted Decisions (2026-11-15)

The following decisions have been approved by Ian Buchanan and adopted for implementation:

1. **Start date discovery:** Enumerate all accessible field catalog pages, select a unique match by `stableId: sfid:jira-software:start-date` with compatible date schema, and use the returned site-local ID to read values. Schema mismatch or multiple matching candidates must fail rather than trigger a display-name fallback.

2. **System parent relationship:** Use the system `parent` relationship to enumerate direct Epic children; do not fall back to legacy Epic Link for any project type.

3. **Numeric ID stability across project moves:** Accept that Jira retains an issue's numeric ID when an issue moves between projects, enabling `source_id` stability across key and resource changes within the same site. Site migration is outside implementation scope.

These decisions are implementation-ready; verification gates below remain open for integration testing (export tickets 03–08).

## Targeted project field lookup — 2026-11-20

The user approved replacing the second full catalog scan with an exact-ID,
project-filtered lookup. Initial site-wide stable-ID discovery and uniqueness
checks remain unchanged. The project query now combines `id=<resolved local ID>`,
`projectIds=<issue project ID>`, and `expand=stableId`. The current field-search
API contract documents these parameters together. Complete-response validation,
compatible schema, matching semantic identity, and caller credentials remain
required; no caching, name matching, or extra permissions are introduced.

The public authenticated `workdown.export` regression was observed failing before
the query change and passing afterwards: the project HTTP boundary accepts only
the resolved ID and returns the independently expected date with one request.
Existing pagination, absence, ambiguity, schema, request-failure, and cross-ID
fixture coverage remains. After the user reported deployment and authorized an
installed-app check, the SecretSpec-backed discovery/export selection passed on
2026-11-20: three tests passed in 10.87 seconds. Discovery authentication and
contract equality passed; both configured exports passed exact populated-date or
explicit omission expectations, document validation, child/description checks,
and the disclosure allowlist. Project-type labels are operator supplied.
This verifies the installed export path after deployment; live HTTP query/count
telemetry was not captured. Exchange-start/ingestion tests were excluded, and
unavailable negative Epic fixtures remain skipped. No credentials, URLs, issue
keys, dates, or documents were printed.
Create/edit metadata is not substituted: neither documents `stableId`, and their
create/edit permission and screen/workflow rules differ from readable export data.
This section supersedes earlier references to a second full project catalog scan.

## Jira metadata research findings

Research status as of 2026-11-15: field and parent-relationship probing is
complete. The accepted decisions above guide implementation; runtime validation
belongs to the converter's acceptance tests.
These findings record a read-only comparison of Epic creation metadata for one
company-managed software project and one team-managed software project on a
single Jira Cloud site. Site and project identifiers, field IDs, and source
content are intentionally excluded. The observations below are self-contained;
no private response capture is required to understand them. They are observations
of that sample, not guarantees for all Jira configurations.

### Observed field shapes

| Semantic field | Company-managed sample | Team-managed sample | Interpretation |
| --- | --- | --- | --- |
| Start date | `schema.type: date`; `schema.custom: com.atlassian.jira.plugin.system.customfieldtypes:datepicker` | Same schema and same site-local field ID | Generic date-picker schema; not a unique Start date identifier |
| Target start | `schema.custom: com.atlassian.jpo:jpo-custom-field-baseline-start` | Not returned | Distinct field; not an approved substitute for Start date |
| Legacy Epic Link | `schema.custom: com.pyxis.greenhopper.jira:gh-epic-link` | Not returned | Presence in creation metadata does not verify child discovery semantics |
| Legacy Parent Link | `schema.custom: com.atlassian.jpo:jpo-custom-field-parent` | Not returned | Not evidence for the system `parent` relationship |

The compared command returns custom-field creation metadata, not a complete
field catalog or an issue read. A field missing from this response is not proven
absent or unreadable. In particular, the absence of system `parent` from this
custom-field listing says nothing about support for that relationship.

**Start date identification:** The generic date-picker schema does not uniquely
identify Start date. Use the accepted stable-ID discovery rule above, verified
by the expanded metadata and catalog enumeration below. Display-name-only
matching, hard-coded field IDs, and substitution of Target start remain
prohibited.

### Expanded Start date metadata

A follow-up read of Jira's paginated field-search endpoint, requesting
`expand=stableId,isLocked,searcherKey` for the previously discovered field,
returned one result and explicitly reported `isLast: true`. The result exposed:

| Property | Observed value |
| --- | --- |
| `stableId` | `sfid:jira-software:start-date` |
| `schema.type` | `date` |
| `schema.custom` | `com.atlassian.jira.plugin.system.customfieldtypes:datepicker` |
| `isLocked` | `true` |
| `searcherKey` | `com.atlassian.jira.plugin.system.customfieldtypes:daterange` |

Unlike the generic date-picker schema, the returned `stableId` names the Jira
Software Start date semantic field. It is the discovery discriminator, not a
site-local numeric field ID or display-name match. The locked status and date
schema provide additional observed characteristics; neither alone uniquely
identifies Start date.

The initial request looked up an already known field ID. A subsequent catalog
query supplied neither a field ID nor a display-name filter and requested the
same metadata expansion. All returned pages were collected: offsets were
contiguous, totals were consistent, no duplicate local field IDs were observed,
and the final page explicitly reported `isLast: true`. Exactly one field in the
captured accessible catalog had `stableId: sfid:jira-software:start-date`, with
the compatible date schema and locked status shown above. Its returned local ID
matched the field in the earlier project samples.

This verifies ID-independent discovery in the sampled accessible catalog. The
resolver shall enumerate all accessible pages, select a unique stable-ID match
with a compatible date schema, and use its returned site-local ID to read values.
Schema mismatch or multiple matching candidates must fail rather than trigger a
display-name fallback.

The [field-search API contract](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-search-get)
documents the `stableId` expansion and describes this endpoint as returning
fields for classic projects. The observation does not establish universal
coverage of team-managed project-local fields. Cross-site equivalence with
independently configured sites and full authorization/applicability verification
remain open for integration testing (export tickets 03–08).

### Field metadata permissions and authorization

Official API-contract review found inconsistent permission descriptions. Ian
Buchanan confirmed on 2026-11-15 that the account used for the successful browser
captures is not a Jira administrator on the sampled site. Combined with the
complete catalog capture, this provides a positive example of non-admin browser
access to `stableId` metadata. Forge-runtime authorization remains an
integration test gate (export tickets 03–08).

- [Paginated field search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-search-get)
  supports `expand=stableId`, describes classic-project fields, and lists
  "permission to access Jira" as a requirement. Its documented `403` example
  says only Jira administrators can access fields. Test the eventual app access
  mode and a representative non-site-admin sharing principal to establish the
  actual authorization boundary (export tickets 03–08).
- [Get fields](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/#api-rest-api-3-field-get)
  documents no required permission but returns a visibility-filtered catalog
  under field/configuration and Browse Projects rules. Its documented response
  does not expose `stableId` and has no expansion parameter. It is not a
  documented alternative for semantic stable-ID discovery.
- OAuth scopes and Jira permissions are separate requirements. The reviewed
  contracts list classic scope `read:jira-work`; granting that scope does not
  establish the caller's Jira permissions. The app manifest has not changed.

A successful site-level semantic mapping is not authorization to disclose issue
values or proof that the field applies to every project. Reads must obey
this profile's sharing-principal and eligibility boundary. A missing field in a
visibility-filtered response is not sufficient evidence of known absence.

### Resolution states to preserve

- **Known absent:** authoritative metadata and the supported mapping establish
  that an optional semantic field is not configured or applicable. Omit it.
- **Ambiguous or unresolved:** the available metadata cannot uniquely establish
  the supported semantic field, whether because candidates compete or a semantic
  discriminator is missing. Fail conversion; do not guess.
- **Unreadable:** an authorization failure, request failure, or incomplete
  response prevents determining the field or reading its value. Fail conversion;
  do not reclassify it as absent.
- **Resolved but unset:** the semantic field is identified and readable, but its
  value is empty. Omit the optional value, without treating the field as absent.

These are required distinctions, not claims that creation metadata alone can
classify them. Exact API evidence for distinguishing the states remains to be
established.

### Observed parent relationships

Read-only issue queries on the same site found ordinary, non-subtask issues
whose system `parent` object identifies an Epic (`hierarchyLevel: 1`) in both
management types. Follow-up JQL queries of the form `parent = <epic-key>` returned
children in each sample; every returned issue pointed back to the queried Epic
and was a non-subtask. This establishes positive examples of system-parent reads
and direct-child query support in both sampled configurations. It does not prove
complete enumeration, permission completeness, or support across all sites.
Pagination behavior remains to be verified separately.

The company-managed sample also included an Epic whose system parent was an
Initiative (`hierarchyLevel: 2`). A populated `parent` alone therefore does not
establish an Epic-child relationship: inspect the parent type and hierarchy,
and keep the approved exclusion of the Epic's own parent unchanged.

These observations support using the system `parent` relationship rather than
requiring legacy Epic Link for the sampled configurations. The follow-up
comparison below checks legacy-field values and query behavior in one sample;
it does not establish synchronization or deprecation guarantees.

### Observed legacy Epic Link compatibility

For one company-managed Epic, read-only queries using system `parent` and the
site-resolved legacy Epic Link field were both accepted and returned identical
issue-identity sets. The legacy field was explicitly present in the returned
issue records, and its value matched each record's system `parent` key. This is
an observed agreement between two query forms and returned field values in one
configuration, not merely an inference from creation metadata.

The saved query responses provide no explicit pagination-completion metadata;
a successful response and a requested page size do not establish complete child
enumeration. The comparison does not test reparenting, stale legacy values,
field synchronization, legacy-only relationships, team-managed legacy behavior,
or product-wide deprecation guarantees. It does not establish that legacy
queries and system-parent queries are universally equivalent.

The approved system-parent rule and prohibition on legacy Epic Link fallback
remain unchanged. A site-local legacy field identifier is evidence for this
comparison only, not a portable mapping or an implementation constant.

### Integration and acceptance test gates (export tickets)

The following verification gates remain open for implementation acceptance testing:

- Start date portability and integration (ticket 04; revised by user approval
  2026-11-17): retain local equivalent-content fixtures with different field IDs,
  and verify the installed export on one approved site against a known populated
  Start date. A second site is not required. Record the project type exercised;
  cover both types on the same site where practical, or explicitly retain the
  untested type as a compatibility limitation rather than claim coverage.
- Parent relationship completeness: extend system-parent examples to verify
  pagination and complete direct-child enumeration under the approved permission
  boundary for both company-managed and team-managed projects.
- Resolver authorization: test the eventual app access mode and a representative
  non-site-admin sharing principal to establish the actual field-catalog
  authorization boundary.
- Field resolution error states: establish reproducible evidence for
  known-absent, ambiguous, unreadable, and resolved-but-unset fields; document
  distinct expected outcomes. Record sanitized outcomes here, not internal source
  content or private response dumps.
- Full pagination under page-limit constraints: verify that catalog and child
  queries complete successfully under both fixed and variable page sizes.

## Explore Jira Epic profile

### Disclosure allowlist (approved 2026-11-15)

Use an Epic as the primary item and produce one document. Include only:

| Semantic content | Jira mapping | Workdown location |
| --- | --- | --- |
| Source identity and URL | Installation cloud ID, immutable issue ID, current key and canonical browse URL | `source_id`, `key`, `resource` |
| Summary and type | `summary`, `issuetype.name` | `title`, `work_type` |
| Description | `description` ADF | Description section |
| Workflow state | `status.name`, supported Jira status category | `work_status` |
| Resolution and priority | `resolution.name`, `priority.name` | `resolution`, `priority` |
| Labels | `labels` | `tags` |
| Source timestamps | `created`, `updated` | `created_at`, `updated_at` |
| Planned dates | Semantic Start date, system `duedate` | `start_date`, `due_date` |
| Direct child summaries | Parent relationship and the child-record allowlist | `children` and Children table |

The Explore profile does not emit `parent` for an Epic. Whether to disclose an
Epic's own parent is a disclosure decision that needs separate approval.

Resolve semantic custom fields using Jira's field metadata/schema and product
semantics, never a hard-coded numeric ID or display-name match alone. Two sites
with different field IDs MUST produce equivalent semantic content for otherwise
equivalent fixtures. A known absent optional field is omitted. If a supported
field cannot be resolved unambiguously, fail conversion rather than select a
similarly named field. For Start date, apply the accepted stable-ID rule above;
verify project-type coverage in the converter's implementation tests.

Exclude comments, attachments, changelogs, worklogs, people fields, emails,
watchers, votes, arbitrary custom fields, issue links, remote links, sprints,
estimates, and all other fields not explicitly listed. Text already embedded
in an allowed description is still disclosed; a field allowlist is not PII or
secret redaction. Source administrators must understand that boundary.

### Ticket 04 implementation evidence (2026-11-16)

Local Command tests use caller-token HTTP fakes, including full catalog
pagination with `expand=stableId`, a second project-filtered catalog, and a
separate issue read requesting only the resolved site-local Start date ID.
All catalog and issue calls use the authenticated caller's credential, never
app-level access. Catalog errors, missing stable-ID metadata, inconsistent
pagination, and missing requested values fail with `field-unreadable`;
ambiguous or incompatible mappings fail with `field-unresolved`.

Ian Buchanan approved omission of `start_date` for zero matches in a complete
authoritative catalog on 2026-11-16. A resolved empty value is also omitted.
No display-name or numeric-ID fallback exists. The current development gate
requires Jira ADMINISTER; non-admin project-sharing behavior is not verified.
Synthetic fixture files with different custom IDs produce identical bytes when
site/issue identity and all semantic data are held constant. Actual different
sites intentionally produce different `source_id` values.

**Current status — complete 2026-11-17:** The user reported development 3.3.0
deployed and the installation on one-atlas-devb.atlassian.net current. The
subsequent authorized structured deployed suite passed all three tests in
12.10 seconds (exit 0): authenticated discovery, an exact populated Start date
export, and an explicit Start date omission export. Both exports passed document
validation, issue-key matching, and the metadata disclosure allowlist. No issue
keys, dates, documents, credentials, or private endpoint URLs were printed.
Latest local `npm run check` passes (114 tests; 11.4 kB / 32 kB; Forge lint clean).
This satisfies ticket 04's revised single-site acceptance gate.

The scenario configuration declares company-managed for the populated-date case
and team-managed for the omission case. Project-type labels are operator supplied,
not independently verified by the harness. The omission case does not establish
populated Start date support for all team-managed projects, and one site does
not establish universal compatibility. Cross-ID portability remains locally
tested. The Jira ADMINISTER development gate remains; non-admin authorization
and issue security are ticket 05 work. No storage or publication is claimed.

Earlier failed runs and local-only statuses below are historical and superseded
by this passing run; they are retained to explain the corrections.

**Revised cloud gate — approved 2026-11-17:** One approved site is sufficient.
Existing local fixtures exercise equivalent content with different field IDs;
a second installation is not required. Choose an Epic with a known populated
Start date and declare its key, project type, and independently known
`expected.start_date` in `test/deployed.local.json`. The structured scenario
replaces issue-selection and expected-date environment variables. Every scenario
requires an expectation: a date asserts its exact value; null requires omission.
Ticket 04 acceptance needs at least one populated-date scenario, not only null
cases. The deployed test must also pass document validation, key matching, and
the disclosure allowlist check without printing the document. Only connection
details and credentials remain in SecretSpec; scenario data is Git-ignored.

Record the project type exercised and sanitized results here. Exercise both
company-managed and team-managed Epics on the same site where practical;
otherwise explicitly record the unverified type as a compatibility limitation.
The project-filtered field-search response is treated as authoritative only
under the current Jira-admin development gate, not as proof of visibility
completeness for general sharing callers. The endpoint documents classic-project
coverage; if a run omits a configured field or contradicts this mapping, stop
and revise the profile rather than accept silent omission or introduce a
name-based fallback. A syntactically complete response alone does not establish
universal project-type coverage. Non-admin authorization remains ticket 05 work.

### Schema-less system fields: diagnosed and corrected locally (2026-11-17)

The user's structured deployed run passed discovery but both export scenarios
returned -32004. A read-only diagnostic using the configured caller found both
issues readable (HTTP 200), but the global and project-filtered field catalogs
contained unrelated system entries without `schema`. The catalog validator
rejected those entries before Start date resolution. Only status and shape
summaries were emitted; no credentials, issue content, or endpoint URLs were
recorded. This establishes a metadata-validation blocker, not the absence of
additional downstream failures.

The local correction permits omitted schemas on unrelated system fields while
retaining custom-field schema checks and strict Start date candidate validation.
A paginated regression reproduces the original failure and now verifies the
exported date. `npm run check` passes (114 tests; 11.4 kB / 32 kB). This correction
has not been deployed or cloud-verified; rerun the structured deployed scenarios
after an approved deployment before claiming either project's export succeeds.

### Authorized ticket 04 installed-app rerun (2026-11-17)

The configured SecretSpec-backed deployed test was run with user approval.
One test failed in 6.82 seconds: `workdown.export` returned JSON-RPC -32004
(`field-unreadable`). Response bodies, documents, credentials, and URLs were
suppressed. The expected-date environment variable was unset; no positive
Start date assertion or project-type coverage was established. The public
error code does not identify the failing metadata/value read; root cause is
not yet established. This is a failed cloud smoke, not ticket acceptance.
No deployment, installation, or live-data writes were performed. Diagnose the
read failure and configure an independently known populated expected date
before rerunning the single-site acceptance gate.

### First ticket 04 cloud failure and correction (2026-11-16)

The user deployed development 3.1.0 and confirmed the installation was current.
The first deployed test failed before the expected Start date assertion.
Sanitized structured log readback showed JSON-RPC `field-unreadable` (-32004).
Read-only caller-token diagnostics found all requested scalar fields present,
but 38 unrelated custom fields on the first catalog page lacked `stableId`.
Rejecting the whole catalog for those unrelated omissions was too strict.

The corrected parser tolerates unrelated missing discriminators when there is
a unique positive semantic match. It still fails zero-match inference as
`field-unreadable` when custom fields lack semantic metadata. Positive matches
must retain compatible schema and project applicability; no name fallback was
introduced. A regression test reproduced the cloud shape red, then passed.
Full read-only enumeration found 274 site fields across six pages and 243
project-filtered fields across five pages, each with one compatible Start date
match. No IDs, issue values, credentials, or documents were printed or saved.
This is direct Jira-read evidence for the configured site, not a passing
installed-app export or two-site/team-managed coverage. Redeployment and the
installed integration rerun remain pending approval.

### Extension fields

The Jira profile adopts no extension fields in this draft. Candidates
such as sprint or story points need explicit disclosure approval first, with the
same rigor as core-field additions. Adoption in a profile does not change
`format_version` in the [core specification](workdown-spec.md). If an extension
field is adopted in a future revision, it MUST be listed here with its meaning,
source field, and type; use semantic names and never emit Jira field identifiers
such as `customfield_10042` as keys.

### Jira identity mapping

A Jira producer uses the issue's Atlassian Resource Identifier
([ARI](https://developer.atlassian.com/platform/teamwork-graph/understanding-aris/))
as `source_id`: `ari:cloud:jira:<cloud-id>:issue/<issue-id>`, built from the
site's cloud ID and the immutable numeric issue ID, never the key. A Jira key
alone is insufficient: keys can change and can collide across sites.

`key` and `resource` MAY change without changing `source_id`. These are source
identities, not TWG or Exchange document IDs.

Consumers MUST treat `source_id` as an opaque string compared by exact equality
and MUST NOT parse it to recover the cloud ID, issue ID, or product. Producers
MUST emit the ARI as Atlassian documents it, with no added normalization.

**Accepted project premise (2026-11-15):** Ian Buchanan asserts that Jira retains
an issue's numeric ID across project moves. The Supplychain Graph accepts this
premise without requiring a live move experiment. Within the same site, a
project move can therefore change `key` and `resource` without changing
`source_id`. This is an accepted assertion, not an experimentally verified
finding. Site migration is outside the Supplychain Graph's scope and is not an
implementation or research prerequisite.

### Child inclusion and permission boundary (approved 2026-11-15)

Rule: include all direct children returned through the current Jira
parent relationship, including completed children; no recursion, subtasks of
children, linked issues, or legacy Epic Link fallback unless separately approved.
Resolve the supported relationship per project type before implementation.
Sort by immutable native issue ID in lexical order, not mutable keys or rank.
Do not invent a child count or claim global completeness from a filtered query.

Only the authorized sharing principal's readable Epic and children may be
considered. App-level access alone MUST NOT authorize disclosure. Exclude items
with issue-level security from this initial profile; fail an attempt to share
such a primary item. The mechanism for determining eligibility must itself be
verified for supported project types; uncertainty is a failure, not permission.
Do not expose excluded item identities, titles, counts, or exclusion reasons in
the shared document. All permitted direct children must be read and paginated
successfully; an interrupted listing is not a valid smaller snapshot.

Destination visibility remains unrestricted as agreed in the parent spec.
Eligibility checks do not replicate source permissions or revoke copies already
shared. Source permission changes and missed events can leave stale content;
the parent spec's withdrawal and freshness limitations still apply.

### Ticket 05 eligibility evidence and remaining gates (2026-11-18)

The local Command now explicitly requests `security` with `failFast=true`, using
only the authenticated principal's Jira credential. HTTP 401/403/404 return the
same `forbidden` error. A readable Epic with a numeric security-level ID returns
`issue-ineligible`; absent, malformed, failed or undecodable security reads return
`eligibility-undetermined`. Neither error includes source content. Only an
explicit null security value in a characterized project type permits generation.
No app credential or fallback authorizes disclosure. The OpenRPC contract is
unchanged.

Read-only, SecretSpec-backed Jira REST probes on the existing site observed:

- Company-managed software Epic: HTTP 200, explicit `security: null`, security
  schema `{type: securitylevel, system: security}`, `simplified: false`;
  separate project read reports `style: classic`.
- Team-managed business Epic: HTTP 200, the same null security/schema shape,
  `simplified: true`; separate project read reports `style: next-gen`.
- Readable company-managed secured subtask: HTTP 200, security object with a
  numeric string ID, name, description and self link. This establishes an object
  shape, **not** secured-Epic or direct-child acceptance. The bounded
  `level is not EMPTY AND issuetype = Epic` search returned zero visible items;
  that says nothing about items hidden from this principal.

Sanitized structural projections (identities and content removed/replaced) are
in `test/fixtures/workdown-export/security-characterization.json`. Null is not
inferred from absence. Team-managed secured-item behavior is unverified, so
team-managed and unknown project shapes fail closed. Company-managed null/object
handling has local coverage and real REST shape evidence, but still needs the
secured-Epic and unreadable-Epic installed-app acceptance cases. These
restrictions do not relax ADR 0002 or declare every classic project verified.

**Ticket 22 local implementation (2026-11-20):** principal retention and offline
user reads are now implemented, with installed verification still pending. See
[Jira product event intake](workdown-jira-events.md) for routing, explicit
freshness limitations, scope review, and remaining approval-gated checks. This
supersedes the historical statement below that no principal is persisted.

**Republishing decision:** retain the sharing principal's account ID with a
future Exchange, never the request API token. Every later publication must
re-read the Epic and complete eligible children under that principal's current
permissions. If a supported user-authorized execution mechanism is unavailable,
fail closed; event-triggered app access cannot replace it. Account replacement
requires fresh authorization. The republish-on-change work must implement and verify that mechanism
before automatic republishing is usable. No principal is persisted by this
stateless export ticket.

No event subscriptions were added and no permission/security mutations were
performed. Usable events for security-level, permission or principal changes
remain unverified; do not assume events cover every eligibility change. Child
listing remains ticket 06, and automatic publication remains gated by the republish-on-change work.

**Verification boundary:** local authenticated webtrigger tests cover eligible,
ineligible, forbidden, and indeterminate outcomes, caller credential routing,
malformed/failed reads, and content-free denial logs. The existing installed-app
suite ran read-only: 1 passed, 2 failed (discovery contract drift and the old
team-managed handler succeeding instead of the new expected -32006). This is a
pre-deployment red gate, not acceptance of the new handler. A development log
read returned no records; new cloud invocation/log evidence is still pending.
No deployment, installation, scopes, egress or manifest changes were made.
Ticket 05 remains incomplete and does not unblock ticket 06 until the remaining
acceptance evidence is recorded after separately approved release work.

### Ticket 05 installed-app rerun (2026-11-18)

After the user reported development 3.4.0 deployed and the installation current,
the authorized SecretSpec-backed deployed suite passed **3/3**: authenticated
discovery matches the approved local contract, company-managed export matches
the independent populated Start date, and the team-managed case returns
`eligibility-undetermined` (-32006) without a document. This verifies installed
behavior despite the pasted deployment timestamp preceding the local commit;
the timestamp alone is not evidence of which source revision was packaged.
A sanitized development log read returned 995 bytes containing three completion
records and no RPC error codes; it ran concurrently with the suite and is not
claimed as correlated readback of all three new test invocations.

This supersedes the earlier pre-deployment red result for these scenarios only.
Secured-Epic and known-unreadable-Epic installed-app scenarios, team-managed
secured detection, and eligibility-change event behavior remain unverified.
Ticket 05 remains open and ticket 06 remains blocked. The agent performed no
deployment, installation or live-data mutation.

### Deferred negative Epic scenarios (user-approved 2026-11-18)

The user deferred the secured-Epic and unreadable-existing-Epic deployed checks.
Both remain executable test bodies registered with `it.skip.each` in the deployed
suite, using aliases `readableSecuredEpic` (-32005) and `unreadableEpic` (-32001).
To enable them, configure independently verified fixtures under those aliases in
`test/deployed.local.json`, then remove the explicit skip. Do not substitute a
nonexistent key for an independently known unreadable Epic.

Read-only dataset discovery found five hierarchy-level-1 issue types, no readable
secured Epics across those types, and 67 readable secured non-Epics (49 standard
issues, 18 subtasks), all company-managed. The visible project catalog contained
24 projects; it cannot establish hidden Epic existence. Skipped checks remain
unverified, not passing evidence. Runtime fail-closed rules and active local
security tests are unchanged. Other outstanding acceptance gates remain as above.

### Ticket 05 closed with recorded gaps (user decision 2026-11-18)

The user closed ticket 05 as sufficiently complete and no longer a blocker for
ticket 06. This supersedes "remains open" and "remains blocked" above. Closure
is a scope decision, not new evidence. Still unverified, and not cleared for
operational use: secured-Epic and unreadable-Epic installed-app behavior,
team-managed secured detection (such exports keep failing closed as
`eligibility-undetermined`), and eligibility-change event behavior.

### Direct-child export implementation (ticket 06, 2026-11-18)

The export now enumerates `GET /rest/api/3/search/jql` with bounded JQL
`parent = <immutable Epic ID>`, the caller's verified credential, an explicit
summary-field allowlist, and `failFast=true`. It follows continuation tokens
until an explicit `isLast: true`; absent or contradictory completion metadata,
repeated tokens, warnings (including possible truncation), failed responses,
and invalid child values fail the entire candidate as `children-unreadable`
(-32007). Page size is a request hint, never evidence of completion.
The endpoint's permission filtering omits unreadable items; no extra app-level
read or inferred count is used. Search is eventually consistent, not an atomic
snapshot: recent changes or concurrent reparenting are not guaranteed visible.

Readable secured children are silently excluded. Other candidates must have
explicit null security, a verified company-managed project, the expected system
parent, and a non-subtask issue type. Uncertain eligibility fails the candidate;
team-managed detection remains gated as recorded in ticket 05. Included children
sort by native issue ID lexically, carry only the child-record allowlist, and
have matching ordered `sources` records and a canonical Children table. Child
modification times and descriptions cannot affect canonical bytes. Epic exports
omit `parent`; the format validator accepts standalone parent records and rejects
primary/parent/child identity collisions and table/metadata disagreements.

Evidence: local authenticated-Command tests cover zero, one and several children,
pagination splits/order, completed status/resolution, escaping, secured-item
omission without log disclosures, malformed/failed pages, and invalid identities.
The existing deployed harness now requires independently supplied ordered child
keys (`expected.children`, including an explicit empty list) for success cases.
No new app endpoint, manifest, scope, egress, storage, or dependency change is needed.

Not yet verified for ticket 06: the implemented enhanced-search pagination and
security payload on the installed app, a deployed child export, and sanitized
cloud log readback. Prior system-parent observations above establish positive
relationship examples in both project types, not new runtime evidence. Deployment
and installation are not authorized by this implementation task. Existing local
cloud scenario files require independent child expectations before the suite can
run; do not derive expectations from the export being checked. Missing standard
dataset cases remain explicit gaps, not a requirement to manufacture test data.

API reference inspected for the implementation:
[Jira enhanced JQL search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get).

### Rich-description export implementation (ticket 07, 2026-11-18)

The authenticated `workdown.export` Command now renders ADF v1 through the
closed rich-text inventory in the format specification. Local Command tests
compare independent golden Markdown fixtures and validate the resulting full
Workdown document. They cover all heading levels, nested lists/quotes/tables,
inline formatting, adaptive code fences, Unicode and code whitespace, safe and
rejected links, supplied mention text, media/unsupported omission, and attempted
HTML. Titles and child table cells also preserve literal HTML entity text.
Unknown nodes are not traversed, and no profile, media, smart-link or linked-page
lookups were added.

The shared installed-test scenario now requires `expected.description` for
successful exports: an independently established, LF-only Markdown description
without the section heading or final document newline. The example scenario
shows a mix of heading, list, link and media output; it is illustrative, not a
claim about any private live issue. Existing private successful scenarios must
be updated before running the installed suite. Missing expectations fail before
cloud calls; result comparisons suppress private content.

**Evidence boundary:** all renderer behavior above is locally verified. No app
was deployed or installed for ticket 07; mixed-node real Jira export and cloud
log readback remain unverified and require approval plus a known-value scenario.
No modules, scopes, egress, storage, or dependencies changed. The OpenRPC example
now includes the rich Description section and canonical child-label escaping,
and is checked with the public document validator.

### Ticket 08: export limits and atomic failure (2026-11-18)

The approved `workdown.export` contract adds non-retryable
`document-too-large` (-32008) and `too-many-children` (-32009). The provisional
caps and platform-source rationale are recorded in
[the format specification](workdown-spec.md#provisional-explore-export-limits):
262144 canonical UTF-8 bytes and 100 eligible direct children, inclusive.
Only eligible children consume the count allowance, accumulated across pages;
secured children remain silently excluded. The reader stops with failure as
soon as the eligible count exceeds the allowance, rather than reading more
pages for an already invalid candidate. No successful snapshot is truncated.

Local authenticated webtrigger/Command tests establish exact byte and child
boundaries, UTF-8 rather than UTF-16 measurement, pagination-independent count
limits, excluded-child noninterference, and content-free errors/logging. A new
required-value regression rejects date-only `updated` timestamps rather than
silently inventing midnight. Existing tests continue to cover interrupted
listings, malformed or failed child reads, ambiguous field mappings, invalid
required values, output-validator rejection, and identical canonical bytes on
repeated/reordered input. These reuse the existing Command/public-validator
seams; no private-helper mocks or new test framework were introduced.

No deployment, installation, live-data changes, or cloud log readback was
performed for ticket 08. The caps are locally enforced application policies,
not verified TWG ingestion/storage capacities. The TWG ingestion work owns deployed
confirmation; the Exchange and document-storage work owns retention of a previous successful document.
There are no new modules, permissions, egress destinations, dependencies, or
storage writes.

### Deterministic generation and failure behavior

- Serialize fields in schema-table order and record fields in their defined
  order. Use two-space YAML indentation and block lists, with quoted strings.
- Use LF line endings, no byte-order mark, a blank line after Frontmatter and
  around headings, and exactly one final newline. Preserve whitespace inside
  code; outside code use a consistent Markdown serializer.
- Deduplicate tags by exact string and sort them lexically by Unicode code
  point. Preserve case and source prose; do not generate summaries.
- Do not include export time, request IDs, elapsed time, transport identity,
  publication sequences, or volatile statistics in canonical content.
- Compare canonical UTF-8 bytes for content changes. An included `updated_at`
  change is a content change even if the description is unchanged. Child
  `updated` values are not included and alone do not change the document.
- A successful read returning an empty optional value is not an API error.
  Authentication failures, ambiguous supported field mappings, invalid required
  values, incomplete pagination, or failed eligible child reads fail the whole
  candidate. Never publish a partially generated replacement.
- Enforce a reviewed hard byte limit and child-count limit before publication.
  Exceeding either limit fails the candidate; do not silently truncate. Numeric
  limits start as provisional values from documented delivery, storage, and
  ingestion constraints, and are confirmed or adjusted by deployed ingestion
  verification before the converter ships.
- On failure, retain the last successful document and report the failure through
  the parent application's status behavior. Do not put diagnostic errors or
  restricted source data into Workdown. Initial failures create no Publication.

There is no second Workdown revision counter. The parent spec allocates sequence
numbers only after detecting changed canonical content; retries reuse bytes.

### Event and ingestion implementation gates

These gates are verified during implementation, in the first ticket that touches
each behavior, on a deployed site; findings are recorded here. They do not gate
ticket creation. Verify and document event coverage for:

1. Epic updates affecting any included field, and optional-field mapping changes.
2. **Child-only changes are not update reasons** (user decision 2026-11-20).
   Ignore child creation, edits, deletion, and reparenting; neither old nor new
   Epic is selected from a child event. Children remain snapshot context and
   are reread on a later Subject-Epic update or explicit `exchange.start`.
   Their titles/membership may remain stale indefinitely otherwise. Child-event
   delivery, prior-parent retention, and creation-failure diagnosis are no longer
   required freshness gates for this profile.
3. Eligibility changes caused by issue security, project permissions, or sharing
   principal changes. Do not claim these always produce usable Jira events.
4. Source-Epic deletion, which remains explicitly unsupported by the parent spec.

If required events or prior-parent data are unavailable, revise the
profile or explicitly approve the freshness limitation; do not silently add
polling or promise reconciliation. Event delivery does not guarantee a
transactionally consistent multi-issue Jira snapshot.

TWG accepted the full canonical Workdown submitted as `text/plain`, and the user
verified Epic Workdown discovery through Rovo Search on 2026-11-19. On 2026-11-20
the user accepted this ingestion evidence without further Search feature or exact
Frontmatter-readback characterization. Do not infer Markdown rendering, structured
YAML indexing, or byte-preserving TWG readback. See the
[accepted ingestion scope](workdown-spec.md#ingestion-evidence-and-accepted-scope--2026-11-20).
A destination-local viewer remains absent and is not ticket 21 work; the current
Search URL points to the source Epic. Source-independent viewing is not established.
When a viewer is added, use a destination-local read URL and preserve `resource`
only as provenance, with the format specification's HTML and safe-link protections.

## Jira converter acceptance tests

Use fixture-based tests at the public Jira-to-document boundary, not private
helper tests. At minimum, cover:

- A standalone item, an empty description, an Epic with no eligible children,
  and an Epic containing multiple direct children.
- Equivalent semantic custom fields with different site-specific IDs; absent,
  ambiguous, and unreadable fields must have distinct expected outcomes.
- Same source ID after a key change, and different source IDs for matching keys
  on different sites.
- Stable output after reordered API fields, labels, and paginated child results;
  changed output after a supported content change.
- Reparenting, completed children, excluded secure items, and partial child-read
  failure without leaking identities or replacing the previous snapshot.
- Heading-like source text, including every heading level, empty headings,
  headings with inline formatting, headings in nested containers, and literal
  lines beginning with `#`; Markdown table pipes, nested lists, code fences,
  mentions, unsafe links, media, unsupported ADF, and attempted raw HTML.
- Extension: an unadopted extension field is never emitted; adopted fields sort
  deterministically; consumers ignore unknown namespaces; reserved or colliding
  namespaces and `customfield_*` keys are rejected by the converter.
- Safe YAML parsing, unknown format versions, invalid timestamps, duplicate item
  identities, and size-limit rejection without truncation.
- Unchanged bytes producing no Publication, and retries preserving bytes and
  sequence through parent Command tests.

Actual Jira authorization/event behavior, TWG ingestion fidelity, and viewer
safety require deployed verification; string fixtures alone do not prove them.
