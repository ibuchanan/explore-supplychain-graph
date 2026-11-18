# Development

<!-- cspell:words openrpc webtrigger webtriggers supplychain WORKDOWN -->
<!-- cspell:words Frontmatter mypermissions readback -->

Install dependencies with `npm install`.
Run the checks before sending a pull request:

```sh
npm run lint
npm run lint:docs
npm run format:check
npm run typecheck
npm run test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process.

## First-time Forge setup with Fence Rider

The `forge:*` package scripts use [Fence Rider][fence-rider] to wrap the
Forge CLI. It resolves configuration declared in `secretspec.toml` through
[SecretSpec](https://secretspec.dev) and your chosen secret provider. Local
controls select the site, product, and environment; manifest inputs are supplied
to Forge locally; only variables listed in `[scopes.runtime]` are uploaded,
always encrypted. Fence Rider is development tooling, not part of the deployed
app.

Complete these steps from the repository root before your first Forge workflow:

1. Install the tools described in Fence Rider's [installation guide][installation].
   Dependency installation supplies Fence Rider, but you also need Bun,
   SecretSpec, and the Forge CLI available on `PATH`. Follow the
   [Forge getting-started guide][forge-setup] to authenticate; Fence Rider does
   not install these tools or log you in. Check the installed tool versions:

   ```sh
   bun run fence-rider doctor
   ```

   This checks tools only, not whether your app configuration resolves.

2. Confirm access to the app and development site you intend to use. If you
   cloned a sample and need your own app registration, follow the
   [`forge register` reference][register] once. Registration changes the app ID
   in `manifest.yml`; do not repeat it for an app you already own or are
   authorized to develop.

3. Follow [workstation provider setup][providers], then
   [app requirements and secret storage][app-secrets]. Review this repository's
   existing `secretspec.toml` rather than replacing it: retain its project name,
   configure provider routes, and store values in your approved provider.
   Commit declarations, never credentials or a secret value as a `default`.
   Keep any local value files out of Git.

4. Review the [local target settings][local] for `FORGE_SITE`, `FORGE_PRODUCT`,
   and `FORGE_ENVIRONMENT` in the default profile. Choose your development site
   and environment before continuing. These controls stay local; do not add
   them to `[scopes.runtime]`. If the app uses manifest inputs, follow the
   [manifest configuration guide][manifest]. Check resolution without printing
   secret values:

   ```sh
   SECRETSPEC_PROFILE=default bun run fence-rider doctor --resolve
   ```

   This may access your provider and require authentication. It does not
   display or confirm the target values; review those separately.

5. Once authorized to change the selected app, site, and environment, upload
   runtime variables, deploy, and install:

   ```sh
   npm run forge:variables:set && npm run forge:deploy && npm run forge:install
   ```

   **These commands change remote state.** Keep the same configured environment
   for upload and deployment; do not override only the deployment target.
   Stored runtime variables become active on the subsequent deployment.
   For code-only changes with unchanged runtime values, run `npm run forge:deploy`.
   After permission scope changes, run `npm run forge:upgrade` for existing
   installations. See [runtime workflows][runtime] and
   [installation management][forge-tooling] for details.

For a guided exercise with disposable values, follow the
[Fence Rider tutorial][tutorial]. Its example script names differ from this
repository's `forge:*` names; use the scripts in this repository's `package.json`.

[fence-rider]: https://github.com/ibuchanan/ranch-rig-fence-rider
[installation]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/installation.md
[forge-setup]: https://developer.atlassian.com/platform/forge/getting-started/
[register]: https://developer.atlassian.com/platform/forge/cli-reference/register/
[providers]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-user-providers.md
[app-secrets]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/configure-app-secrets.md
[local]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/local.md
[manifest]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/manifest.md
[runtime]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/runtime.md
[forge-tooling]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/how-to/use-forge-tooling.md
[tutorial]: https://github.com/ibuchanan/ranch-rig-fence-rider/blob/main/docs/tutorials/tutorial.md

## Exercise authenticated JSON-RPC

Ticket 03 supersedes the historical bootstrap details below. Both manifest
entry points now use the backbone's authenticated webtrigger adapter; discovery
is no longer anonymous. The application contract is unchanged.

### Ticket 03 implementation and release gate

- `npm run contract:generate` generates types, standalone validators, and web
  policy in `src/generated/`; `npm run lint:check:contract` rejects drift.
- `workdown.export` reads the issue and canonical site URL with the caller's
  credential, emits the two core golden documents, and validates Frontmatter
  against `src/workdown-frontmatter.schema.json` plus safe YAML and identity
  invariants. Ticket 04 adds the scalar disclosure allowlist and semantic Start
  date resolution; its revised single-site cloud gate passed on development
  3.3.0 (2026-11-17): discovery and both structured export scenarios passed,
  including an exact populated Start date and explicit omission.
  Rich ADF fails closed until ticket 07; eligibility and children remain tickets
  05–06. No data is stored or published.
- Start date discovery paginates `field/search?expand=stableId`, checks the
  complete project-filtered catalog, and reads only the resolved local field ID.
  All reads use the caller's token. A complete authoritative zero-match catalog
  or readable empty value omits `start_date`. Incomplete/unreadable metadata or
  requested values fail with `field-unreadable` (-32004); ambiguous/incompatible
  mappings fail with `field-unresolved` (-32003), without returning field names.
  No extra OAuth scopes or egress destinations are declared. Catalog work is
  bounded to 1000 pages per enumeration and fails rather than returning partial
  results. The passing scenarios declare company-managed and team-managed
  project types; these are operator-supplied labels, not harness-verified types.
  The team-managed omission case does not establish universal populated-date
  support; see the ticket 04 evidence in `specs/workdown-jira.md`.
- For ticket 04 acceptance, configure a named issue in `test/deployed.local.json`
  with a known populated `expected.start_date` and run the deployed tests on
  one approved site. Every issue requires an explicit expectation; `null`
  requires omission and does not prove populated-date export. Existing local
  fixtures exercise different field IDs; no second site is required. Record
  the project type exercised, cover both types on the same site where practical,
  and explicitly record any unverified type as a compatibility limitation.
- Every request, including discovery, needs `Authorization: Basic BASE64`, where
  BASE64 encodes `email:api-token`. Use a scoped Jira API token with access to
  the identity, permissions, issue, and server-info reads below. The exact
  sufficient token scopes remain a deployed verification gate; a denied read
  never falls back to app access. Never put credentials in JSON-RPC parameters.
- Installation binding uses only the Forge function's second argument,
  `installContext`, requiring a Jira site ARI. Missing or invalid binding denies
  access. Neither the request body nor HTTP headers select a tenant.
- The authenticator calls `/rest/api/3/myself`, requires an active Atlassian
  account, then checks `/rest/api/3/mypermissions?permissions=ADMINISTER`.
  Ian Buchanan approved **Jira administrator**, rather than site administrator,
  as sufficient for the development gate on 2026-11-16.
- Reads use `https://api.atlassian.com/ex/jira/<trusted-cloud-id>/rest/api/3/`
  and the same verified credential, with redirects disabled and bounded waits.
  `canActAsUser` requires that verified principal and credential in trusted
  context. This is credential forwarding, not Forge `asUser(accountId)`;
  knowing an account ID alone never grants caller execution.
