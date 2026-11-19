# Development

<!-- cspell:words Workdown workdown supplychain secretspec openrpc webtrigger -->
<!-- cspell:words webtriggers Frontmatter readback mypermissions Rovo -->

Use this guide to change, check, and troubleshoot the current Forge app.
For admin UI activation, see
[Create the Workdown connector connection](docs/how-to/how-to.md).
For contribution requirements, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Prepare your workstation

Use Node.js 24, as declared in `.nvmrc` and the Forge `nodejs24.x` runtime.
Install dependencies from the repository root:

```sh
npm install
```

The Forge workflows additionally need Bun, SecretSpec, and the Forge CLI on
`PATH`. Follow the [Forge setup guide][forge-setup] to authenticate and
[Fence Rider installation][installation] for its prerequisites. Dependency
installation supplies Fence Rider, but does not install or authenticate every
external tool.

```sh
bun run fence-rider doctor
```

This checks tools, not app configuration or target selection.

## Configure local tooling without exposing secrets

The `forge:deploy`, `forge:install`, `forge:upgrade`, `forge:uninstall`, and
`forge:variables:set` scripts use [Fence Rider][fence-rider]. Registration uses
the Forge CLI directly. Fence Rider is workstation tooling, not deployed app
code. It resolves declarations in [secretspec.toml](secretspec.toml) through
SecretSpec and your approved provider.

1. Confirm access to the intended Forge app and Jira development site. Register
   a separately owned clone only when needed; do not re-register the existing
   app. See the [registration reference][register].
2. Configure [user providers][providers] and [app secret storage][app-secrets].
   Preserve the repository's project name and declarations. Commit declarations,
   never secret values or a credential as a `default`.
3. Review `FORGE_SITE`, `FORGE_PRODUCT`, and `FORGE_ENVIRONMENT` in your selected
   profile. This app's connector requires a Jira installation, and its current
   loopback supports development only. **The deploy script explicitly selects
   development**; keep installation and any variable upload targeted to the
   same environment. Do not assume the profile changes that script's target.
4. Check resolution without displaying values:

   ```sh
   SECRETSPEC_PROFILE=default bun run fence-rider doctor --resolve
   ```

   This may authenticate to your provider. It does not show or independently
   verify the selected target values; review those separately.

The current default profile also marks all three deployed-test inputs as
`required = true`. Whole-profile resolution can therefore require these inputs
for Forge workflows, even when you are not running cloud tests. This is the
current configuration, not a recommendation to change its declarations.

### Understand configuration boundaries

- **Local controls:** `FORGE_SITE`, `FORGE_PRODUCT`, and `FORGE_ENVIRONMENT`
  select tooling targets. They are not app secrets or runtime variables.
- **Local test inputs:** the three `WORKDOWN_*` declarations below are consumed
  by the test process. Do not upload them to Forge.
- **Manifest inputs:** the current manifest declares no environment-variable
  substitutions.
- **Runtime inputs:** no `[scopes.runtime]` entries are currently declared in
  `secretspec.toml`. Do not invent a runtime-secret upload step for this app.

Fence Rider's [configuration explanation][variables] distinguishes these
roles. If runtime variables are deliberately introduced later, changes need a
subsequent deployment to take effect; follow its [runtime workflow][runtime]
and the [Forge variables reference][forge-variables].

## Edit and check locally

Run the required repository gate before submitting changes:

```sh
npm run check
```

It runs linting, tests, and build/size validation through the configured task
runner. Ordinary local tests exclude `*.deployed.test.ts`; this gate does not
prove cloud authorization, ingestion, or Search visibility.

Use focused checks during development:

| Command                                | Purpose                                                             |
| -------------------------------------- | ------------------------------------------------------------------- |
| `npm test -- test/publication.test.ts` | Run a focused local test file                                       |
| `npm run typecheck`                    | TypeScript validation without emitting files                        |
| `npm run lint`                         | Code, contract drift, formatting, Forge manifest, and static checks |
| `npm run format:check`                 | Report formatting differences                                       |
| `npm run format`                       | Apply repository formatting; review the resulting diff              |
| `npm run lint:docs`                    | Markdown and spelling checks, separate from the main gate           |
| `npm run size:check`                   | Build and check the configured 32 kB compressed size limit          |

