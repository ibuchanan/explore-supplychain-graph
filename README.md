# explore-supplychain-graph

<!-- cspell:words Workdown workdown supplychain Frontmatter Rovo -->

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](CONTRIBUTING.md)

An exploratory Atlassian Forge app for exporting eligible Jira Epics as
**Workdown**—Markdown with structured YAML Frontmatter—and exchanging retained
documents for discovery through Teamwork Graph and Rovo.

This repository is for developers exploring caller-authorized Jira export,
versioned document exchange, and explicit graph-ingestion acknowledgment.
It is not a complete cross-site supply-chain integration.

## Current state

- Authenticated JSON-RPC supports Epic export, a development-only loopback
  Exchange, retained-document retrieval, and Publication status.
- The **Workdown** connector projects retained content as an
  `atlassian:document`. Publication requires a matching accepted-object response;
  retaining a document is not the same as publishing it.
- **Verified on the development installation, 2026-11-19:** the deployed
  Publication test passes, and manual Rovo Search checks find the Workdown
  using parent-description text, a Start date value, and included child-title
  words. See [what Search can do](docs/how-to/search-workdown.md) and the
  [verification record](specs/workdown-publication-verification.md).
- **Refresh policy:** only updates to the shared Epic itself trigger automatic
  republishing. Child creation, edits, deletion, and reparenting do not trigger
  refresh. Children are snapshots refreshed on the next Epic update or an
  explicit `exchange.start`; they may remain stale indefinitely otherwise.
  A read-only export does not refresh the retained/published document.
- There is no implemented cross-site delivery or scheduled refresh. The current
  document link points to the source Jira issue, not a destination-local viewer.

**Disclosure warning:** graph documents use destination-workspace visibility;
source Jira permissions are not replicated. Use only content approved for that
boundary. See the [disclosure decision](specs/adr/0002-workdown-disclosure-boundary.md).

## Try the local checks

Use Node.js 24 and npm from the repository root:

```sh
npm install
npm run check
```

This runs local tests, static checks, and build/size validation. It does not
call the deployed integration tests or prove graph ingestion works. No Jira
credential is needed by the local tests; the full gate also requires the Forge
CLI for manifest linting. See [workstation setup](DEVELOPMENT.md#prepare-your-workstation)
for tool prerequisites.

## Set up a development installation

You need access to a Forge app registration, an approved Jira development site,
and an organization admin who can create its connector connection. The tooling
uses Bun, SecretSpec, and Fence Rider alongside the Forge CLI.

1. Follow [local configuration](DEVELOPMENT.md#configure-local-tooling-without-exposing-secrets)
   to select the target and configure approved providers. A separately owned
   clone needs its own app registration. Never commit credentials.
2. Review the manifest's scopes and egress. After approval, deploy and install
   on the selected Jira site:

   ```sh
   npm run forge:deploy
   npm run forge:install
   ```

   The deploy script explicitly targets development. For an existing
   installation with permission changes, use `npm run forge:upgrade` instead
   of a first installation. These commands change remote state.
3. Create the **Workdown** connection using the
   [admin UI guide](docs/how-to/how-to.md). Connection creation saves a binding;
   it does not ingest documents.
4. Configure the local test inputs and independently known issue scenarios as
   described in [deployed-test setup](DEVELOPMENT.md#configure-deployed-test-inputs).
   After authorizing retention and possible graph writes, run:

   ```sh
   npm run test:deployed:publication
   ```

   The test starts or repeats the configured loopback Exchange. It does not
   edit Jira issues, but may publish their exported content to Teamwork Graph.
   Matching retained/published sequences prove app-recorded acknowledgment,
   not Search visibility. Then follow the
   [manual Rovo Search check](docs/how-to/search-workdown.md).

Do not disconnect/reconnect as a harmless reset: Atlassian deletes data ingested
through the disconnected connector.

## Documentation

- [Development guide](DEVELOPMENT.md): edit/check loop, contracts, authentication,
  cloud-test boundaries, and troubleshooting.
- [Admin connection guide](docs/how-to/how-to.md): create and verify UI setup.
- [JSON-RPC contract](src/openrpc.json): supported Commands and internal
  `publication.published` notification (`x-notifications`), not Forge App Events.
- [Workdown specification](specs/workdown-spec.md) and
  [glossary](GLOSSARY.md): document format and domain vocabulary.

## Contributing and security

Contributions are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md) and
follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities using
[SECURITY.md](SECURITY.md), not a public issue.

## License

Apache License 2.0. See [LICENSE](LICENSE).
