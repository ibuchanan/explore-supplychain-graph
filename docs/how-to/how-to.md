# Create the Workdown connector connection as an admin

<!-- cspell:words Workdown workdown webtrigger supplychain Rovo devb -->

Use this guide to enable this app's **Workdown** Teamwork Graph connector on
an already installed Jira development site. This is an admin setup procedure,
not a claim that document ingestion currently succeeds.

**Current state, 2026-11-19:** the deployed Publication test passes, and the
developer has found the Workdown through manual Rovo Search checks. Creating a
connection or seeing **Connected** alone still proves neither result. Follow
the [manual Search guide](search-workdown.md) after publication and the
[verification record](../../specs/workdown-publication-verification.md)
for the evidence and remaining limitations.

## Before you start

- Use an organization admin account with access to the target site's
  **Connected apps** page in Atlassian Administration. Jira project-admin
  permission for an Exchange is a separate permission, not a substitute.
- Have the app deployed to **development** and installed in **Jira** on the
  intended site. The current loopback implementation rejects other Forge
  environments. The development site used in the recorded investigation is
  `one-atlas-devb.atlassian.net`; choose your own authorized target deliberately.
- Have the installer confirm the installation includes the current manifest
  permissions: `storage:app`, `write:object:jira`, `read:object:jira`, and
  `delete:object:jira`. Deployment alone does not
  upgrade an existing installation's permissions. If setup is still needed,
  follow [local Forge setup][local-setup].
- Use only content approved for disclosure to destination workspace users.
  This connector declares `replicatesPermissions: false`; published documents
  use workspace visibility, not the source Jira issue's access controls.

Do not put an API token, password, RPC URL, or shared secret into a connection
nickname. This app has **no connector-specific configuration form** and does
not ask the admin for source-system credentials.

## What refreshes a shared document

After an Exchange is started, only updates to its shared Epic itself trigger
automatic republishing. Child creation, child-field edits, deletion, and
reparenting do not trigger updates to the shared document. Children remain a
snapshot until the next Epic update or an authorized explicit `exchange.start`.
The full eligible child snapshot is reread on regeneration; there is no
scheduled refresh. Merely reading/exporting a document does not republish it.
This deliberate freshness limitation can leave child information stale
indefinitely, including removed or reparented children. Source-Epic deletion
also does not trigger withdrawal. Connection setup alone does not start sharing.

## Create the connection in Atlassian Administration

1. Open [Atlassian Administration](https://admin.atlassian.com/) and select
   the organization containing the target Jira site.
2. Select **Apps**, select the site where this app is installed, then open
   **Connected apps**.
3. Find the installed `explore-supplychain-graph` app and select
   **View app details**. Confirm the site and development installation; do not
   select the similarly named Wonder or Discourse app. For this repository's
   existing registration, the app ID in [the manifest](../../manifest.yml) is
   `ari:cloud:ecosystem::app/dafd6b90-4561-4a15-960f-758ff81672cd`.
   A separately registered clone will have its own app ID.
4. Open the **Connections** tab. Under **Teamwork Graph connectors**, find
   **Workdown** and select **Connect**.
5. If prompted for a connector nickname, choose a descriptive, non-secret name,
   such as **Workdown development loopback**. There are no app-specific fields
   to enter: do not supply a Jira token, connection ID, Epic key, or peer URL.
6. Review the displayed capabilities and confirm **Connect**. The connector
   declares document objects, no source-permission replication, upsert sync,
   and incremental-sync support. These declarations are not evidence that
   background refresh or deletion propagation is implemented.
7. Check the connection's resulting status. If setup reports an error, stop
   and inspect the lifecycle logs rather than creating additional connections.

The navigation above follows the
[official connector tutorial](https://developer.atlassian.com/platform/teamwork-graph/build-a-teamwork-graph-connector/).
UI labels may vary. The procedure has not been browser-verified by the agent;
the existing setup and subsequent Search observations were reported by the
developer.

## What this action does

The platform invokes `graph.onGraphConnectionChange`, declared in the manifest
and implemented in [src/graph.ts](../../src/graph.ts). On creation or update,
the development handler saves the platform-issued connection ID for the local
site and internal `development-loopback` binding. It does not ingest documents
at this point, and there is no scheduled task runner in the current manifest.

These names have different roles:

| Name                                | Meaning                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `explore-supplychain-graph`         | Installed Forge app                                                    |
| **Workdown** / `workdown-documents` | Connector display name / manifest key                                  |
| Your nickname                       | Admin-facing label; not read as an Exchange binding                    |
| Platform connection ID              | Issued by Atlassian and saved by the lifecycle handler                 |
| `development-loopback`              | App-owned development Exchange binding, not a value to enter in the UI |

The current handler allows one saved graph connection per site for this
loopback. A different connection ID is rejected while one is already bound.
Do not create a second connection to work around an ingestion error.

## Verify setup separately from publication

1. Confirm the admin UI shows the intended Workdown connection on the correct
   site. Record its nickname, app/environment, site, and creation time without
   recording credentials.
2. Ask the developer to inspect development Forge logs for
   `workdown.graph.connection` with outcome `bound`. This confirms the local
   binding was saved, not that graph ingestion was accepted. A later ingestion
   log's `graph-binding: bound` means a saved ID was found; it does not prove
   that the platform still authorizes that connection.
3. When authorized to retain and publish the configured test document, follow
   [the deployed Publication check][publication-check]. Its command is
   `npm run test:deployed:publication`. It starts or repeats an Exchange and
   may write to Teamwork Graph; it is not a read-only connection health check.
4. Require the current retained and published sequences to match. A null
   published sequence is a failure, not eventual Search indexing. Only after
   acknowledgment should you independently check Rovo Search visibility.

The UI setup does not configure deployed-test credentials or issue scenarios;
those remain in the development guide. The earlier HTTP 401 and accepted-ID
shape mismatch are resolved in the recorded development check. If ingestion
fails again, record the graph-service trace and invocation time; do not change
source ACLs, weaken acknowledgment checks, or add speculative scopes.

## Disconnect carefully

Disconnecting removes this app's saved binding when its matching deletion
callback runs. Atlassian also deletes data ingested through the disconnected
connector. It does not erase this app's retained Exchange documents. Do not
use disconnect/reconnect as a harmless diagnostic reset; obtain approval for
the deletion and preserve investigation evidence first.

[publication-check]: ../../DEVELOPMENT.md#run-approved-cloud-checks
[local-setup]: ../../DEVELOPMENT.md#configure-local-tooling-without-exposing-secrets