`npm run lint` already includes formatting and typechecking; repeating every
individual check is not necessary. Forge lint requires the CLI and may consult
platform state. No deployed test should be run merely to satisfy a local gate.

### Maintain the contract and generated code

Edit [src/openrpc.json](src/openrpc.json) for approved Command contracts and
its `x-notifications` extension for JSON-RPC Publication notifications. Then run:

```sh
npm run contract:generate
npm run lint:check:contract
```

The app-local generator in `scripts/` produces `src/generated/` types, policy,
and standalone validators, including Frontmatter validation from
`src/workdown-frontmatter.schema.json`. Do not hand-edit generated artifacts.
The drift check is included in linting. Runtime validators are distinct from
the OpenRPC meta-schema checks used by local contract tests.

## Deploy an authorized development change

Deployment and installation are remote writes. Confirm the target app, site,
Jira product, environment, scopes, and egress before running them.

```sh
npm run forge:deploy
```

For a first installation, use `npm run forge:install` after deployment. For an
existing installation with permission changes, use `npm run forge:upgrade`.
Code-only changes do not inherently require an installation upgrade. These
scripts include non-interactive approval flags; they do not replace human
review of major-version, scope, or egress changes.

App installation and connector activation are separate operations. Follow the
[admin connection guide](docs/how-to/how-to.md) after installation. Creating a
connection saves a binding; it does not start ingestion. There is no task
runner or scheduled refresh in the current manifest.

For the platform lifecycle, see [Forge environments][environments] and
[Fence Rider installation management][forge-tooling]. Local file edits do not
update deployed code; use an approved development deployment when cloud
verification needs those edits.

## Understand authenticated JSON-RPC

Both manifest webtriggers dispatch the same current handler. The async module
is an alias, not a queued implementation or an artificial delay. Forge routes
the URL to an installation; the app authenticates callers itself.

Every request needs `Authorization: Basic BASE64`, encoding `email:api-token`.
The caller supplies a scoped Jira API token. Requests use the verified
credential against `https://api.atlassian.com/ex/jira/<trusted-cloud-id>/`;
this is credential forwarding, not Forge `asUser(accountId)`. Never put a
credential or tenant selector into JSON-RPC parameters.

| Operation                            | Current admission and execution boundary                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `rpc.discover`, `workdown.export`    | Active Atlassian identity plus Jira global `ADMINISTER`; export reads with the caller's credential                      |
| `exchange.start`                     | Active authenticated identity plus `ADMINISTER_PROJECTS` for the source issue; source reads use the caller's credential |
| `document.get`, `publication.status` | Active authenticated destination reader; reads tenant-local retained state without rechecking source Jira visibility    |

`src/index.ts` selects admission, `src/jira.ts` verifies identity/permissions
and the trusted Jira site `installContext`, and `src/rpc.ts` composes the
Commands. Missing or invalid installation binding fails closed. Headers and
request parameters do not select an installation. Denied caller reads never
fall back to app access.

The HTTP RPC adapter accepts a single request with named parameters and a
string or number ID; it does not accept HTTP batch requests, notifications,
or positional parameters. `publication.published` is an internal,
destination-local JSON-RPC notification, not a Forge App Event or public HTTP
receiver. Protocol errors use JSON-RPC envelopes over HTTP 200; non-POST
requests receive HTTP 405. An HTTP 200 alone does not establish Command success.

The current loopback stores source/destination document state and may publish
a workspace-visible graph document. Review the
[disclosure boundary](specs/adr/0002-workdown-disclosure-boundary.md) before
using private Jira content. Source Jira access controls are not replicated.

## Configure deployed-test inputs

Run cloud tests only against an approved development installation and approved
content. Configure these existing declarations through your SecretSpec provider:

| Name                      | Purpose                                                       | Provider role     |
| ------------------------- | ------------------------------------------------------------- | ----------------- |
| `WORKDOWN_RPC_URL`        | Approved installation's HTTPS webtrigger URL; treat as secret | `project_secrets` |
| `WORKDOWN_TEST_EMAIL`     | Atlassian account email for the Jira-admin test user          | `project_config`  |
| `WORKDOWN_TEST_API_TOKEN` | Scoped Jira API token for that user                           | `project_secrets` |

