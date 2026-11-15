# Workdown — Scope and Decision Outline

Status: agreed scope; see the approved [Workdown specification](workdown-spec.md) for the format.

The [Workdown specification](workdown-spec.md) builds on
[Threaddown](threaddown.md). It defines a reusable work-item format and a
separate Explore Jira Epic profile, whose field, child, and disclosure rules
were approved on 2026-11-15. This outline records the earlier agreed scope.

## Problem Statement

A cross-site share needs a curated, readable representation of Jira work that does not expose arbitrary source fields or require access to the source Jira site. The content convention needs its own definition rather than emerging accidentally from transport or indexing code.

## Solution

Define Workdown as Markdown with Frontmatter designed for work items. Supplychain Graph converts an Epic and its supported context into one Workdown document. Specify content independently of the Exchange, peer authentication, notifications, and TWG ingestion that carry it.

## User Stories

1. As a destination reader, I want understandable work context in one document, so that I can read it without source-site access.
2. As a source Project Admin, I want predictable fixed content conventions, so that I know what sharing discloses.
3. As a reader, I want the Subject and provenance identifiable, so that I can interpret the document's origin.
4. As a reader, I want included child context represented consistently, so that the document is coherent.
5. As an implementer, I want semantic Epic fields distinguished from site-specific field IDs, so that conversion works across Jira sites.
6. As an implementer, I want deterministic conversion, so that unchanged context does not create spurious Publications.
7. As an integration consumer, I want a specified Frontmatter and body convention, so that I need not reverse-engineer generated output.

## Implementation Decisions

- Markdown with Frontmatter is the format family; the exact Frontmatter serialization and schema remain undecided.
- The initial source is Jira, with an Epic as the Subject.
- Produce one document, not one document per child.
- The bounded supported field set is maintained in code, not administrator configuration. It is intended to cover standard Epic work-item fields, including semantic fields Jira exposes as custom fields. The exact list has not been approved.
- Child inclusion and representation are also hard-coded conventions to be decided here. No prior proposal for explicit administrator child selection is accepted.
- Shared content is curated and read-only. No manual editing of generated output initially.
- Workdown content changes participate in the parent spec's document sequencing and publication behavior; do not introduce a second revision model through this outline.

### Decisions required before implementing conversion

1. Enumerate supported semantic fields, where each appears, and how site-specific Jira field identifiers are resolved.
2. Define child inclusion, hierarchy depth, ordering, and rendering. Do not assume all children or only direct children without a decision.
3. Specify Frontmatter keys, types, required/optional behavior, identity/provenance conventions, and compatibility/versioning needs.
4. Specify Markdown structure and handling of Jira rich text, links, mentions, and unsupported content.
5. Decide whether comments, attachments, restricted content, and other potentially sensitive material are excluded or represented; none is implicitly included by this outline.
6. Define missing/unavailable-field and partial-read behavior so failures cannot silently broaden disclosure.
7. Define deterministic ordering and normalization, content-change comparison, and document size/truncation behavior.
8. Map included content changes to Jira event coverage, including how relevant child events locate affected Subjects. This must align with event-only freshness.
9. Verify which TWG content MIME type preserves the intended Markdown/Frontmatter representation.

## Testing Decisions

- Use fixture-based tests at the Jira-to-Workdown conversion boundary, asserting externally visible document content and errors, not private helper structure.
- Include semantically equivalent Jira fixtures with different custom-field IDs.
- Cover the chosen field allowlist, child rules, deterministic output, unsupported content, and partial failures once decided.
- Verify unchanged content does not cause a new Publication through parent Command tests.
- Validate representative documents through deployed TWG ingestion and the eventual read-only viewer; do not infer Search rendering fidelity from string equality alone.

## Out of Scope

- A finalized schema or field list in this outline.
- Administrator-configured field profiles or child-selection controls.
- Separate indexed TWG objects per child.
- Peer Connection protocol, webhook routing, document archives, or Jira mutation.

## Further Notes

Resolve the open decisions through a focused Workdown design session. Do not treat this outline as authorization to invent format details during implementation. The [overall Explore specification](supplychain-graph.md) governs Exchange lifecycle, identity, sequencing, storage, and delivery.
