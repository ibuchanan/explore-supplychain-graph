# Find a published Workdown in Rovo Search

<!-- cspell:words Workdown workdown Frontmatter Rovo -->

A Workdown published to Teamwork Graph can be discovered as a document in
Rovo Search, separately from its source Jira issue. This guide captures a
manual check observed on the development installation on 2026-11-19. It is
not a guarantee about every query, user, site, or indexing delay.

## What you can do

- Find the Workdown using words from the parent issue's description.
- Find the same document using words unique to an included child's title.
  One Epic document can therefore surface context from its included children.
- Search for a value submitted in Frontmatter. A Start date query returned
  the document in the observed check; this does not establish structured
  metadata filtering or exact Frontmatter preservation.
- Open the result to navigate to the source Epic. The app currently supplies
  the source Jira issue URL, not a separate Workdown viewer.

The Workdown result is an additional discovery route, not a replacement for
Jira Search or evidence that Rovo Chat can answer questions from this content.
Chat answers and citations have not been checked for this app.

## Freshness of included children

Only updates to the shared Epic itself trigger automatic republishing. Child
creation, edits, deletion, and reparenting are deliberately ignored as update
reasons. Child titles and membership in Search reflect the last published
snapshot, not necessarily current Jira content. They can remain stale until
the Epic is updated or an authorized user explicitly starts/repeats the
Exchange with `exchange.start`. That command can retain and ingest content;
a read-only `workdown.export`, `document.get`, or Search query does not refresh
Publication. Search indexing may lag even after Publication is acknowledged.

## Before you search

1. Use the intended site's Rovo Search and an authorized account.
2. Have an admin [create the Workdown connection](how-to.md), with the current
   manifest permissions deployed and activated on the Jira installation.
3. With approval to disclose the source content, publish an eligible Epic
   using the [deployed Publication check](../../DEVELOPMENT.md#run-approved-cloud-checks).
   The existing test may retain and ingest the configured issue; this is a
   write operation, not a read-only Search check.
4. Require `publishedSequence` to equal the current `retainedSequence`.
   That establishes app-recorded ingestion acknowledgment, not indexing.

**Disclosure boundary:** documents have destination-workspace visibility.
Source Jira restrictions are not replicated. Do not publish restricted
content simply to test Search. See the
[disclosure decision](../../specs/adr/0002-workdown-disclosure-boundary.md).

## Search for the document, not just the issue

1. Enter distinctive words from the published parent's description.
2. Apply **Type: Document**. Without it, the original Jira issue may also
   appear; finding that issue alone does not prove Workdown discovery.
3. Identify the Workdown result. If other documents also match, inspect its
   title and destination rather than treating any document result as a pass.
4. Repeat using words unique to an included child's title, absent from the
   parent's title and description. Avoid an issue key as the query.
5. Optionally search a known Frontmatter value that is absent from the body.
   Record whether that absence was actually checked.
6. Open the Workdown result and check that it reaches the expected source
   Epic. Opening Jira verifies navigation, not a Workdown rendering surface.

### Observed examples

These examples come from the developer's existing test data, not fixtures
created by this guide. Choose equivalent phrases from your approved data.

| Query                                      | User-observed result with Type: Document        |
| ------------------------------------------ | ----------------------------------------------- |
| `lost in a maze`                           | Exactly the one Workdown document               |
| `reporting system`                         | Exactly the same Workdown document              |
| `2025-08-16`                               | Exactly the same Workdown document              |
| Words unique to the included child's title | The Workdown document; exact query not recorded |

The first two phrases occur in the configured parent's description. The date
is its configured Start date, but its absence elsewhere was not independently
checked. The developer also confirmed the result link reached the source Epic.

Searching the source or child issue key was not a useful alternative: Rovo
Search intercepted those queries as issue-key exact matches instead of using
the Document filter. That UI behavior is not a failed Workdown ingestion.

## Interpret and record the result

Record the query, active filter, expected document, whether it appeared, and
observation time. Keep screenshots and notes free of credentials and private
content. A manual UI observation is valid Search evidence; the deployed test
in this repository does not automate the Rovo Search UI.

Keep these evidence boundaries separate:

| Observation                                  | Establishes                                | Does not establish                                              |
| -------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| Matching published and retained sequences    | App recorded matching ingestion acceptance | Search discoverability                                          |
| Workdown result for parent-description words | Discovery using parent text                | Exact content retention or phrase-matching semantics            |
| Result for unique included child-title words | Discovery using included child-title text  | Child-description indexing                                      |
| Result for the Start date value              | Discovery for that value                   | Structured date metadata or byte-for-byte Frontmatter retention |
| Result link opens the source issue           | Source navigation works                    | Local viewer HTML/link safety or source ACL replication         |

No clean indexing-latency measurement was captured: this document had earlier
submission attempts before the successful check. For a future timed check,
use an approved fresh document, record acknowledgment and unsuccessful/successful
search times, and report an observed interval rather than a latency guarantee.
A miss within a chosen observation window is not proof of permanent absence.

No public Search API was evaluated for this check. An ingestion or index-status
API, if used separately, is supporting evidence rather than a substitute for
observing the document in Rovo Search. Search success here does not establish
ranking quality, all-user visibility, freshness after Jira edits, deletion,
standalone-document support, or cross-site delivery.

See the [verification record](../../specs/workdown-publication-verification.md)
for the implementation evidence and remaining checks.