All are currently required in the default profile. Issue keys and expected
content belong in the ignored scenario file, not in additional environment
variables. Do not add these inputs to manifest or runtime scopes.

After deployment, inspect existing URLs with this read-only command:

```sh
forge webtrigger list --site <approved-site> --product jira --environment development
```

If a URL must be created, `forge webtrigger create` is a separate authorized
remote action. Select the correct installation and sync module
`explore-supplychain-graph-webtrigger-sync`.

Enter secrets yourself in a trusted terminal with shell tracing and recording
off. Store values through the same provider roles the declarations read:

```sh
secretspec set --provider project_secrets --profile default WORKDOWN_RPC_URL
secretspec set --provider project_config --profile default WORKDOWN_TEST_EMAIL
secretspec set --provider project_secrets --profile default WORKDOWN_TEST_API_TOKEN
```

Check resolution without printing values with `secretspec check --scope ''
--explain` (one command). Never run `secretspec get`, print the environment, or
log Authorization headers to investigate these inputs. Agents must not inspect
secret values. Explicitly authorize any agent-run cloud test through SecretSpec.

The test user needs Jira global `ADMINISTER` for the suite's discovery/export
checks, plus access to its source issues and project-admin permission for
Exchange starts. A project admin alone cannot run the complete suite. Token
scopes and Jira permissions are separate; successful reads do not establish
Jira write permission. Rotate an expired token through the same provider;
never put tokens in chat, fixtures, or commits.

### Configure issue scenarios

Copy [test/deployed.example.json](test/deployed.example.json) to the Git-ignored
`test/deployed.local.json`. Use independently known, approved test data. Keep
aliases generic: aliases and declared project types appear in test names.
Do not commit private issue identities or content.

Each entry under `issues` needs a `key`, `projectType` (`company-managed` or
`team-managed`), and exactly one of these expectation shapes:

- **Successful export:** `expected.start_date` (an exact calendar date or null
  for omission), ordered `expected.children` (issue keys, empty array allowed),
  and nonempty `expected.description` with LF line endings and no CR characters.
- **Expected denial:** only `expected.errorCode`, one of -32001 (forbidden),
  -32005 (ineligible), or -32006 (indeterminate eligibility).

Do not generate expectations from the export under test. Project types are
operator-supplied coverage labels, not independently verified by the harness.
Configure readable secured/unreadable negative fixtures only when independently
known; deferred fixture checks are not passes. The parser in
`test/deployed-harness.ts` rejects invalid configuration before network access.

## Run approved cloud checks

These scripts inject the whole SecretSpec profile locally. Fence Rider wraps
supported Forge commands, not arbitrary test commands.