- Public discovery is generated by the backbone and omits private policy
  metadata. Only implemented, selected Commands appear. Missing or unreadable
  issues return `forbidden` (-32001); readable non-Epics return
  `profile-mismatch` (-32002); invalid inputs return `invalid-params` (-32602).
  Unexpected reads, invalid output, and unsupported descriptions fail without
  returning content. Both entry points use `@forge-ahead/logging` with logger
  name `workdown`, invocation lifecycle logging, and ambient context. Each
  completed response emits `workdown.rpc.completed` with a generated random
  `requestId`, operation, duration, HTTP status, and success/failure outcome;
  JSON-RPC errors over HTTP 200 are failures and include only their numeric
  `rpcErrorCode`. Unexpected thrown failures emit `workdown.rpc.failed` using
  an empty allow-list error policy (no raw messages or stack traces), then are
  rethrown unchanged. Request bodies, headers, query parameters, response
  documents, tenant/account/issue identifiers, and endpoint URLs are never
  passed to the logger. The correlation ID is generated locally, not copied
  from untrusted JSON-RPC or HTTP inputs. Default redaction remains a backstop.
  `LOG_LEVEL` uses the package's environment-aware defaults; a named override
  such as `workdown=debug` is supported. No additional runtime variable is
  required. These are operational logs, not durable audit events; use the
  outcome field rather than the completion message alone to identify success.
