# UI Specification: Demonstration UI for Supplychain Graph Logs

**Status:** Approved for implementation by the user on 2026-11-23; ticket 41 implementation in progress.

## 1. Strategy & Scope

- **User Goal:**
  Inspect real stored events to establish
  whether Supplychain Graph's logging supplies sufficient evidence
  to understand its behavior.
- **Posture:**
  Transient: open, inspect recent events, and leave.
- **Placement:**
  A Forge Jira admin page, using UI Kit first.
  Proposed manifest page title: **Workdown logs**.
  Use the page title supplied by Forge;
  do not duplicate it with an in-content heading.
- **Audience:**
  A current human Jira administrator
  with global `ADMINISTER` permission on the installation.
- **Scope:**
  Read-only viewing of governed, installation-local audit
  and allowlisted operational CloudEvents
  from the default Forge-storage sink.
- **Exclusions:**
  This is a minimal proof surface,
  not a production log-analysis tool or monitoring dashboard.
  Logging settings,
  enable/disable controls,
  external sinks,
  credentials,
  peer connections,
  export/download,
  live streaming,
  auto-refresh,
  polling,
  retention configuration,
  search,
  and user-configurable filters or
  time ranges.
  Real operational analysis belongs in a dedicated log-analysis system,
  not an expanding version of this proof UI.

### Selecting the log kind

`logs.list` requires exactly one kind per request
and has no combined stream.
Retain two simple views,
**Audit** and **Operational**, as tabs;
default to Operational.
These select the store partition,
not a configurable filtering toolbar.
This is a proposed interpretation for user editing,
not an approved exception hidden inside the no-filters decision.
No client-side merged timeline is added.

## 2. Structure & Skeleton

- **Hero Element:**
  A newest-first log table with just **Time (UTC)** and **Event** columns.
  The Event cell displays
  the complete structured event as compact, single-line JSON.
  Do not derive Result, Level, Method, or other summary columns.
- **Hierarchy:**
  Brief purpose/coverage text;
  Audit/Operational tabs;
  fixed last-hour window and Refresh action;
  log table;
  Load more action and concise batch feedback.
  No duplicate page heading, dashboard metrics, or filter form.
- **Details:**
  Each row provides a keyboard-accessible **View details** action
  associated with its event.
  It opens a modal containing the same complete governed event
  as formatted, syntax-highlighted JSON.
  Use indentation, whitespace, and theme-aware color
  to make keys and values easier to scan.
  Do not fetch a separate, more privileged event payload.

Illustrative content layout (the page heading is supplied by Forge):

```text
Inspect recent stored events to assess Workdown's logging.
This viewer is not a complete audit or system-health report.

[Audit] [Operational]
Last hour: <from UTC> – <to UTC>                 [Refresh]

Time (UTC)                 Event
<timestamp>                {"specversion":"1.0",...} [View details]
<timestamp>                {"specversion":"1.0",...} [View details]

<count> events shown. Newest first.
[Load more]
```

### Interaction Flow

1.  Opening the page selects Operational
    and captures a fixed time window from now minus one hour to now.
    Request up to 20 candidates through `logs.list`,
    with explicit canonical UTC `from` and `to` bounds
    and no optional event filters.
2.  Changing the kind starts a new first-page query,
    clears previous results and pagination,
    and captures a new last-hour window.
3.  **Refresh** does the same for the current kind.
    Display the actual fixed bounds
    so an older loaded view
    is not misleadingly labelled as continuously current.
    No background requests refresh the window.
4.  **Load more** makes one bounded continuation request
    and appends returned events.
    Preserve the selected kind, fixed bounds, limit, and opaque cursor.
    Never automatically scan additional batches to fill the table.
5.  Opening details does not issue another Command.
    Closing the modal returns focus to its trigger
    and preserves the table, scroll position, and query.
6.  Keep query state and cursors in page memory only.
    No saved filters,
    URL persistence,
    durable bookmarks,
    or navigation history for batches.
7.  Ignore superseded responses after a refresh or kind change;
    they must not append events from an old query to the current view.

### Bounded Pagination Semantics

- The limit is at most 20 candidates scanned per request,
  not a promise of 20 returned events.
  Short or empty batches can still have a continuation.
- Show **Load more** only
  when the response provides a cursor.
  Do not show numbered pages or a total count of stored events.
- An empty batch with a cursor says:
  **No events in this batch.
  More events can be checked.**
  Keep Load more available;
  do not call the query exhausted.
- If the final batch is empty after earlier results,
  keep those results and indicate
  that there are no more events for this query.
- Results are eventually consistent and are not a snapshot.
  Preserve the Command's newest-first ordering
  and avoid displaying the same event twice
  if a continuation repeats an event ID.
- An expired or rejected cursor offers **Restart search**,
  preserving the selected kind but starting a fresh last-hour window.
  This is a restart action, not a search/filter feature.

## 3. The State Matrix

- **Ideal:**
  Show the returned events with UTC timestamps and compact JSON.
  Details opens the formatted JSON modal.
  Refresh is available;
  Load more is available only while a continuation exists.
  Explain that only governed stored events are shown,
  not all console logs, a complete audit, or proof of health.
- **Empty:**
  On a completed initial query with no events,
  say **No stored events found in this one-hour window** and offer Refresh.
  Do not infer that logging is broken
  or offer filters/wider ranges.
  Distinguish this from an empty batch
  that still has a continuation
  and from failure to read logs.
