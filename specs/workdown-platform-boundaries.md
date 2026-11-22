# Workdown platform boundaries

<!-- cspell:words Workdown webtrigger multibyte uncontended readback -->

Reviewed 2026-11-20 against current official documentation and the local
implementation; Jira budget policy and local evidence updated 2026-11-22.
This is not a deployed capacity test, cost forecast, or permission to change
the architecture.

## Findings and policy

Keep the current **262144-byte canonical UTF-8 document cap** and **100 eligible
child cap** unchanged for now. The storage and invocation sizing below show
headroom, not a documented TWG text allowance or a guarantee that every permitted
export finishes. No numeric TWG document-text byte limit was found in the
consulted ingestion, document, and rate-limit references. Do not invent one or
infer unlimited acceptance. Matching ingestion acknowledgment remains mandatory;
an unacknowledged update is retained but is not a Publication.

The 100-child cap is an application work budget, not a TWG limit: all children
are embedded in **one** graph object. It does not bound total Jira requests or
execution time. The byte and child policies remain provisional for operational
capacity; reducing document size alone would not fix pagination/runtime risks.

## Hard limits and implementation fit

| Boundary | Current documentation | Implementation and consequence |
| --- | --- | --- |
| Webtrigger runtime | 55 seconds | Both `runSync` and `runAsync` are webtrigger handlers; the latter's name does not make it a queue consumer or grant a 900-second runtime. Export, storage, and ingestion share this budget. |
| Invocation payload | 5 MB request payload; webtrigger request/response metadata counts toward applicable payload limits | The document cap is 256 KiB, but JSON encoding and the outer webtrigger envelope must be counted. Client-controlled headers/metadata are additional, not covered by the document cap. |
| Memory | Platform maximum 1024 MB | Manifest explicitly configures 256 MB. Do not assume the platform maximum is available. The final document cap does not bound the size of Jira JSON parsed before validation. |
| Egress per invocation | 100 requests per runtime minute, rounded up; functions without an explicit timeout have 100 | `jiraGet` uses global `fetch` to `api.atlassian.com`, not `requestJira`, so the documented `requestJira` exemption does not apply. Authentication, permissions, metadata pages, issue reads, child pages, and other outbound calls need headroom. |
| Shared network rates | Egress 50000/minute/app; all network requests 3000000/minute/app and 100000/minute/app/tenant | These shared ceilings are not throughput targets; Jira and TWG limits may bind much earlier. |
| Logging | 100 lines for the current undeclared timeout; 200 KB per invocation | Keep fixed-label summaries. Never log Workdown, credentials, raw SDK errors, or per-child payloads. |
| Stored value | 240 KiB RAW; depth 31; key length 500 | Each record is shallow. Hashed document keys are 64 characters, chunk keys 66. Four 64 KiB raw-byte chunks are base64 encoded separately. |
| Transaction | At most 25 operations, unique keys, 4 MB payload | Each compare-and-set writes five unique keys: metadata plus four chunks. It fits by operation count and calculated payload, including base64 expansion. |
| Storage rates | 1000 requests/second/installation; 4000 read and 4000 write units/minute, in rounded-up 10 KB units | These are not 4000 full-document reads/writes. Large chunk reads and transactions consume multiple units; retries and publication metadata updates amplify traffic. |
| Hot storage key | 12 MB/s reads, 1 MB/s writes per key | Simultaneous updates to one Exchange can hit a hot-key ceiling before app-wide throughput. Conditional transactions protect consistency, not capacity. |
| Custom entities | 20 entities; 50 attributes and 7 custom indexes per entity | Manifest uses one entity, three attributes, no custom indexes. |
| TWG ingestion | 1–100 objects/request; 1500 objects/minute/app/tenant for normal ingestion | Publisher sends one object. Children do not count separately. Do not use BACKFILL's 50000/minute allowance as a real-time publication budget. |
| TWG deletion | 100 external IDs/request; 500 external IDs/minute/app/tenant | Withdrawal work must respect these boundaries and establish the actual connector/document mapping. |
| Sequence | TWG uses a long sequence, with greater values treated as newer | App deliberately restricts to positive JavaScript safe integers and refuses allocation after `Number.MAX_SAFE_INTEGER`. No numeric precision expansion is needed. |

## Local sizing evidence

A one-off Node sizing calculation on 2026-11-20 used a 262144-byte all-NUL
string as a conservative escaping stress input, not as a valid Workdown fixture.
It produced:

- One JSON string: **1572866 bytes** (six-character escapes plus quotes).
- Representative JSON-RPC result: **1572913 bytes**.
- Representative outer webtrigger response, including a JSON-encoded body,
  status, and Content-Type header: **1835145 bytes**.
