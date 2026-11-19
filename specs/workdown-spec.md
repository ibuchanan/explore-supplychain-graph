# Workdown Specification

Status: format approved by Ian Buchanan on 2026-11-15. Source-profile approval
and implementation readiness are documented separately; see
[Source profiles](#source-profiles).

## Purpose

Workdown represents the current state of a work item as Markdown with YAML
Frontmatter. It is readable without an API client or access to the source
system, while retaining typed metadata for programs and language models.

A work item is a unit of tracked work: for example, a Jira Epic, story, task,
or bug. A Workdown document has one primary work item and may include a bounded
set of related work-item summaries. It is a snapshot, not an event log, issue
backup, workflow definition, or command to change the source.

Plain Markdown with Frontmatter keeps documents diffable and friendly to Git
tooling, but Workdown does not define a Git-resident work-item store, authoring
workflow, or tracker synchronization.

The format is independent of transport, indexing, and sharing policy.
Platform-specific profiles define narrower content rules; see [Source profiles](#source-profiles).
The [parent specification](supplychain-graph.md) continues to govern Exchanges,
document identity, sequencing, and Publications.

## Relationship to Threaddown

[Threaddown](threaddown.md) models a discussion as a summary followed by
chronological posts. Workdown models work as current structured state followed
by descriptive content. A description is not a first post, a child is not a
reply, and workflow status is not discussion status.

| Threaddown convention | Workdown treatment |
| --- | --- |
| Markdown with YAML Frontmatter | Retain. |
| Human- and LLM-readable content | Retain; do not require generated prose. |
| `title`, `resource`, `source_id`, `tags`, `sources` | Reuse their broad meanings. |
| `type: Discussion` | Use `type: WorkItem`. |
| `thread_status` separate from knowledge status | Use `work_status`; do not emit top-level `status`. |
| H1 summary and H6 chronological posts | H1 title and named H2 sections. |
| Full discussion and participant statistics | Not part of the core work-item format. |
| Additional unmapped platform fields | Namespaced [extension](#extension) fields; no automatic passthrough, and a profile must allow each field. |
| `generated: { by, at }` | Retain `by` as `workdown/<format_version>`; omit conversion-time `at` to avoid artificial changes. |
| `sources` entries `{ id, resource, title }` | Retain; the primary entry adds the source's `last_modified`. |
| Reasonably reversible conversion | Explicitly lossy, curated snapshot; no round-trip promise. |

## Alignment with OKF

Like Threaddown, Workdown is shaped to be an
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)
(OKF) v0.2 concept, so an OKF consumer can ingest a Workdown document without a
Workdown-specific adapter. This section was checked against OKF's `SPEC.md`
(version 0.2); it is not an endorsement by OKF's maintainers.

OKF §11 requires only parseable YAML Frontmatter and a non-empty `type`. OKF
types are free strings that consumers must accept when unknown, so `WorkItem`
needs no registration. A Workdown document that meets this specification
therefore satisfies OKF v0.2 conformance for its Frontmatter. Four commitments
carry over from Threaddown:

1. **One type.** Every document declares `type: "WorkItem"`.
2. **Inherited provenance and trust.** Use OKF's `sources` and `generated`
   instead of parallel fields.
3. **Separated lifecycle.** A work item's workflow state is `work_status`, kept
   distinct from OKF's knowledge-lifecycle `status`.
4. **Extensible by producer.** Fields OKF has no word for are producer-defined
   extension keys (OKF §4.1): `format`, `format_version`, `source_id`,
   `work_type`, `key`, `work_status`, `resolution`, `priority`, `created_at`,
   `updated_at`, `start_date`, `due_date`, `parent`, and `children`.
   Workdown [extension](#extension) namespaces are further producer-defined
   keys, which OKF consumers must not reject.

| Workdown field | OKF field | Treatment |
| --- | --- | --- |
| `type` | `type` | Always `WorkItem`. |
| `title` | `title` | Current work-item summary. |
| `resource` | `resource` | Canonical source item URL. |
| `tags` | `tags` | Source labels. |
| `sources` | `sources` (§5.1) | `{ id, resource, title }` per entry. OKF requires only `resource`; Workdown also requires `id` and `title`. The primary entry adds `last_modified`. |
| `generated` | `generated` (§5.2) | `by` is `workdown/<format_version>`. `at` is omitted: OKF does not require it, and a conversion time would change bytes without changing content. |
| `status` | `status` (§5.4) | Not emitted. Absent means OKF's default, `stable`, which a snapshot does not otherwise assert. |
| — | `verified`, `stale_after` | Not emitted. Workdown makes no verification or staleness claim; freshness is event-driven and may lag. |
| — | `description` | Not emitted. A summary would be generated prose. |

`last_modified` (OKF §5.1: when the source itself last changed) carries the
primary item's source modification time. OKF distinguishes it from
`generated.at`, which records the content's last meaningful change. OKF
timestamps are ISO 8601 with an explicit UTC offset, which Workdown's
`...Z` strings satisfy; they are quoted strings under the safe YAML subset.

The alignment is compositional: a downstream pass can emit further OKF concepts
whose `sources` point back at the `WorkItem` by `source_id`. Workdown claims
conformance for its own documents only, not for any bundle, `index.md`, or
`log.md` that stores them.

## Prior art

Workdown is a generated snapshot, which distinguishes it from plain-text
trackers that are edited in place. Primary sources consulted (each checked
against its own documentation; none establishes conformance):

- [git-issue](https://github.com/dspinellis/git-issue) stores each issue as a
  directory of plain-text files (`description`, `tags`, `comments/`,
  `attachments/`) inside the repository, with optional GitHub and GitLab
  integration.
- [git-bug](https://github.com/git-bug/git-bug) stores bugs in Git objects, not
  working-tree files, and offers bridges to Jira, GitHub, GitLab, and Launchpad.
  Its on-disk format is defined in its own specification.
- [Backlog.md](https://github.com/MrLesk/Backlog.md) stores each task as a
  Markdown file in a project-local folder and advises editing through its
  tooling to keep metadata consistent.
- [MADR](https://adr.github.io/madr/) shows the pattern of YAML Frontmatter
  (`status`, `date`, participants) plus fixed Markdown sections.
- [Org mode property drawers](https://orgmode.org/manual/Property-Syntax.html)
  are an earlier example of per-item key-value metadata in plain text.

Two lifecycle-integration lineages inform the design of the metadata, not its
encoding:

- [OSLC Change Management 3.0](https://docs.oasis-open-projects.org/oslc-op/cm/v3.0/ps01/change-mgt-spec.html)
  (OASIS Open Services for Lifecycle Collaboration,
  [open-services.net](https://open-services.net/)) defines a Change Request
  resource for defects and enhancement requests. It deprecates the free-text
  `oslc_cm:status` in favor of `oslc_cm:state`, standard state predicates (such
  as `oslc_cm:closed` and `oslc_cm:inProgress`) that map server-specific
  statuses to common meanings, and models relationships as typed links. Workdown
  borrows the separation of the source's status label from a normalized
  category. It does not adopt RDF, the OSLC vocabulary, or OSLC conformance.
- Software Lifecycle Integration (SLI), as described in Tasktop's
  [architecture whitepaper](https://www.tasktop.com/blog/software-lifecycle-integration-architecture/),
  uses a common data model of tasks and assets, related by containment (parent
  and child) and linking, and maps artifacts between systems of record. Workdown
  borrows the containment vocabulary behind `parent` and `children`. Mapping
  between systems is out of scope: Workdown is a one-way snapshot.

Workdown differs in being one-way and lossy: it does not keep a store, does not
round-trip, and discloses only an allowlist (see the Explore profile). Its
`work_status.category` follows the convention of Jira's status categories
(`todo`, `in_progress`, `done`); additional states such as `blocked` or
`canceled` are not defined. Issue links and typed relationships beyond
`parent` and `children` are excluded from version 1.

## Document structure

The terms MUST, SHOULD, and MAY describe requirements of this version.

A document MUST be UTF-8 Markdown with one YAML Frontmatter mapping, followed by
one H1 title and a required `## Description` section. An optional
`## Children` section follows the description when child summaries are present.

- Frontmatter MUST begin on the first line with `---` and end with `---`.
- The body MUST use CommonMark plus GitHub-flavored Markdown tables.
- The H1 MUST contain the escaped literal `title`, not an inferred summary.
- The description MUST represent the source description, not an LLM rewrite.
- Source headings MUST become bold paragraphs, preserving their text, so they
  cannot masquerade as document sections.
- Section boundaries MUST be parsed as Markdown blocks, not by matching lines
  inside fenced code blocks, quotes, or lists.
- Metadata is authoritative for structured fields. Body metadata views MUST
  agree with it; consumers MUST NOT recover identity from titles or table text.

The format version identifies the content contract. It is not a snapshot
revision or the Exchange's `updateSequenceNumber`.

## Frontmatter schema

Version 1 uses the following fields. A non-empty string contains at least one
non-whitespace character. Optional fields MUST be omitted when empty or unknown,
not emitted as YAML null. A known empty collection MAY be `[]`.

| Field | Type | Requirement and meaning |
| --- | --- | --- |
| `format` | string | Required; exactly `workdown`. |
| `format_version` | integer | Required; exactly `1` for this draft. |
| `type` | string | Required; exactly `WorkItem`. |
| `source_id` | non-empty string | Required; stable, source-scoped primary item identity. |
| `title` | non-empty string | Required; current work-item summary. |
| `resource` | absolute HTTPS URL | Required; canonical source item URL, not the destination viewer. |
| `work_type` | non-empty string | Required; source work-item type label, e.g. `Epic` or `Bug`. |
| `key` | non-empty string | Optional; human-facing identifier, e.g. `DEMO-42`. |
| `work_status` | mapping | Optional; `{ name, category? }`. `name` is a non-empty source label; `category` is `todo`, `in_progress`, or `done` when the source provides a supported mapping. |
| `resolution` | non-empty string | Optional; source resolution label, distinct from status. |
| `priority` | non-empty string | Optional; source priority label, with no inferred cross-platform rank. |
| `tags` | list of non-empty strings | Optional; source labels, deduplicated and sorted. |
| `created_at` | timestamp string | Optional; source creation time. |
| `updated_at` | timestamp string | Optional; source item modification time, not conversion time. |
| `start_date` | date string | Optional; source planned start date. |
| `due_date` | date string | Optional; source due date. |
| `generated` | mapping | Required; `{ by }` where `by` is exactly `workdown/<format_version>`, e.g. `"workdown/1"`. No conversion time or converter build version. |
| `sources` | list of source records | Required; primary item followed by included children. |
| `parent` | parent record | Optional; summary of the item's direct parent, e.g. a Story's Epic. Not an assertion of the full ancestry. |
| `children` | list of child records | Optional; included child summaries, not an assertion of a complete source hierarchy. |

A source record is `{ id, resource, title }`, all required. Its `id` is the
corresponding item's `source_id`. The primary item's record also has
`last_modified` exactly when `updated_at` is present, with the identical value;
child records have none, since child modification times are not included.
`sources` records derivation, not source permission or destination access
rights.

A child record has required `source_id`, `title`, `resource`, and `work_type`,
and optional `key`, `work_status`, and `resolution`, with the same types as
above. Version 1 child records cannot contain descriptions or nested children.
Every item identity MUST be unique within the document; no child may equal the
primary item. The order of child source records MUST match `children`.

A parent record has the same fields as a child record. It is a one-level upward
pointer for context. It is not listed in `sources`, which records only the
primary item and included children, and it carries no description or ancestors.
A parent's identity MUST differ from the primary item and from every child. A
profile decides whether to emit `parent`; the Explore profile does not (see its
allowlist).

Adding a core field requires a reviewed format revision. Extension, below, is
the only other way a document gains fields. No arbitrary `fields`,
`customfield_*`, embedded source JSON, or people directory is defined, and no
profile may allow a wildcard or whole-source passthrough.
Consumers MUST reject unsupported `format_version` values rather than guessing.

Workdown documents are generated, read-only snapshots. Unknown-key preservation
and round-trip editing rules do not apply; a tool that edits a document and
re-emits it does not thereby produce a conformant Workdown document, and the
source system remains authoritative. The section name `## Comments` is reserved
for a possible future comments section and is not permitted in version 1. A
discussion-style comment record belongs to [Threaddown](threaddown.md), not to
the core work-item format.

### Extension

Workdown is extensible through namespaced extension mappings, not through
additional core fields. This keeps platform-specific metadata, such as a Jira
sprint name, out of the core while letting a profile carry it.

- **Namespace.** An extension is a top-level Frontmatter key whose value is a
  mapping of that namespace's fields. A namespace name matches
  `[a-z][a-z0-9_]*` and MUST NOT equal a core field. The names `jira`, `github`,
  and `linear` are reserved for Workdown-defined platform profiles. Other
  producers use an `x_` prefix, e.g. `x_acme`, for private namespaces.
- **Profile adoption.** A producer MUST emit an extension field only if the
  governing disclosure profile lists that exact field, with its meaning,
  source, and type. A profile allows named fields one by one; it cannot allow a
  namespace as a whole. Extension is a format capability, not a disclosure
  decision.
- **Values.** Extension values follow the safe YAML subset: strings, integers,
  mappings, and lists, with all strings quoted. Their meaning MUST NOT overlap a
  core field or depend on the body, and they MUST NOT contain source field
  identifiers such as `customfield_10042` as keys; use semantic names.
- **Determinism.** Extension namespaces follow all core fields, sorted by Unicode
  code point, as do keys within each namespace. They take part in canonical-byte
  comparison and the size limit like any other content.
- **Consumers.** A consumer MUST ignore extension namespaces and fields it does
  not understand, and MUST NOT reject a document for them. An extension never
  changes how core fields are interpreted, and consumers MUST NOT recover
  identity from one. Unsupported `format_version` is still rejected.
- **Versioning.** Adopting an extension field in a profile does not change
  `format_version`. A core change does.


### Identity and dates

`source_id` MUST include the source platform, source instance, and immutable
native item ID. The `key` and `resource` MAY change without changing `source_id`;
these are source identities, not TWG or Exchange document IDs.

Consumers MUST treat `source_id` as an opaque string compared by exact equality
and MUST NOT parse it. Producers MUST emit the identity as their source
documents it, with no added normalization. A changed identity would appear as a
new item. See [Source profiles](#source-profiles) for platform-specific identity
construction.

Timestamps MUST be quoted RFC 3339 UTC strings with three fractional digits,
for example `"2026-11-15T10:30:00.000Z"`. Dates MUST be quoted `YYYY-MM-DD`
strings and MUST NOT acquire an invented timezone. Unknown dates are omitted;
placeholder dates and inferred completion dates are prohibited.

### Safe YAML subset

Frontmatter MUST use YAML 1.2 with a single mapping and unique keys. Values are
limited to strings, integers, mappings, and lists; booleans are not needed by
this schema. Producers MUST quote all string values, including dates and values
such as `On` or `123`. Consumers MUST reject duplicate keys, custom tags,
aliases, anchors, and additional YAML documents, and MUST use a safe loader.

## Markdown body

### Description

The description preserves source text, paragraphs, lists, emphasis,
blockquotes, inline code, fenced code, and supported tables. Empty descriptions
use the literal paragraph `No description provided.`; the profile distinguishes
an empty source field from a failed read before rendering.

Converters MUST escape literal text for its Markdown context, including titles,
link labels, and table cells. They MUST use code fences longer than any matching
fence in the content. Newlines in titles and table cells become spaces; table
pipes are escaped. Code text and Unicode punctuation MUST be preserved; do not
apply Threaddown's quote normalization inside source prose or code.

#### Source headings

A source heading of any level renders as one paragraph whose entire content is
bold, e.g. `**Acceptance criteria**`. The level is intentionally not preserved;
consumers cannot recover source heading structure, and the only sections are
the H1 title, `## Description`, and `## Children`.

- The heading's inline content is escaped like any other text. Emphasis, inline
  code, and links inside a heading keep their rendering within the bold span;
  line breaks become spaces.
- A heading with no visible text is dropped, not rendered as an empty bold
  paragraph.
- A heading inside a nested container (list item, quote, table cell) becomes a
  bold paragraph in that container, or a bold span if the container cannot hold
  a paragraph, such as a table cell.
- Heading-like text inside a code block stays code and is never converted.
- A heading is never promoted to a document section and is not compared with or
  removed because it matches the `title`.
- A body line that merely starts with `#` but is not a source heading node is
  literal text and MUST be escaped so it cannot parse as a Markdown heading.

Links MUST retain only explicit source labels and safe destinations. Allow
absolute HTTPS and HTTP links, plus `mailto:` links explicitly present in source
text; resolve relative links against the source site. Reject executable schemes
such as `javascript:`. Render rejected links as label text. Do not fetch linked
pages, expand smart links, or infer access to their targets.

Render mentions as their supplied display text without looking up profiles,
email addresses, or additional personal data. Attachment/media nodes become the
literal marker `[media omitted]`, without filenames, thumbnails, or URLs.
Unsupported rich-text nodes become `[unsupported content omitted]`; known
unrepresentable structures MUST NOT vanish silently. Raw HTML MUST NOT be
emitted or executed. A viewer MUST treat all received Markdown as untrusted,
disable raw HTML, and apply its own safe-link policy.

#### Rich-text inventory

The Jira ADF v1 input profile uses the following closed inventory. Unknown node
and mark types are unsupported; their payloads and attributes are not traversed
or disclosed. Malformed required document/text/container shapes fail the export.

| ADF node or mark | Treatment |
| --- | --- |
| `doc` version 1 | Required root; render its blocks separated by blank lines. |
| `paragraph`, `text` | Escaped literal text; normalize CRLF/CR to LF. Escape ampersands to preserve literal entities. |
| `heading` levels 1–6 | Bold paragraph at any nesting depth, following Source headings above; redundant strong marks are absorbed. |
| `hardBreak` | Markdown hard break; a space in a heading or table cell. |
| `strong`, `em` marks | Bold and italic spans; whitespace-only non-code spans remain plain whitespace. |
| `code` mark | Inline code with a backtick delimiter longer than all source runs; pad delimiter-adjacent backticks/spaces as needed. |
| `link` mark | Explicit label only; HTTP(S), explicit `mailto:`, or relative destination resolved against the source-site origin. Reject controls/whitespace and embedded credentials. Encode Markdown destination delimiters and pipes. |
| `mention` | Supplied `attrs.text` only, escaped; missing display text uses the unsupported marker. |
| `bulletList`, `orderedList`, `listItem` | Nested Markdown lists; ordered lists retain a nonnegative integer start, default 1. |
| `blockquote` | Prefix each contained line with `> `; retain block separation. |
| `codeBlock` | Backtick fence of at least three, longer than every source backtick run; preserve code text and Unicode after LF normalization. Retain only a language token containing letters, digits, `_`, `+`, or `-`. |
| `table`, `tableRow`, `tableHeader`, `tableCell` | Rectangular pipe table without merged cells. Use the first all-header row as its header, otherwise add an empty header. Paragraphs/headings in cells become inline spans separated by spaces; escape literal pipes, including inline code pipes. |
| `rule` | Markdown thematic break `---`. |
| `media`, `mediaSingle`, `mediaGroup` | One `[media omitted]` marker per encountered node/container; no child traversal or attributes. |
| Merged/ragged tables; non-paragraph/heading cell blocks | `[unsupported content omitted]` for the table or unsupported cell block respectively. |
| `inlineCard`, `blockCard`, `embedCard`, `emoji`, `date`, `status`, `panel`, `expand`, `nestedExpand`, `decisionList`, `decisionItem`, `taskList`, `taskItem`, `bodiedExtension`, `extension`, `inlineExtension`, `caption`, `layoutSection`, `layoutColumn` | Unsupported: `[unsupported content omitted]`; no URL expansion or payload disclosure. |
| `strike`, `underline`, `subsup`, `textColor`, `backgroundColor`, `alignment`, `indentation`, `border`, `breakout`, `annotation` marks | Keep escaped text and append `[unsupported content omitted]` for each unsupported mark; attributes are omitted. |
| Any other node or mark | Same unsupported marker; never silently discard an unrepresentable structure. |

Code inside table cells necessarily uses the pipe-table escape for `|` and
spaces for line breaks. Inline code line breaks outside tables follow Markdown
code-span normalization; fenced blocks preserve code whitespace. Literal HTML
text is escaped, never passed through. Node attributes not named above are not
rendered. Viewers must still disable raw HTML and enforce safe destinations.

### Children

When `children` is non-empty, render one table under `## Children` with columns
`Work item`, `Type`, `Status`, and `Resolution`. Each row corresponds to one
Frontmatter child in the same order. `Work item` is a link labeled
`<key>: <title>` when a key exists, or just `<title>` otherwise. Missing status
or resolution is displayed as an em dash (`—`).

The table is a readable projection, not another source of work-item state.
It MUST NOT contain child descriptions, comments, or fields absent from child
records. An empty child list omits the section. Whether children were queried
and which ones qualify is a profile decision, not a format-level assumption.

## Source profiles

Source-specific content rules and identity construction are documented in
companion files. Source-profile approval and implementation readiness are
separate from approval of this core format and are recorded in each profile.

- [Jira mapping research and profile](workdown-jira.md)

## Complete example

The following uses synthetic source IDs, keys, and content. It shows an Epic
with one included direct child; it does not establish disclosure approval.

```markdown
---
format: "workdown"
format_version: 1
type: "WorkItem"
source_id: "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10042"
title: "Publish partner availability"
resource: "https://source.example.com/browse/DEMO-42"
work_type: "Epic"
key: "DEMO-42"
work_status:
  name: "In Progress"
  category: "in_progress"
priority: "High"
tags:
  - "availability"
  - "partner"
created_at: "2026-11-01T09:00:00.000Z"
updated_at: "2026-11-15T10:30:00.000Z"
due_date: "2026-12-01"
generated:
  by: "workdown/1"
sources:
  - id: "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10042"
    resource: "https://source.example.com/browse/DEMO-42"
    title: "Publish partner availability"
    last_modified: "2026-11-15T10:30:00.000Z"
  - id: "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10043"
    resource: "https://source.example.com/browse/DEMO-43"
    title: "Define availability response"
children:
  - source_id: "ari:cloud:jira:00000000-0000-4000-8000-000000000001:issue/10043"
    title: "Define availability response"
    resource: "https://source.example.com/browse/DEMO-43"
    work_type: "Story"
    key: "DEMO-43"
    work_status:
      name: "To Do"
      category: "todo"
---

# Publish partner availability

## Description

Let partners check availability before submitting an order.

**Acceptance criteria**

- Return available quantity for a product.
- Explain when availability is unknown.

## Children

| Work item | Type | Status | Resolution |
| --- | --- | --- | --- |
| [DEMO-43: Define availability response](https://source.example.com/browse/DEMO-43) | Story | To Do | — |
```

A standalone work item uses the same structure without `children` or the Children
section. The core format has no Epic-specific field.

## Acceptance criteria for implementations

All Workdown producers MUST verify:

- **Serialization determinism:** Unchanged content produces identical UTF-8 bytes;
  field ordering and whitespace match the specification exactly.
- **Identity stability:** Same source item produces the same `source_id` after
  key or resource changes; a changed identity indicates a new item.
- **Deterministic output:** Reordered API fields, labels, paginated results, and
  retried reads produce identical bytes. Included content changes produce changed
  bytes.
- **Safe text handling:** Headings, mentions, unsafe links, media, and
  unsupported source nodes are handled as specified. Raw HTML is never emitted.
- **Extension discipline:** Unadopted extension fields are never emitted; adopted
  fields sort deterministically. Consumers ignore unknown namespaces.
- **Validation and limits:** Unknown format versions, invalid timestamps,
  duplicate identities, and size-limit violations are rejected without silent
  truncation.

## Provisional Explore export limits

The Explore application currently accepts at most **262144 bytes (256 KiB)**
of complete canonical UTF-8 Workdown and **100 eligible direct children**.
Exactly the limit is accepted; either excess fails the whole candidate, never
truncates it. Measure the serialized document, including Frontmatter, escaped
Markdown, and its final newline, not JavaScript string length or source text.
Excluded children do not consume the child allowance or alter its outcome.
These are application-profile policies, not universal Workdown format limits.

Rationale and official sources (consulted 2026-11-18):

- [Forge invocation limits](https://developer.atlassian.com/platform/forge/limits-invocation/)
  document a 5 MB invocation payload ceiling;
  [web trigger events](https://developer.atlassian.com/platform/forge/events-reference/web-trigger/)
  explain that serialized request/response metadata also consumes the function
  payload allowance. The conservative 256 KiB document cap leaves headroom for
  JSON-RPC and nested webtrigger JSON escaping. It is an application choice
  below that ceiling, not a documented TWG text-size allowance or a storage
  capacity claim.
- [TWG connector rate limits](https://developer.atlassian.com/platform/teamwork-graph/rate-limits/)
  allow 100 objects per `setObject` request. Use 100 as a conservative initial
  child-work budget, independently of Jira pagination and the byte cap. Child
  summaries are embedded in one document, not individual TWG objects: that
  batch limit does **not** impose an actual 100-child ingestion restriction.

Both values are provisional. The TWG ingestion work must confirm or adjust them against
actual deployed TWG ingestion and the chosen storage/delivery path before
operational use. No such ingestion, storage, or worst-case cloud payload check
has been performed for the export-limits work. Async events must carry references rather
than assuming that a full document fits their separate event payload limits.

Limit errors contain only their stable code/message and no document, source
values, counts, or diagnostics. Other incomplete or invalid candidates also
fail whole. Repeating an unchanged successful export yields identical canonical
bytes; no hash, retry timestamp, or new revision field is required. Storage and
retention of the previous successful document on failure belong to the Exchange and document-storage work.

Source-specific test suites, fixtures, and acceptance gates are documented in
companion profiles; see [Source profiles](#source-profiles).