- **Deployment review:** manifest adds backend egress to
  `https://api.atlassian.com`; no OAuth scopes, runtime secrets, storage, modules,
  or app identity changes. Forge lint reports a major-version approval gate for
  this egress change. Do not suppress that gate or deploy/upgrade without
  explicit target and permission approval.
- **Evidence boundary:** local fakes verify app decisions, not platform
  authorization. The updated deployed test and log readback have not run for
  ticket 03. Ticket 02's earlier anonymous discovery evidence does not verify
  this implementation. The Jira-admin gate cannot demonstrate a non-admin
  caller's denied issue read in cloud; that negative case is local only.
- Added direct dependency `yaml` (already present transitively). Run
  `npm install` outside the sandbox to update the lockfile before release.
  No dependency installation or lockfile editing was performed by the agent.

Supply the local connection inputs declared in `secretspec.toml`:
`WORKDOWN_RPC_URL`, `WORKDOWN_TEST_EMAIL`, and `WORKDOWN_TEST_API_TOKEN`.
Configure readable Epics with empty or plain-text descriptions and their
independent expectations in `test/deployed.local.json` as described below.
The old `WORKDOWN_TEST_ISSUE` and expected-date environment inputs are no longer
read; any previously stored issue value can be retired separately.
Run `secretspec run --scope '' -- npm run test:deployed` in a trusted terminal
only after approved deployment and installation upgrade. The test requires
unauthenticated discovery to fail, validates authenticated discovery, and
exports the real Epic without printing its document. Read back the fixed log
marker using `forge logs` after approval of that verification step.

### Historical ticket 02 bootstrap (superseded)

The following describes only the previously deployed discovery-only version,
not the ticket 03 source or the current invocation procedure.

## Exercise JSON-RPC discovery (historical)

`src/openrpc.json` is the contract source. It declares application Commands
only, currently `workdown.export`, which is not implemented yet. It never lists
`rpc.discover`: the library's contract generator rejects that reserved name.
`src/rpc.ts` registers discovery by hand with the installed `@forge-ahead/rpc`
dispatcher and returns this document, so discovery already advertises
`workdown.export` although nothing handles it. Ticket 03 generates handlers and
validators from the contract and moves discovery onto the library's web
dispatcher, which serves only Commands that have handlers. Application errors
are in `src/command-errors.ts`. Future Command contracts must be approved before
implementing them.

Run the local dispatcher and webtrigger tests with `npm test`, or all repository
checks with `npm run check`. The OpenRPC document is checked against the standard
meta-schema and its JSON Schema dialect. These validators are test-only and are
not imported into the Forge runtime. Format assertions are disabled; structural
schema validation remains enabled.

### Invoke an approved development installation

Deployment and installation require separate approval of the target app,
site, product, and environment. This slice changes no manifest modules, scopes,
or external permissions: both existing dynamic webtriggers now dispatch the same
JSON-RPC discovery request instead of the scaffold response.

After an approved deployment, list the existing installation URLs:

```sh
forge webtrigger list --site <approved-site> --product jira --environment <approved-environment>
```

If none exists, an authorized site administrator can generate one with
`forge webtrigger create`, selecting the approved installation and the
`explore-supplychain-graph-webtrigger-sync` module. URL creation is a separate
remote write; do not run it without approval. The async module is an alias for
the same handler, with no artificial delay.

Set `WORKDOWN_RPC_URL` locally to that HTTPS URL, then run:

```sh
npm run test:deployed
```

This test makes a real HTTP POST to Forge and compares the complete JSON-RPC
response with the local contract, then validates the returned OpenRPC document.
It is excluded from ordinary local checks. An explicit deployed test fails when
the URL is missing, rather than silently skipping. A missing URL failure is not
cloud execution evidence. Do not commit installation URLs or raw runtime context.

For a manual invocation using the same local variable:

```sh
curl --request POST "$WORKDOWN_RPC_URL" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":"manual","method":"rpc.discover","params":{}}'
```

The backbone accepts a single request with named `params` and a string or number
`id`; batch requests, notifications, and positional parameters are unsupported.
Protocol errors use JSON-RPC error envelopes over HTTP 200; non-POST requests
receive HTTP 405. Invalid JSON produces parse-error `-32700`, malformed envelopes
invalid-request `-32600`, and unknown methods method-not-found `-32601`.

### Caller and installation boundary