- **Loading:**
  Show an accessible initial loading indicator.
  During Load more,
  retain existing rows and show progress at the action.
  Disable conflicting query actions
  while a request is pending and prevent duplicate submissions.
  On refresh or kind change,
  clear the old query's rows rather than displaying them
  under new time bounds or a different kind.
  Announce loading and results without moving focus unexpectedly.
- **Error:**
  - **Forbidden:**
    Explain that Jira global `ADMINISTER` permission is required.
    Show no event data.
    If permission is lost after rows were shown,
    clear the rows and any open details modal.
  - **Unavailable:**
    Show a safe message and Retry.
    On continuation failure,
    keep already loaded rows for the same query unless authorization failed;
    do not discard or advance the cursor.
    An indeterminate authorization check must fail closed
    for that request
    and must not return additional data.
  - **Invalid continuation:**
    Offer Restart search as described above.
  - **Other invalid parameters:**
    Show a safe query-failure message and a restart action;
    this fixed-query UI has no editable filter fields to correct.
  - Never render raw exceptions,
    transport responses,
    credentials,
    request headers,
    or secret-bearing diagnostic text.
    Never present an error as an empty successful result.

## 4. Edge Cases & Accessibility

- Keep JSON compact in table rows.
  Constrain long lines to the event cell with horizontal scrolling;
  do not silently omit fields.
  The details modal provides a readable, complete representation
  rather than an alternative data source.
- Modal JSON is indented and scrollable.
  Long string values must remain accessible without overflowing the viewport;
  preserve their exact content.
- Use accessible modal labelling,
  focus trapping,
  Escape/Close behavior,
  and focus restoration.
  Row actions must work without pointer-only interactions.
- On narrow viewports,
  wrap the toolbar and allow table/content scrolling within its region.
  The modal must fit the viewport with its own scrolling.
- Syntax coloring is supplementary.
  Keys, punctuation, values, indentation, and text remain understandable
  without color and in supported themes.
- Render every event value as text,
  never interpreted HTML or executable markup.
  Do not enrich account IDs or reinterpret event outcomes.
- Use Atlassian Design System components and supported theme-aware styling.
  **ADS Tokens:**
  Use supported UI Kit token styling;
  where direct custom token usage is applicable,
  use `@atlaskit/tokens`,
  not hardcoded colors, spacing, or typography.
  A dedicated JSON viewer dependency is not assumed necessary.
- Counts describe only loaded events, never total system activity.
  The viewer cannot prove critical audit fail-closed behavior
  or complete log capture.

## 5. Command Integration & Authorization

The current `logs.list` implementation
requires a Basic API credential at its business authorization boundary.
Native Forge UI invocation therefore requires an extension,
not merely a new caller wired to the existing credential path.

- Add a trusted Forge-session adapter
  and expand the underlying `logs.list` authorization support
  to accept that trusted invocation context.
- Derive the human identity
  and installation from verified Forge invocation context,
  not browser-supplied account IDs or installation identifiers.
- Enforce a fresh Jira global `ADMINISTER` permission check
  at the business boundary for every read, including continuations.
  Page visibility and hidden controls are not authorization.
  Unknown authority fails closed.
- Use Forge's built-in authentication.
  Never request, store, or forward a user-entered API token from this UI.
- Preserve the authenticated webtrigger path
  and its existing authorization requirements.
  The UI must not create a bypass for other callers.
- Reuse the governed
  event projection,
  validation,
  query limits,
  cursor binding,
  and installation isolation of `logs.list`.
  Do not introduce a second reader,
  direct frontend storage access,
  or a new public Command for this viewer.
- Review any required contract/policy changes
  and manifest/module/scope wiring as part of the implementation.
  This draft does not assert that the current manifest
  or Command context already supports Forge-session invocation.

## 6. Verification & Implementation Gate

- Rendering and interactions:
  initial load,
  kind change,
  Refresh,
  bounded Load more,
  sparse batches,
  modal details,
  and safe loading/empty/error states.
- Command integration:
  fixed-window query construction,
  continuation reuse,
  restart behavior,
  and protection against superseded responses.
- Business authorization:
  trusted Forge-session admin success,
  non-admin rejection,
  unknown authority,
  and preservation of existing credential-based authorization
  and installation isolation.
- Installed demonstration:
  after separate deployment/installation approval,
  inspect real stored events on the existing approved installation.
  Do not claim production readiness,
  complete audit coverage,
  or audit fail-closed verification from this demonstration.

**Implementation Gate:**
The user will edit and explicitly approve `UI_SPEC.md`
before any React/ADS code or backend implementation begins.
**State Completeness:**
Ideal, Empty, Loading, and Error behavior are part of the spec.
Run `npm run check` before submitting implementation changes.
Deployment and installation require separate approval
and a review of scope/egress changes.

### recommended_actions

Continue **Fact Discovery** where implementation constraints need confirmation.
Review this `UI_SPEC.md` **One Decision at a Time**,
including the proposed Audit/Operational tabs and all four states:
**Ideal**, **Empty**, **Loading**, and **Error**.
Follow the **Atlassian Design System**
without expanding this proof surface into an operations product.

### references

- `src/openrpc.json` (`logs.list` and stored event schemas)
- `src/logs.ts` (current reader and authorization boundary)
- `manifest.yml` (current modules and permissions)
- `.agents/skills/to-ui-spec/references/about-atlassian-design-system.md`
- `UI_SPEC.md` (approved by the user on 2026-11-23)