- Each base64 chunk value with a 16-digit version: **87427 JSON bytes**.
- Four chunk values: **349708 JSON bytes**, before the small metadata/key/
  transaction envelope. Each base64 payload is 87384 characters.

This supports keeping the byte cap below the cited invocation and storage
ceilings; it does not certify arbitrary HTTP metadata, every SDK wire envelope,
TWG text acceptance at the cap, or cloud memory/runtime at the cap. Existing
`test/exchange-storage.test.ts` independently round-trips a 256 KiB multibyte
value through the local storage adapter. No new deployed boundary test ran.

## Remaining app-controlled risks

1. **Jira work is bounded locally; cloud capacity remains unverified.** The
   2026-11-22 approved policy admits at most **60 Jira requests per invocation**,
   including authentication, permission checks, metadata pages and child pages.
   One invocation-local, monotonic deadline starts at handler entry: **35 seconds**
   for webtriggers and retry consumers, **15 seconds** for Jira product events.
   Nested work and multiple Exchanges share the same budget. Secured children
   remain excluded but their pages consume requests. Each Jira transport and
   successful JSON body read is bounded by the smaller of **10 seconds** and
   remaining time; both caller-token fetch and impersonated `requestJira` receive
   cancellation signals. Generation checks expiry before returning a document.
   Initial global stable-ID discovery and exact-ID/project filtering are unchanged;
   exhaustion fails whole rather than treating a partial catalog as absence.

   Existing errors are retained: admission failure is HTTP 503; Project Admin
   verification remains fail-closed Forbidden; Subject reads use Eligibility
   undetermined; field and site metadata use Field unreadable; child reads or
   final-generation expiry use Children unreadable. No OpenRPC changes, retry
   sleeps, new queues, caching, or persistent budget state were introduced.

   Local fake-time HTTP/Command and event-handler tests establish combined page
   exhaustion, ordinary success, fresh invocation isolation, stalled transport/body
   cancellation, final-generation expiry, and preservation of retained source,
   destination and Publication state on a failed refresh. Retry-handler evidence
   includes refusing Jira reads after registration lookup consumes its deadline.
   These are application-policy checks, not a Forge capacity or deployed
   cancellation test. The live official invocation limits were rechecked on
   2026-11-22: webtriggers allow 55 seconds; ordinary product events allow 25;
   async consumers default to 55; undeclared-timeout functions allow 100 egress
   requests, excluding `requestJira`/`requestConfluence`.

   The policy reserves 20 seconds after webtrigger Jira work and 10 after product
   event Jira work. It does **not** time out storage/ingestion, bound SDK-internal
   requests, preempt synchronous CPU work or guarantee cancellation of remote
   work already sent. Large response parsing, registration lookup, storage,
   delivery, ingestion and contention can still overrun the platform invocation.
   No deployment, live capacity check or scope/egress change accompanied this work.
2. **Storage amplification.** A consistent retained read uses metadata, four
   chunks, then metadata again: six reads per uncontended attempt, up to three
   attempts. Source and destination retain separate records even in loopback.
   Publication acknowledgment and notification completion each rewrite all
   chunks through the existing compare-and-set. At the cap, four chunk payloads
   alone total 349536 bytes per retained copy; two role copies total 699072 bytes,
   before metadata. Repeated full reads/writes matter for rate units and billing.
   No storage refactor or new batching abstraction is introduced by this review.
3. **No automatic throttling recovery yet.** Current failures must not create
   false Publications; automatic scheduling/backoff belongs to retry-policy work.
   That work must honor platform retry metadata and Jira's independent API limits,
   with bounded attempts rather than sleeping through a short webtrigger budget.
4. **Capacity is not established.** Maximum Jira response size, worst-case live
   export duration, and TWG acceptance at 256 KiB remain unmeasured. Do not turn
   a documentation review into an operational-capacity claim. A targeted cloud
   check, if needed for a named risk, requires separate explicit authorization.

## Durable audit storage — approved 2026-11-22

Both webtrigger admission paths use the backbone `AuditPort` adapter in
`src/audit.ts`. The local publisher stores only the allowlisted backbone
CloudEvent, using create-only KVS writes at `audit:v1:<event-id>` with a **90-day
TTL from the first successful write**. Forge namespaces storage by installation
and environment; records additionally carry the runtime `installationId` and
unique `environmentId` from `getAppContext()`, never an HTTP-supplied identity.
Human account IDs come only from Jira-token-authenticated admission; a backend
impersonation reader is not a human web caller or a Connection account ID.
Methods must appear in the generated reviewed web policy; phases and reasons
use the backbone allowlist. Raw requests, exceptions, credentials, and additional
fields are not persisted.