Forge routes the webtrigger URL to a particular installation and passes the HTTP
payload as the first handler argument and runtime context separately as the
second. It does **not** authenticate webtrigger callers. The bootstrap deliberately
ignores runtime context and supplies no caller or installation authority to the
static discovery handler. Headers, query parameters, and JSON-RPC parameters do
not establish an Atlassian user or a trusted installation.

Only the static app contract is exposed; there are no Jira reads, secrets,
storage operations, or app-level actions. Before adding any application Command
to this public transport, establish verified caller authentication and trusted
installation binding (or select an authenticated Forge entry point). Do not infer
`asUser` authority from a request-supplied account ID. The library's authenticated
webtrigger adapter requires app-owned authentication; it is not used to invent
an anonymous principal here.

**Evidence, 2026-11-16:** local red–green tests, schema validation, typecheck,
build, and `npm run check` passed. The developer deployed version 2.0.0 to
development and installed it in Jira on the development test site. After explicit
approval, the sync webtrigger URL was created and `npm run test:deployed` passed
at 09:28 (one real cloud test, about 2.1 seconds). It verified HTTP 200, the exact
JSON-RPC envelope and contract, and standard OpenRPC structural validity.
Ticket 02's deployed-test gate is satisfied; ticket 03 still requires its own
approved Command definition.

A bounded `forge logs` read for the sync function returned no entries. The
handler emits no application logs, and no raw runtime context was captured or
exposed. Caller identity and installation-context contents were not dynamically
verified; the static discovery handler ignores both. Authenticated caller and
trusted installation binding remain prerequisites for data-bearing Commands,
not properties established by this discovery test. Installation URLs are omitted
from committed evidence.

