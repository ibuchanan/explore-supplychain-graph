# Threaddown Specification

## Overview

Threaded discussions — Slack threads, Discourse topics, GitHub issues, Jira comments, support tickets — contain rich structure but are inefficient to work with at scale. Raw JSON APIs are verbose and platform-specific. Plain text transcripts lose structure. HTML exports carry unnecessary noise. Platform-specific markdown is inconsistent across sources.

Threaddown is a markdown-based format for representing threaded discussions optimized for LLM consumption. It provides a consistent, token-efficient representation that works across platforms, remains readable to humans, and is easy for both programs and language models to parse.

## Design Goals

1. **LLM-first**: Optimized for parsing by language models with minimal token overhead
2. **Platform-agnostic**: Common denominator representation across different platforms
3. **Human-readable**: Editable and understandable by humans without tooling
4. **Reversible**: Can reconstruct the original conversation with reasonable fidelity
5. **Extensible**: Supports platform-specific metadata when needed
6. **Minimal formatting**: Reduce token count while maintaining clarity

## Core Concepts

### Thread
A collection of posts with a common topic. Every thread has:
- **Title**: Subject or topic
- **Platform**: Source platform (Slack, GitHub, Discourse, Jira, etc.)
- **Identifier**: Platform-specific ID
- **Creation time**: When the thread started
- **Participants**: List of users involved
- **Posts**: Ordered list of posts (first post through all replies)

### Post
A single contribution to a thread. Each post has:
- **Author**: User who wrote the post
- **Timestamp**: When the post was sent (ISO 8601)
- **Subject**: The post's subject line or title (if any)
- **Content**: The post body (markdown, normalized)
- **Metadata**: Reactions, attachments, edits, etc.

## Format Specification

A Threaddown document is a Markdown file with four structural layers: YAML front-matter, an H1 summary section, H6 post sections, and inline elements within post content.

Heading levels H2–H5 are reserved. When converting source content that uses any heading level, convert those headings to bold text to avoid structural ambiguity.

### Front-matter: Metadata

YAML front-matter appears at the top of the file, before any Markdown content. It holds thread-level metadata sourced from the originating platform.