A successful write is durable acknowledgment. A rejected/uncertain write is
acknowledged only if readback confirms the identical event and a future
`EXPIRE_TIME`; conflicting, missing, expired, or unreadable records fail.
Duplicate readback does not rewrite or refresh TTL. Each emission has a
**1000 ms acknowledgment bound**, enforced by the backbone: timeout fails a
critical attempt before its handler runs, but does not cancel a storage request
already sent. A late write may therefore leave an audit event without a
corresponding mutation. Outcome failure cannot undo a committed mutation;
lifecycle-specific outcome recovery remains part of Connection implementation.
No production method is made critical by this adapter ticket.

Standard methods now emit audit events: a normal exposed Command attempts
**three storage writes** (authentication, authorization, outcome); a critical
Command adds a pre-handler attempt write. Discovery and authentication rejection
normally attempt one. Dispatch rejection can use fewer. Failed writes add one
readback each; authentication and dispatch currently use separate correlation
IDs in the backbone. Standard audit failures are best effort, not evidence that
a record was saved. Missing trusted runtime identity can reject dispatch. There
is no audit retry queue, new invocation, external service, scope, egress, or
manifest change. These are operation counts, not measured cloud billing or
latency. Bundle budget increased from 34 to 35 kB for this adapter (first measured
bundle 34.41 kB versus prior 33.28 kB); no validation was removed to meet size.

Forge documents asynchronous TTL deletion taking up to **48 hours** after
expiry, during which reads can still return records. This is not exact-time
physical erasure, backup erasure, or a tamper-proof ledger. Backend verification
reads may use `kvs.get(eventKey, { metadataFields: [MetadataField.EXPIRE_TIME] })`
and must ignore past or invalid expiry metadata. Enumerating records requires a
bounded, paginated KVS query restricted to the `audit:v1:` prefix with the same
expiry filtering. No public reader exists. Any future user-facing reader must
check local Site Admin authority and must never serve peers. Earlier deletion
is authorized backend maintenance using exact audit keys and `kvs.delete`, not
a new user Command; routine removal uses TTL, without a cleanup scheduler.
No new production read/delete helper is introduced solely for tests.

The audit prefix is disjoint from operational-log keys but does not reserve
platform quota. Operational-log eviction must never delete audit records.
Quota exhaustion must fail critical attempts closed, not silently drop events.
Local fake-storage/webtrigger tests establish acknowledgement ordering,
allowlisting, duplicate/conflict behavior, expiry rejection, and critical
failure policy. They do not establish cloud atomicity, identity availability,
TTL enforcement, installed latency, or inter-installation isolation. Deployment
and installed persistence/fault verification remain pending authorization and a
safe synthetic critical-path design; no test-only production Command or auth
bypass is permitted. Until that evidence exists this is local implementation,
not operational clearance for critical Connection Commands.

Official references checked through Forge documentation search 2026-11-22:
[KVS partitioning and durability](https://developer.atlassian.com/platform/forge/storage-reference/kvs/),
[KVS TTL, metadata, and create-only writes](https://developer.atlassian.com/platform/forge/storage-reference/kvs-api/),
and [trusted runtime identity](https://developer.atlassian.com/platform/forge/runtime-reference/app-context-api/).

## Allowances are not hard quotas

Forge's current platform overview says consumption pricing replaced the former
usage quotas; hard execution/storage/rate limits and fair-use protections remain.
Do not use obsolete weekly seat-based quotas to derive application caps.

The current monthly free allowances are **per app**, not per installation:
200000 GB-seconds of function duration, 0.1 GB KVS reads, 0.1 GB KVS writes, and
1 GB log writes. Development and staging usage also count. Overage is billable,
not evidence that a document exceeds a hard platform limit. Actual billing,
remaining allowances, and tenant traffic were not inspected. Empty KVS reads
count as 1 KB for billing according to the current pricing page; rate-limit
10 KB rounding is a separate mechanism and must not be used as the billing rule.

## Official sources

Consulted 2026-11-20; live pages checked for invocation/storage limits, TWG rates,
pricing, platform quotas, and the document schema. Forge knowledge search also
returned the setObjects and webtrigger reference details.

- [Invocation limits](https://developer.atlassian.com/platform/forge/limits-invocation/)
- [Webtrigger request/response envelopes](https://developer.atlassian.com/platform/forge/events-reference/web-trigger/)
- [KVS and Custom Entity Store limits](https://developer.atlassian.com/platform/forge/limits-kvs-ce/)
- [Platform limits and usage](https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/)
- [Forge platform pricing](https://developer.atlassian.com/platform/forge/forge-platform-pricing/)
- [TWG connector rate limits](https://developer.atlassian.com/platform/teamwork-graph/rate-limits/)
- [setObjects](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-operations/set-objects/)
- [Document ingestion schema](https://developer.atlassian.com/platform/teamwork-graph/connector-reference/object-types-connectors/document/)
