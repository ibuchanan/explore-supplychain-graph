# Glossary

## Peer Site

A Jira site participating in a Peer Connection. Being peers describes the connection between sites, not a business partnership between their organizations.

## Peer Connection

A one-way site-to-site trust relationship established through mutual authorization by the Peer Sites' Site Admins. It permits sharing from its Source to its Destination, not in the reverse direction. Sharing in both directions requires a separate Peer Connection in each direction. An established Peer Connection permits source-side Project Admins to decide what and when to share without per-Exchange approval by the destination.

## Exchange

An ongoing sharing arrangement for curated, read-only content about a Jira Epic over an established Peer Connection. Source-side Project Admins decide when sharing begins. Shared content is expected to remain up to date as the source changes, rather than requiring manual publication of every update. An Exchange does not require mutual approval or a destination Jira project or work item to be selected by the app.

## Publication

The outcome of a changed Workdown document having been accepted at the Destination and its ingestion acknowledged by TWG. A Publication is identified by the shared document's identity and update sequence number, within its connection context; it has no separate identifier. Publications do not imply that historical document versions remain available. The current document is retained on a latest-only basis.

## Subject

The Jira Epic that is the main focus of an Exchange.

## Source

The side of an Exchange that provides the shared content. Source is a role relative to an app installation, not a permanent classification of a site; a site may participate as both Source and Destination across Exchanges.

## Destination

The side of an Exchange that receives the shared content. Destination is a role relative to an app installation, not a permanent classification of a site; a site may participate as both Source and Destination across Exchanges. Routing received content to local work is the destination's concern, not part of an Exchange's responsibilities.

## Workdown

A convention of Markdown with Frontmatter designed to represent work items. The curated content for an Exchange's Subject is represented in one Workdown document. The supported fields and treatment of children are fixed conventions, not administrator-configurable selections. The convention's detailed content model is defined separately from the Exchange that uses it.

## Jira change

A change in Jira to a Subject or its included children that may alter the Workdown document, such as an edit, child creation, deletion, or reparenting. Source-side and inbound: it is what makes an Exchange stay current.

## Jira product event

The platform's delivery of a Jira change to the app, subscribed to through a Forge `trigger` module in the manifest. It is the only mechanism by which a Jira change reaches the app, and it is not guaranteed to be complete or to identify the affected Subject. It runs without a user, so it never authorizes disclosure on its own. It is not a Publication, not a Publication notification, and not a Forge app event.

## Publication notification

The destination-local, outbound signal that a Publication occurred, delivered as the `publication.published` JSON-RPC notification (declared under `x-notifications` in the OpenRPC document) and, optionally, through the destination-owned Automation incoming webhook. It carries the connection context, document identity, and update sequence number. It is not a Forge event and uses no Forge `event` or `trigger` module.

## Forge app event

Forge's platform mechanism for one app publishing an event that other apps subscribe to. Deliberately unused here: it cannot carry a custom payload. Do not use "app event" for anything else in this project.