| Command                             | Side effects and evidence                                                                                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:deployed`             | Checks authenticated discovery/export and loopback Exchange behavior; retains documents and may ingest into TWG, but does not edit Jira issues. Publication may remain null.       |
| `npm run test:deployed:publication` | Starts/repeats the successful `epicWithStartDate` scenario and may retry ingestion. Requires current retained/published sequences to match; null fails. Does not edit Jira issues. |

A strict Publication pass proves app-recorded acknowledgment, not independent
graph readback or Rovo Search visibility. Verify Search separately after
ingestion acceptance; indexing delay does not explain a null published sequence.

### Run the disposable Epic sequence test separately

`test/exchange-sequence.deployed.test.ts` is an explicitly opt-in Jira-write
scenario. It creates an Epic, edits its description, and restores the original
description while checking concurrent sequence allocation. Restoration does not
undo issue history, automation effects, or Exchange/graph state. The Epic is
left for inspection; each run creates another. Its recovery record is ignored
at `test/exchange-sequence.local.json`.

The credential needs project **Browse projects**, **Create issues**, and
**Edit issues**, applicable issue-security access, project-admin permission for
Exchange, and the suite's development Jira-admin admission. Keep the existing
read token scopes and add the documented write scopes supported by the token
picker:

| Operation    | Classic scope     | Published granular alternative                                                                                      |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Create Epic  | `write:jira-work` | `write:issue:jira`, `write:comment:jira`, `write:comment.property:jira`, `write:attachment:jira`, `read:issue:jira` |
| Edit/restore | `write:jira-work` | `write:issue:jira`                                                                                                  |

These alternatives were checked against Jira REST contracts on 2026-11-19;
see [Create issue][create-issue-api] and [Edit issue][edit-issue-api]. Do not
assume the granular edit scope alone satisfies the create contract. No delete
permission is needed. These are test-credential permissions, not additional
Forge app scopes.

After approval for the target, credential, and write activity, run:

```sh
secretspec run --scope '' -- env WORKDOWN_DEPLOYED_TEST=1 WORKDOWN_SEQUENCE_TEST=1 ./node_modules/.bin/vitest run test/exchange-sequence.deployed.test.ts
```

## Troubleshoot retained but unpublished documents

As of development 5.3.0 on 2026-11-19, the strict Publication test fails:
retained sequence 1, published sequence null. The connector binding is found,
but the graph SDK returns HTTP 401. The cause is unresolved. See
[Publication verification evidence](specs/workdown-publication-verification.md)
for deployment history, trace IDs, and remaining platform gates.

1. Distinguish RPC completion from Publication. `workdown.rpc.completed` can
   report a successful Exchange even when graph ingestion is unacknowledged.
2. Read bounded development logs:

   ```sh
   forge logs -e development --limit 20
   ```

3. Inspect `workdown.graph.binding`, `workdown.graph.ingestion`, and
   `workdown.publication`. Fixed stage/outcome labels distinguish binding
   admission, SDK acknowledgment, conditional storage, and notification failure.
   Selected response metadata includes HTTP status, counts, an acceptance-match
   flag, and a validated service trace ID when supplied by the SDK.
4. Preserve timestamp, deployment/environment, trace ID, and Forge invocation
   ID for platform investigation. Do not log raw SDK errors, response bodies,
   Workdown content, credentials, endpoint URLs, or runtime context.
5. Confirm the intended connection in the admin UI using the
   [admin setup guide](docs/how-to/how-to.md). A saved binding alone does not
   prove current platform authorization. Do not disconnect/reconnect blindly:
   disconnect deletes ingested connector data.

Another code deployment, broader scopes, changed content ACLs, or weakened
acceptance checks is not an established 401 fix. A service-trace investigation
or a separately approved controlled invocation-context comparison is the next
step. No diagnostic hook currently runs ingestion from a connector callback.

## Find implementation and historical evidence

- `src/workdown*.ts`, `src/jira.ts`: Jira export, eligibility, description,
  children, and caller-bound source access.
- `src/exchange.ts`, `src/exchange-storage.ts`: loopback retention, version
  allocation, conditional publication acknowledgment, and destination reads.
- `src/publication.ts`, `src/graph.ts`: graph projection, connector lifecycle,
  and internal notification dispatch.
- `src/openrpc.json`, `scripts/`, `src/generated/`: contract source, generation,
  and generated runtime artifacts.
- `test/`: local tests, opt-in deployed checks, and public example scenarios.
- `docs/`: admin and learning guides. `specs/`: design decisions and evidence.
- [Jira export specification](specs/workdown-jira.md): historical export gates,
  including Start date compatibility and cloud evidence.
- [Exchange contract review](specs/workdown-exchange-contract-review.md) and
  [Publication evidence](specs/workdown-publication-verification.md): current
  boundaries, limitations, and platform verification still outstanding.

Ticket-era anonymous discovery examples and obsolete setup instructions are
not the supported workflow. Consult Git history for those earlier guide
versions; do not reuse their unauthenticated invocation or no-storage claims.

[fence-rider]: https://github.com/ibuchanan/ranch-rig-fence-rider
[installation]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/installation.md
[forge-setup]: https://developer.atlassian.com/platform/forge/getting-started/
[register]: https://developer.atlassian.com/platform/forge/cli-reference/register/
[providers]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-user-providers.md
[app-secrets]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-app-secrets.md
[variables]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/explanation/three-kinds-of-env-vars.md
[runtime]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/runtime.md
[forge-variables]: https://developer.atlassian.com/platform/forge/cli-reference/variables-set/
[environments]: https://developer.atlassian.com/platform/forge/environments-and-versions/
[forge-tooling]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/use-forge-tooling.md
[create-issue-api]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-post
[edit-issue-api]: https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-put
