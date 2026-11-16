# Development

<!-- cspell:words openrpc webtrigger webtriggers supplychain WORKDOWN -->

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

## Exercise JSON-RPC discovery

`src/openrpc.json` is the contract source. For ticket 02 it declares only
`rpc.discover`; no application Commands are implemented. `src/rpc.ts` registers
that method with the installed `@forge-ahead/rpc` dispatcher. The library's
application-contract generator rejects the reserved discovery method, so this
bootstrap does not generate application handlers or validators. Future Command
contracts must be approved before implementing them.

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

## Repository layout

- `.atlassian/`: Repository ownership metadata.
- `src/`: TypeScript source code.
- `docs/`: Diataxis guides, reference, explanations, and tutorials.
- `specs/`: Specifications and reference material; excluded from Biome checks.
- `dist/`: Build output; ignored by Git and excluded from Biome checks.
- `test/`: Forge app tests (Vitest) and optional evaluations.
- `scripts/`: Forge setup and deployment helpers.