Platform references checked for this slice:
[webtrigger runtime](https://developer.atlassian.com/platform/forge/runtime-reference/web-trigger/),
[request/response events](https://developer.atlassian.com/platform/forge/events-reference/web-trigger/),
and [webtrigger CLI](https://developer.atlassian.com/platform/forge/cli-reference/webtrigger/).

## Credentials for deployed integration tests

From ticket 03 onward, deployed tests call authenticated Commands. The RPC
backbone's webtrigger adapter checks an `Authorization` credential on every
request. The development loop uses a Jira API token and accepts a caller who
is an active Atlassian user with Jira's `ADMINISTER` global permission. This
is the development-loop model, not end-user authentication. The exact header
format is documented above. SecretSpec holds only the three connection inputs;
issue identities and expected values belong in the local scenario file.

| Name                      | What it is                                              | Storage role                                          |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `WORKDOWN_RPC_URL`        | Webtrigger URL of the approved development installation | `project_secrets` (a capability URL; treat as secret) |
| `WORKDOWN_TEST_EMAIL`     | Atlassian account email of the test user (a Jira admin) | `project_config`                                      |
| `WORKDOWN_TEST_API_TOKEN` | That user's Atlassian API token                         | `project_secrets`                                     |

### Where these values go

These are **local** variables: only the test process on your workstation or CI
runner reads them. Do not list them in `[scopes.runtime]`, which uploads values
to Forge where the deployed function can read them, and do not list them in
`[scopes.manifest]`. Only values the deployed app itself needs belong in the
runtime scope. See Fence Rider's explanation of
[the three kinds of variables](node_modules/fence-rider/docs/explanation/three-kinds-of-env-vars.md).

Fence Rider wraps `variables`, `deploy`, `install`, `lint`, and `tunnel`; it does
not run tests. Run tests through SecretSpec directly.

### Declare them

Ticket 03 adds declarations like these to `secretspec.toml`, with no values:

```toml
[profiles.default.WORKDOWN_RPC_URL]
description = "Webtrigger URL of the approved development installation"
required = false
providers = ["project_secrets"]

[profiles.default.WORKDOWN_TEST_EMAIL]
description = "Email of the Jira-admin test user"
required = false
providers = ["project_config"]

[profiles.default.WORKDOWN_TEST_API_TOKEN]
description = "Scoped Jira API token of the Jira-admin test user"
required = false
providers = ["project_secrets"]
```

Keep `required = false`. Fence Rider resolves the whole profile before deploys,
so a required test credential would block every deploy for anyone who has not
stored it. The deployed test fails explicitly when a value is missing, as the
discovery test does for `WORKDOWN_RPC_URL`.

### Obtain and store them

Run these yourself in a trusted terminal, with shell tracing off and no terminal
recording or agent capture while you enter secrets.

1. **Webtrigger URL.** After an approved deploy and install, use
   `forge webtrigger list` as in the section above. Creating a URL is a remote
   write and needs approval.
2. **API token.** Sign in as the test user (an administrator of the development
   site) and create a token under your Atlassian account's Security settings
   (`https://id.atlassian.com/manage-profile/security/api-tokens`). Label it for
   this project and set an expiry. Confirm with ticket 03 which token type the
   authenticator expects.
3. **Store them** (enter the value at the prompt; write to the same role the
   declaration reads from):

   ```sh
   secretspec set --provider project_secrets --profile default WORKDOWN_RPC_URL
   secretspec set --provider project_config --profile default WORKDOWN_TEST_EMAIL
   secretspec set --provider project_secrets --profile default WORKDOWN_TEST_API_TOKEN
   ```

   Provider setup is in Fence Rider's
   [user-provider guide](node_modules/fence-rider/docs/how-to/configure-user-providers.md)
   and [app secrets guide](node_modules/fence-rider/docs/how-to/configure-app-secrets.md).

### Configure issue scenarios

Copy `test/deployed.example.json` to `test/deployed.local.json` and use the
checked-in public dataset values or replace them with independently known test
data. The example's real issue keys are from a public, well-known dataset and
are intentionally retained. The local file is Git-ignored; never commit private
issue identities, content, or credentials. No local scenario file is created
automatically. Keep aliases generic because aliases and declared project types
appear in test names.

Each named entry under `issues` contains `key`, `projectType` (company-managed
or team-managed), and exactly one of `expected.start_date` or
`expected.errorCode`. A date asserts the exact exported value; `null` asserts
that the field is omitted. Error codes -32001, -32005 and -32006 assert forbidden,
ineligible and indeterminate eligibility respectively, with no document. The
current team-managed example expects -32006 because secured-item detection is
unverified for that project type. Do not invent negative issue identities:
configure a known readable secured Epic and a known unreadable Epic when available.
Missing expectations, invalid calendar dates, unknown properties, and empty issue
sets fail configuration
validation before any network request. Remove illustrative scenarios that do
not apply; two project types are not mandatory. Declared project types are
operator-supplied coverage labels, not independently verified by the harness.

Maintain expectations independently of the export under test; do not generate
them from its output. Add fields to the typed configuration and its validator
when a subsequent ticket needs them, rather than adding environment variables.
`test/deployed-harness.ts` provides the validated loader and shared authenticated
RPC helper. Local harness tests use synthetic inputs and make no cloud calls.

The deployed suite checks discovery once and exports each scenario separately,
including document validity, allowlist, issue key, and Start date expectation.
Failures suppress credentials, response bodies, and documents; scenario aliases
and assertion labels identify the failing check. These read-only tests neither
provision nor modify issues. The earlier `field-unreadable` failure was resolved
by the catalog-validation correction, not by the harness; the subsequent 3.3.0
structured deployed run passed all three tests.

### Use them

Check that the names resolve without printing values:

```sh
secretspec check --scope '' --explain
```

Run the deployed tests with the whole profile injected into the test process:

```sh
secretspec run --scope '' -- npm run test:deployed
```

Never use `secretspec get`, `printenv`, or log output to inspect real values, and
never echo the `Authorization` header from a test. A coding agent must not read
these values. Run the deployed test yourself, or explicitly authorize an agent
to run it through `secretspec run` and keep the output free of credentials.

### Rotation and further sites

API tokens expire: create a new one and `secretspec set` it again. A webtrigger
URL changes only if it is recreated or the module key or `urlFormat` changes. A
second development site, if separately approved for a named residual integration
risk, needs its own URL and credentials; choose separate names or a separate
SecretSpec profile when it exists. It is not a blanket ticket prerequisite.
Default to local isolated-peer tests plus targeted checks on the existing
installation; distinguish those from actual inter-installation evidence. Never
bypass authentication or installation binding for a test. If the approved boundary
cannot safely exercise a remote case on one installation, record that case as
unverified rather than add a test-only production Command. See the testing
decisions in `specs/supplychain-graph.md`.

## Repository layout

- `.atlassian/`: Repository ownership metadata.
- `src/`: TypeScript source code.
- `docs/`: Diataxis guides, reference, explanations, and tutorials.
- `specs/`: Specifications and reference material; excluded from Biome checks.
- `dist/`: Build output; ignored by Git and excluded from Biome checks.
- `test/`: Forge app tests (Vitest) and optional evaluations.
- `scripts/`: Forge setup and deployment helpers.
