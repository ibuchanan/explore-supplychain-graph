# Native retries and safe status

<!-- cspell:words openrpc Workdown retryAfter retryCount retryContext -->

## Approved scope — 2026-11-20

The user approved the contract, then replaced a custom scheduler design with
Forge-native retries. The user approved the unsupported-delay stop and the
Command/consumer test seams before implementation. `src/openrpc.json` is the
active contract; scratch proposals are historical design records.

`exchange.status` reads source-local delivery progress after rechecking current
Subject Project Admin authority. Its document identity must belong to the
trusted installation. `publication.status` uses the destination authentication
boundary of `document.get`, not source access. Both are read-only local snapshots.
No remote probe, retry, generation or notification is triggered by a status read.

## Execution and storage

The existing authorized `exchange.start` path retains canonical bytes and makes
the first delivery attempt synchronously, preserving its acknowledgment result.
Destination ingestion and local notification each have their own first attempt.
Failures request delayed queue delivery; subsequent attempts use a single native
consumer. Queue payloads contain only Connection/document/stage/sequence, never
credentials, content or caller-selected installation. The consumer resolves the
retained sharing principal in trusted installation context and rechecks current
Subject authority. Development-only loopback remains the only active Connection.

Retained metadata includes independent delivery, ingestion and notification
progress. Atomic storage writes include a revision fence as well as existing
sequence/Publication guards. This prevents stale status commits from overwriting
newer acknowledgments; it does not fence an already-issued external request.
Legacy records remain readable: missing status becomes `unknown` with unknown
attempts rather than fabricated receipts. All current status fields are required
in successful API results. Clients validating the old closed result schema need
coordinated upgrades.

## Policy

- One initial attempt and three intended retries per stage/target. Nominal
  delays after preceding failures are 5, 15 and 45 seconds, independently
  multiplied by uniform jitter from 0.8 to 1.2 and rounded upward to seconds.
- Native `retryContext.retryCount` is read defensively. Persisted attempts are
  observed policy ordinals, not an audit count of every external call.
- Authorization/validation failures stop immediately as `failed`. Transient
  rate limits, unavailability, timeouts and unknown acknowledgments may retry.
  The fourth observed failed attempt becomes `exhausted`. Terminal outcomes
  return normally instead of throwing an app error that Forge would retry.
- Honor valid provider `Retry-After` delta-seconds or HTTP-date at least as long
  as jittered backoff. For waits above 900 seconds, record
  `retry-delay-unsupported`, retain the actual safe failure category and last
  success, clear `nextAttemptAt`, and return normally. This reason takes
  precedence even on attempt four; no early call or wake-up chain is allowed.
  Malformed guidance falls back to the ordinary classified failure policy.
- Never regenerate content on retry. Preserve document ID, sequence and bytes.
  Repeated unchanged starts do not reset known terminal work or bypass backoff.
  New canonical bytes create a new target with preserved last-success progress.
- Each stage is independent. Notification retries never repeat ingestion of a Publication.
  A pending older notification blocks newer Publication acknowledgment, including
  after terminal failure. Retention of newer bytes remains possible.
- The production notification dispatcher has no consumers: report `disabled`,
  not notification success. The optional Automation webhook remains later work.

States are `idle`, `pending`, `running`, `retrying`, `succeeded`, `failed`,
`exhausted`, `disabled`, `unknown` and `retry-delay-unsupported`. Only safe failure
categories appear: authorization, validation, rate-limited, unavailable, timeout,
unknown. No raw provider response, credential, endpoint or exception enters status.
Last successful sequence advances only after a durably recorded acknowledgment.
A delivery success means destination retention, not TWG ingestion or notification.

## Explicit limits

No custom outbox, scheduler, recovery sweep, lease, external service, new retry
entity/index or Jira polling is introduced. Storage commits and enqueue are not
atomic. A crash before initial/next-stage enqueue may strand work. Forge events
are at-least-once after enqueue and have finite retention; there is no recovery
after expiry, guaranteed terminal status, exactly-once delivery, hard global
four-network-call cap, or execution-time guarantee. A pending/retrying record is
last observed state, not proof of a live job. Duplicate and uncertain operations
must remain repeat-safe. These limits were accepted instead of custom recovery.

One `@forge/events` dependency, queue/consumer function and retained entity revision
attribute are added. Existing scopes and egress remain unchanged. The measured
local compressed JavaScript grows beyond the prior 32 kB budget to about 32.5 kB;
the local regression budget is adjusted to 34 kB, not a Forge platform quota.

## Verification boundary

Local controlled Command/consumer and storage tests establish app-owned policy,
authorization decisions, attempt progression, provider limits, independent stage
progress and stale-write behavior. Official Forge documentation confirms direct
consumer function binding, `event.body`, native retry context and the 900-second
retry ceiling. Local checks do not establish installed queue delivery, timing,
impersonation or cloud fault recovery. Deployment, installation upgrade and a
safe installed transient/exhaustion exercise still require separate approval.

References: [Async Events API](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)
and [consumer manifest](https://developer.atlassian.com/platform/forge/manifest-reference/modules/consumer/).