A Threaddown document is a conformant **Open Knowledge Format (OKF) v0.2** document of `type: Discussion`. The front-matter carries the OKF concept fields plus Threaddown-specific thread statistics; the mapping between the two is recorded in the [OKF conformance](#okf-conformance) section.

**Required fields:**
- `type`: The OKF concept type. Always `Discussion` for a Threaddown document.
- `source_id`: A namespaced unique identifier in the form `"platform:id"` (e.g. `"discourse:4567"`). A Threaddown extension, not an OKF field.

**OKF describing fields:**
- `title`: The thread title (OKF `title`).
- `resource`: The canonical thread URI (OKF `resource`), e.g. `"https://forum.example.com/t/topic/4567"`.
- `tags`: Array of platform-native tag names (OKF `tags`), e.g. `["forge-ui", "eap"]`. Omitted when the source has no tags.

**OKF provenance and trust fields:**
- `sources`: Records the material a document derives from — the source thread — as a list of `{ id, resource, title }` entries (OKF `sources`).
- `generated`: Records how the document was produced, as `{ by, at }` where `by` is the converter actor `threaddown/<version>` and `at` is the ISO 8601 conversion time (OKF `generated`).

**Threaddown-specific fields:**
- `participant_count`: Number of distinct participants
- `post_count`: Total number of posts
- `start_date`: ISO 8601 UTC timestamp of the first post
- `end_date`: ISO 8601 UTC timestamp of the last post
- `last_activity`: ISO 8601 UTC timestamp of most recent activity (post, edit, or reaction)
- `views`: View count from the source platform
- `likes`: Total like or reaction count across the thread
- `thread_status`: Thread lifecycle status (`"active"`, `"closed"`, `"archived"`). Kept separate from the OKF `status` key, which is reserved for knowledge-lifecycle semantics and left unset.
- `language`: BCP 47 language tag (e.g. `"en"`)

#### Example

```yaml
---
type: Discussion
title: "Q4 Planning"
resource: "https://community.example.com/t/q4-planning/4567"
tags: ["planning", "q4", "team-meeting"]
source_id: "discourse:4567"
participant_count: 3
post_count: 12
start_date: "2023-10-15T00:00:00Z"
end_date: "2023-10-20T00:00:00Z"
last_activity: "2023-10-20T00:00:00Z"
views: 234
likes: 15
thread_status: "active"
language: "en"
generated: { by: threaddown/0.2.0, at: "2025-10-21T09:00:00Z" }
sources:
  - id: "discourse:4567"
    resource: "https://community.example.com/t/q4-planning/4567"
    title: "Q4 Planning"
---
```

### Alignment with OKF

Threaddown is deliberately aligned with the **Open Knowledge Format (OKF) v0.2**: a Threaddown document is not a bespoke export but a first-class OKF concept. The conformance mapping below is the concrete result of that intent, which rests on four commitments:

1. **One type.** Every Threaddown document declares `type: Discussion`, so an OKF consumer — a catalog, validator, or visualizer — can ingest a directory of Threaddown files without a Threaddown-specific adapter.
2. **Inherited provenance and trust.** Threaddown adopts OKF's `sources` (what a document derives from) and `generated` (who produced it, and when) instead of inventing parallel fields, so provenance chains assemble in one shared vocabulary.
3. **Separated lifecycle.** A thread's own state (`thread_status`: `active`/`closed`/`archived`) is a producer extension, kept distinct from OKF's knowledge-lifecycle `status`. A closed thread says nothing about whether the knowledge it holds is stable or deprecated; the two axes never collide.
4. **Extensible.** Statistics and identifiers OKF has no word for (`source_id`, `participant_count`, `views`, `likes`, …) are emitted as producer-defined extensions, which OKF permits and consumers preserve.

The alignment is compositional: downstream passes build on it by emitting further OKF concepts whose `sources` point back at the originating `Discussion` (for example the use-case extraction layer's `Observation` documents, and the `Finding` documents that aggregate them), so the pipeline composes into one OKF graph rather than a chain of ad-hoc formats.

### OKF Conformance

A Threaddown document is a conformant **Open Knowledge Format v0.2** concept whose `type` is `Discussion`. Every field above maps onto OKF's front-matter vocabulary as follows:

| Threaddown field | OKF field | Kind | Notes |
|---|---|---|---|
| `type` | `type` | string | Always `Discussion`. The only field OKF requires for conformance (OKF §4.1, §11). |
| `title` | `title` | string | Thread title. |
| `resource` | `resource` | URI | Canonical thread URL. |
| `tags` | `tags` | `list[string]` | Platform-native tag names. |
| `sources` | `sources` | `list` | One `{ id, resource, title }` entry pointing at the source thread. |
| `generated` | `generated` | mapping | `by` is the `threaddown/<version>` actor; `at` is the ISO 8601 conversion time. |
| `thread_status` | — (extension) | string | The thread's own lifecycle (`active`/`closed`/`archived`). A Threaddown extension key. |
| `status` | `status` | — | Deliberately **not emitted**. OKF's `status` (`draft`/`stable`/`deprecated`) is knowledge-lifecycle semantics unrelated to a thread's open/closed state. Leaving it unset means OKF's `stable` default applies, and avoids a naming collision with `thread_status`. |

Because it emits a non-empty `type` and follows OKF's provenance (`sources`), trust (`generated`), and lifecycle conventions, a Threaddown document is a fully conformant OKF `Discussion` concept. All remaining front-matter keys (`source_id`, the counts, the dates, `views`, `likes`, `thread_status`, `language`) are producer-defined extensions, which OKF permits and consumers must preserve (OKF §4.1, §11).

### H1 Section: Summary

The single H1 heading names the thread. The body text beneath it is a human- and LLM-readable summary of the thread as a whole — not a verbatim post. It may be generated or hand-written.

The summary should include:
- A brief description of the thread's purpose
- Key participants and timespan
- Notable topics or decisions
- Resolution status

#### Example

```markdown
# Project Discussion: Q4 Planning

This thread contains 12 messages from 3 participants over 6 days.
Started by Alice on October 15, 2023. Last updated October 20, 2023.
Status: Active | Labels: planning, q4, team-meeting

Key topics: budget allocation, timeline adjustments, resource planning.
Resolution: Unresolved.
```

### H6 Sections: Posts

Each post — including the first post — is represented as an H6 section. The H6 heading line encodes the post's timestamp, author, and subject. The body below it is the post content in normalized Markdown.

**Heading format:**
```
###### [ISO 8601 timestamp] [author] posted "[subject]"
###### [ISO 8601 timestamp] [author] posted a reply
```

- `[ISO 8601 timestamp]`: Full UTC timestamp, e.g. `2023-10-15T09:30:00Z`
- `[author]`: A Markdown hyperlink `[Display Name](profile-url-or-email)` when a URL or email is available; plain display name otherwise
- `"[subject]"`: Quoted subject line describing the post's content. Prefer a descriptive subject on every post — including replies — to improve LLM comprehension and enable scanning. Fall back to `posted a reply` only when no meaningful subject is available.

Posts appear in chronological order. All posts are equal — the first post uses the same H6 format as replies.

**Threading model:** Threaddown uses flat chronological order only — no nesting. When a reply references a specific earlier post, use a blockquote (`> quoted text`) to provide context. When the blockquote was mechanically generated by the source platform's quote-reply feature (rather than typed by the author), use an attributed quote to mark the content as duplicative — see the **Quotes** entry under Inline Elements. This keeps parsing simple, avoids the unreliable whitespace-sensitivity of indentation-based nesting, and lets downstream tools distinguish platform-generated quotes from original content.

**Content completeness:** Post content is always preserved in full. The format does not define truncation or summarization. If a consumer (e.g. an LLM with a limited context window) needs to shorten posts, that is a tooling concern outside the scope of this specification.

**Content normalization:** Converters should prefer source-native markdown when the platform API exposes it. If only rendered HTML is available, converters may derive markdown from HTML, but the serialized Threaddown post body should be normalized to reduce formatting noise while preserving meaning. Required normalization rules:

- Tighten loose lists by removing blank lines between adjacent bullet items and between adjacent numbered items
- Strip thematic breaks such as standalone `---` lines from post bodies
- Convert curly single and double quotes to plain ASCII quotes: `‘’` -> `'`, `“”` -> `"`
- Downgrade any source H1-H6 headings to bold text

Normalization should be conservative: preserve paragraph boundaries, blockquotes, code fences, links, and list nesting.

**Deleted or redacted posts:** Preserve the H6 heading to maintain chronological position and accurate `post_count`. Replace the post body with a reason marker:

- `[deleted by author]` — the author removed their own post
- `[removed by moderator]` — a moderator or admin removed the post
- `[redacted for PII]` — content was stripped for privacy compliance

If the reason is unknown, use `[deleted]`.

#### Example

```markdown
###### 2023-10-15T09:30:00Z [Vicky Hu](https://community.example.com/u/VickyHu) posted "Early Access Program: Forge UI fullscreen modal"

We're excited to announce the launch of the Early Access Program (EAP) for fullscreen modals in Forge! :tada:

###### 2023-10-15T10:20:00Z [Bob](bob@example.com) posted a reply

Thanks for kicking this off. I think we need to adjust the timeline.

**Attachments:**
- [timeline-proposal.pdf](https://example.com/files/timeline-proposal.pdf)

**Reactions:** 👍 (3), ❤️ (1)

###### 2023-10-15T10:45:00Z [charlie](https://example.com/u/charlie) posted "Off-topic comment"

[removed by moderator]
```

### Inline Elements

These conventions apply within post content (the body of each H6 section):

- **Links**: `[text](url)` — standard Markdown hyperlinks
- **Mentions**: `[@username](https://example.com/profile/username)` — profile URL when available; plain `@username` when not. Strip PII if required, retaining only a system ID.
- **References**: `[JIRA-123](https://jira.atlassian.net/browse/JIRA-123)` — hyperlink to any referenced thread, issue, or ticket
- **Attachments**: `[filename.pdf](url)` listed under a `**Attachments:**` bold label
- **Quotes (unattributed)**: `> quoted text` — standard Markdown blockquote for author-written quotations and emphasis. These represent original content by the post author.
- **Quotes (attributed)**: Platform-generated quote-reply blocks — content mechanically inserted by the source platform when a user replies to a specific post. These duplicate content that already appears elsewhere in the thread. Mark them with a `[!quote]` attribution line as the first line of the blockquote:

  ```markdown
  > [!quote @username post:3]
  > does the modal support custom heights?
  ```

  The attribution line format is `[!quote @author post:N]` where `@author` is the quoted user's mention handle and `post:N` references the post number within the thread. Both fields are optional — use `[!quote]` alone when attribution metadata is unavailable. The `[!quote]` marker signals that the blockquote content is duplicative and may be safely stripped by downstream tools (e.g. topic modeling, summarization) without losing unique information.
- **Code blocks**: ` ```language … ``` ` — fenced code blocks preserved as-is
- **Reactions**: `**Reactions:** 👍 (3), ❤️ (1)` — bold label followed by emoji and count pairs
- **Edit timestamps**: `• 2023-10-15T09:45:00Z (edited)` — inline note appended to content when a post was edited
- **Post ID**: `**Post ID:** platform:id` — optional platform-native message identifier appended to post content for programmatic reference back to the source (e.g. `**Post ID:** discourse:98594/3`)
- **Inaccessible attachments**: `[filename.png]() (unavailable)` — use empty URL `()` with a parenthetical reason when the original file is expired, private, or otherwise inaccessible. Possible reasons: `(expired)`, `(unavailable)`, `(private)`.

## Parsing Rules

### Formal Grammar (simplified)

```
threaddown    ::= front-matter blank-line h1-section (blank-line h6-section)*
front-matter  ::= '---' newline (yaml-field newline)* '---'
yaml-field    ::= key ': ' value
h1-section    ::= '# ' title newline summary-text
h6-section    ::= '###### ' timestamp ' ' author ' posted ' subject newline post-content
timestamp     ::= /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/
author        ::= '[' display-name '](' url-or-email ')' | display-name
subject       ::= '"' descriptive-text '"' | 'a reply'
post-content  ::= (markdown-block)*
```

**Note:** The `subject` production prefers the `'"' descriptive-text '"'` form for all posts. Use `'a reply'` only as a fallback when no meaningful subject can be derived.

### Heading Levels

| Level | Purpose |
|---|---|
| H1 | Thread summary (exactly one per document) |
| H2–H5 | Reserved — do not use |
| H6 | Each post (first post and all replies) |

Source content that contains H1–H6 headings must be downgraded to bold text on conversion.

Loose list formatting from source markdown should be tightened during conversion so adjacent list items are serialized without blank lines unless a list item intentionally contains multiple paragraphs.

Standalone thematic breaks (`---`) in source post bodies should be removed during conversion rather than preserved as post content.

Typographic quote characters in source content should be normalized to plain ASCII single and double quotes in serialized post bodies.

### Timestamps

- All timestamps are ISO 8601 in UTC: `2023-10-15T09:30:00Z`
- Use the full date-time form in H6 headings
- When source data provides only a local time, convert to UTC if the timezone is known; otherwise record as-is with a note

### Author References

- Prefer a Markdown hyperlink `[Display Name](url)` using the platform profile URL
- Use `[Display Name](email@example.com)` for email-sourced threads
- Fall back to plain display name when no URL or email is available
- Strip PII (real name, email) if required; substitute a system or anonymized ID

### Platform Identifiers in Front-matter

| Platform | `source_id` form | `resource` example |
|---|---|---|
| Slack | `slack:C0123456789.123456` | `https://slack.com/archives/...` |
| GitHub | `github:owner/repo#123` | `https://github.com/owner/repo/issues/123` |
| Discourse | `discourse:4567` | `https://forum.example.com/t/topic/4567` |
| Jira | `jira:PROJ-123` | `https://jira.example.com/browse/PROJ-123` |
| Email | `email:msg-id@domain` | omitted |

### Output Files

The Discourse converter names one file per topic `{topic_id}-{slug}.md`:

- `{topic_id}` is the numeric topic id — the unfixed component of `source_id`
  (e.g. `98594` of `discourse:98594`) — so the filename alone points back at the
  source thread.
- `{slug}` is the title in URL-safe form: lowercased, with every run of
  non-alphanumeric characters folded to a single `-`. The name contains only
  `[a-z0-9-]` and no spaces, so it needs no shell quoting and reads back to the
  title at a glance.

A single-topic export (`threaddown topic`) writes to an explicit `--output`
path; a category export (`threaddown category`) writes these files into a
per-category directory, so the directory name carries the category and the
filename carries the id and title. The naming rule is defined in
[`threaddown.cli.topic_filename`](../src/threaddown/cli.py), and the cross-tool
data layout is documented in [CONVENTIONS.md](../../../CONVENTIONS.md).

### Error Handling

- Missing timestamp: record as `0000-00-00T00:00:00Z` and flag in a comment
- Missing author: use `[unknown]` as display name
- Broken reply chain: preserve chronological order; do not fabricate parent references
- Platform-specific fields with no mapping: include as additional YAML front-matter fields

## Conversion Guidelines

### From Slack

1. Extract thread using `conversations.replies` API
2. Convert `ts` field to ISO 8601 UTC timestamp
3. Map `user` ID to display name via `users.info`; use profile URL as hyperlink
4. Thread parent message is the first H6 post
5. Map `reactions` array to `**Reactions:** 👍 (3) …`
6. Map `files` array to `**Attachments:**` list

### From GitHub

1. Use Issues or Pull Requests API for the opening post; Comments API for replies
2. `user.login` becomes display name; link to `https://github.com/username`
3. `author_association` (OWNER, COLLABORATOR, CONTRIBUTOR, etc.) is informational — omit or note in post content if relevant
4. Aggregate `reactions` to `**Reactions:** …`
5. `labels` and `state` go into front-matter `tags` and `thread_status`

### From Discourse

1. Use Posts API (`/t/{topic_id}.json`)
2. Prefer the `raw` markdown field for post bodies when available; fall back to `cooked` HTML only when `raw` is unavailable
3. Convert Discourse quote-reply blocks to attributed quotes. In the `raw` field, these appear as `[quote="username, post:N, topic:T"]…[/quote]` BBCode. In the `cooked` HTML field, they appear as `<aside class="quote" data-username="…" data-post="…">`. Convert both forms to `> [!quote @username post:N]` attributed blockquotes. Author-written `>` blockquotes (those not wrapped in Discourse quote BBCode or `<aside class="quote">`) remain as plain unattributed blockquotes.
4. Normalize the selected body according to the post-content normalization rules above
5. `username` becomes display name; link to `https://forum/u/username`
6. First post (`post_number: 1`) maps to first H6; it is the opening post, not special
7. `like_count` maps to `**Reactions:** ❤️ (N)`
8. `topic_title` becomes the H1 title
9. `tags` go into front-matter `tags`; `category_name` is not mapped (superseded by the OKF provenance model — a converter may add it back as a producer-defined extension)

### From Jira

1. Use Issue Comments API
2. `author.displayName` becomes display name; link to Jira profile URL
3. `updateAuthor` and `updated` field map to an edit timestamp note in content
4. Issue fields (`priority`, `assignee`, `reporter`) go into front-matter as additional extension fields; Jira's own `status` maps to `thread_status`

### From Email

1. Parse RFC 5322 headers: `Message-ID`, `From`, `Date`, `Subject`, `In-Reply-To`
2. `Message-ID` becomes `source_id` value
3. `From` display name and address become author hyperlink
4. `Date` converts to ISO 8601 UTC
5. Reconstruct thread order using `In-Reply-To` / `References` chain; fall back to `Date` sort

## Examples

### Discourse Topic

```markdown
---
type: Discussion
title: "Early Access Program: Forge UI fullscreen modal"
resource: "https://community.developer.atlassian.com/t/forge-ui-fullscreen-modal-eap/98594"
tags: ["forge-ui", "eap"]
source_id: "discourse:98594"
participant_count: 4
post_count: 6
start_date: "2023-10-15T09:30:00Z"
end_date: "2023-10-16T14:00:00Z"
last_activity: "2023-10-16T14:00:00Z"
views: 234
likes: 8
thread_status: "active"
language: "en"
generated: { by: threaddown/0.2.0, at: "2023-10-17T09:00:00Z" }
sources:
  - id: "discourse:98594"
    resource: "https://community.developer.atlassian.com/t/forge-ui-fullscreen-modal-eap/98594"
    title: "Early Access Program: Forge UI fullscreen modal"
---

# Early Access Program: Forge UI Fullscreen Modal

This thread announces and discusses the EAP for fullscreen modals in Forge.
Started by Vicky Hu on October 15, 2023. Last updated October 16, 2023.
Status: Active | Labels: forge-ui, eap

Key topics: EAP sign-up, modal sizing behavior, known limitations.
Resolution: Unresolved — EAP ongoing.

###### 2023-10-15T09:30:00Z [Vicky Hu](https://community.developer.atlassian.com/u/VickyHu) posted "Early Access Program: Forge UI fullscreen modal"

We're excited to announce the EAP for fullscreen modals in Forge! :tada:

To sign up, fill out [this form](https://example.com/eap-signup).

**Known limitations:**
- Maximum width is 1200px
- Not supported in mobile view

###### 2023-10-15T10:20:00Z [bob-dev](bob@example.com) posted "Question about custom height support"

Thanks for this! Quick question: does the modal support custom heights?

###### 2023-10-15T11:05:00Z [Vicky Hu](https://community.developer.atlassian.com/u/VickyHu) posted "Clarification on height behavior"

> [!quote @bob-dev post:2]
> does the modal support custom heights?

Yes — height is set by content up to a maximum of 90vh.

**Reactions:** 👍 (3), ❤️ (1)
```

### GitHub Issue

```markdown
---
type: Discussion
title: "Add feature for batch processing"
resource: "https://github.com/owner/repo/issues/123"
tags: ["enhancement", "api"]
source_id: "github:owner/repo#123"
participant_count: 3
post_count: 4
start_date: "2024-01-15T10:30:00Z"
end_date: "2024-01-15T10:46:00Z"
last_activity: "2024-01-15T10:46:00Z"
thread_status: "open"
language: "en"
generated: { by: threaddown/0.2.0, at: "2024-01-16T09:00:00Z" }
sources:
  - id: "github:owner/repo#123"
    resource: "https://github.com/owner/repo/issues/123"
    title: "Add feature for batch processing"
---

# Add feature for batch processing

This issue proposes a new batch processing endpoint.
Opened by alice on January 15, 2024. Last updated January 15, 2024.
Status: Open | Labels: enhancement, api

Key topics: endpoint design, payload format.
Resolution: Unresolved.

###### 2024-01-15T10:30:00Z [alice](https://github.com/alice) posted "Add feature for batch processing"

I think we should add a new endpoint for batch processing.

**Proposal:**
- New POST endpoint `/batch`
- Accepts array of operations
- Returns array of results

###### 2024-01-15T10:35:00Z [bob](https://github.com/bob) posted "Question about payload format"

What would the payload look like?

###### 2024-01-15T10:40:00Z [charlie](https://github.com/charlie) posted "Example payload structure"

Like this:

```json
{ "operations": [...] }
```

**Reactions:** 👀 (2)

###### 2024-01-15T10:46:00Z [alice](https://github.com/alice) posted "Proposal updated based on feedback"

Updated the proposal based on feedback. • 2024-01-15T10:46:00Z (edited)
```

## Design Decisions

These questions were identified during the design of Threaddown and have been resolved:

1. **Nested replies**: Flat chronological order only. Nesting is not supported. Use blockquotes to reference earlier posts when reply context is needed. Rationale: indentation-based nesting is fragile and parsed unreliably by LLMs (see *Alternative Formats Considered* in the design rationale).

2. **Very long posts**: Preserve in full. The format does not define truncation, summarization, or character limits. Truncation is a consumer concern — tools reading Threaddown files may shorten content for their context windows, but the canonical document is always complete. Rationale: design goals #2 (platform-agnostic) and #4 (reversible) require lossless content.

3. **Deleted or redacted messages**: Preserve as a tombstone entry. Keep the H6 heading (timestamp, author, subject) and replace the body with a reason marker: `[deleted by author]`, `[removed by moderator]`, `[redacted for PII]`, or `[deleted]` when the reason is unknown. Rationale: tombstones maintain chronological position, preserve accurate `post_count`, and signal that content existed.

4. **Platform-native message IDs**: Optional. Use `**Post ID:** platform:id` as inline metadata at the end of post content, following the same pattern as Reactions and Attachments. Not required — omit when IDs are unavailable or unnecessary. Rationale: avoids overloading the already-dense H6 heading while enabling programmatic reference back to the source.

5. **Cross-platform user identity mapping**: Out of scope. Each post uses the platform-native author identity. Mapping the same person across platforms (e.g. `@vicky` on Slack vs. `VickyHu` on Discourse) is a tooling concern for consumers that aggregate multiple Threaddown files. Rationale: identity resolution is an application-level problem that varies by use case.

6. **Thread title changes over time**: Not tracked. The H1 heading reflects the thread title at the time of conversion. Historical renames (e.g. Discourse topic retitles) are not recorded. Rationale: title history is a rare edge case that adds complexity without clear benefit to LLM comprehension.

7. **Attachments with no accessible URL**: Use empty-URL link syntax with a parenthetical reason: `[filename.png]() (expired)`. Possible reasons include `(expired)`, `(unavailable)`, and `(private)`. This preserves the attachment's existence and name while clearly indicating inaccessibility. Rationale: maintains the standard attachment syntax so parsers don't need special cases.

8. **Source markdown normalization**: Normalize post bodies during conversion rather than preserving platform-native markdown verbatim. Tighten loose lists, remove thematic breaks, normalize curly quotes to ASCII, and demote headings to bold text. Rationale: raw platform markdown often contains presentation-oriented noise that is valid but inefficient and inconsistent for downstream parsing; conservative normalization keeps meaning while improving readability and token efficiency.

9. **Attributed quotes for platform-generated quote-replies**: Use `> [!quote @author post:N]` as the first line of a blockquote to mark content mechanically inserted by the source platform's quote-reply feature. Unattributed `> ` blockquotes remain for author-written quotations. Rationale: platform quote-reply blocks duplicate content that already exists in an earlier post within the same thread. Downstream NLP pipelines (e.g. topic modeling, embedding generation) need to strip duplicative content to avoid inflating the weight of quoted passages, but must keep original blockquotes that represent the author's own words. The `[!quote]` syntax follows the GitHub alert/admonition convention (`[!NOTE]`, `[!WARNING]`), is valid Markdown that renders as literal text, and is trivially matchable with a single regex for programmatic removal.
