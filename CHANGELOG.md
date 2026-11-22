# Changelog

All notable changes to this project are documented here.

## [unreleased]

### Added

- Ticket 40: governed `logs.list` browsing of installation-local audit and
  operational CloudEvents, with bounded newest-first pages and transient cursors.
- Allowlisted publication diagnostics and durable-stage summaries retain normal
  Forge console delivery; operational persistence is bounded and best effort.

### Changed

- New audit events use immutable Custom Entities with 90-day retention;
  operational events retain seven days. Deployment is a cutover, not a migration:
  existing `audit:v1:*` KVS records are untouched and are **not** exposed by
  `logs.list`. Empty pages do not establish absence of pre-cutover activity.
  Concurrent old-version invocations may finish legacy writes during rollout.
- Raised the local compressed-code budget from 35 kB to 45 kB to accommodate the
  approved log contract, validators, storage reader, and capture adapter.

### Verification limits

- Local checks cover app behavior only. Deployment/installation, live Custom
  Entity indexing and expiry metadata, console parity, and ticket 32's genuine
  critical-path fault verification remain separately authorized evidence gates.
- Operational flush uses one parallel group of at most five immutable entity
  writes, not `batchSet`: the installed batch API does not support fail-if-exists.
  Partial failures are dropped without retry; at most 250 ms is awaited. Timeout
  does not cancel in-flight writes, which may still complete.
