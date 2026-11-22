import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { kvs, MetadataField, Sort, WhereConditions } from "@forge/kvs";
import { err, ok, type Result } from "@forge-ahead/errors";
import type { Commands } from "./generated/contract";
import { inputValidators, outputValidators } from "./generated/validators.js";
import { authenticateAdmin, type CommandContext } from "./jira";
import { runtimeIdentity } from "./log-events";

const entityName = "log-event";
const indexName = "by-kind-time";
const order = "newest-first" as const;
const cursorSecretKey = "logs:v1:cursor-secret";
const cursorTtlMs = 15 * 60 * 1000;
const retentionDays = { audit: 90, operational: 7 } as const;
const kindTypes = {
  audit: new Set([
    "com.forge-ahead.rpc.authentication",
    "com.forge-ahead.rpc.authorization",
    "com.forge-ahead.rpc.attempt",
    "com.forge-ahead.rpc.outcome",
  ]),
  operational: new Set([
    "com.workdown.log.info",
    "com.workdown.log.warn",
    "com.workdown.log.error",
    "com.workdown.log.fatal",
  ]),
} as const;
const canonicalUtc = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

type Params = Commands["logs.list"]["params"];
type Page = Commands["logs.list"]["result"];
type Kind = Params["kind"];
type StoredLogRecord = {
  kind: Kind;
  timeKey: string;
  eventType: string;
  correlationId: string;
  expiresAt: string;
  event: unknown;
};
type CursorPayload = {
  query: CanonicalQuery;
  forgeCursor: string;
  installationId: string;
  environment: string;
  expiresAt: number;
};
type CanonicalQuery = {
  kind: Kind;
  limit: number;
  type?: string;
  correlationId?: string;
  from: string;
  to: string;
  order: typeof order;
};

type QueryResult = {
  results: Array<{ key: string; value: StoredLogRecord; expireTime?: string }>;
  nextCursor?: string;
};

function effectiveBounds(params: Params, now = Date.now()) {
  const retentionFrom = new Date(
    now - retentionDays[params.kind] * 24 * 60 * 60 * 1000,
  ).toISOString();
  const to = params.to ?? new Date(now).toISOString();
  const from = params.from ?? retentionFrom;
  if (!canonicalUtc(from) || !canonicalUtc(to) || !(from < to))
    return undefined;
  if (from < retentionFrom || to > new Date(now).toISOString())
    return undefined;
  return { from, to };
}

function canonicalQuery(
  params: Params,
  now = Date.now(),
): CanonicalQuery | undefined {
  const limit = params.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) return undefined;
  if (params.type && !kindTypes[params.kind].has(params.type)) return undefined;
  const bounds = effectiveBounds(params, now);
  if (!bounds) return undefined;
  return {
    kind: params.kind,
    limit,
    ...(params.type ? { type: params.type } : {}),
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
    from: bounds.from,
    to: bounds.to,
    order,
  };
}

const sameQuery = (left: CanonicalQuery, right: CanonicalQuery) =>
  JSON.stringify(left) === JSON.stringify(right);

async function cursorKey(): Promise<Buffer> {
  const existing = await kvs.getSecret<string>(cursorSecretKey);
  if (typeof existing === "string") return Buffer.from(existing, "base64");
  const created = randomBytes(32).toString("base64");
  try {
    await kvs.setSecret(cursorSecretKey, created, {
      keyPolicy: "FAIL_IF_EXISTS",
    });
    const confirmed = await kvs.getSecret<string>(cursorSecretKey);
    if (confirmed !== created) throw Error("Cursor secret unconfirmed");
    return Buffer.from(confirmed, "base64");
  } catch {
    const raced = await kvs.getSecret<string>(cursorSecretKey);
    if (typeof raced === "string") return Buffer.from(raced, "base64");
    throw new Error("Cursor secret unavailable");
  }
}

async function sealCursor(payload: CursorPayload) {
  const key = await cursorKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
  if (token.length > 8192) throw new Error("Cursor too large");
  return token;
}

async function openCursor(
  token: string,
  params: Params,
): Promise<CursorPayload | undefined> {
  if (token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) return undefined;
  const key = await cursorKey();
  let payload: CursorPayload;
  try {
    const packed = Buffer.from(token, "base64url");
    if (packed.toString("base64url") !== token) return undefined;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const encrypted = packed.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    payload = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
        "utf8",
      ),
    ) as CursorPayload;
  } catch {
    return undefined;
  }
  const identity = runtimeIdentity();
  if (
    !payload?.query ||
    !sameQuery(
      payload.query,
      canonicalQuery(
        {
          ...params,
          from: params.from ?? payload.query.from,
          to: params.to ?? payload.query.to,
        },
        Date.parse(payload.query.to),
      ) as CanonicalQuery,
    ) ||
    payload.installationId !== identity.installationId ||
    payload.environment !== identity.environment ||
    payload.expiresAt <= Date.now() ||
    typeof payload.forgeCursor !== "string" ||
    !payload.forgeCursor
  )
    return undefined;
  return payload;
}

function project(
  row: { key: string; value: StoredLogRecord; expireTime?: string },
  query: CanonicalQuery,
) {
  const { installationId, environment } = runtimeIdentity();
  if (
    !row ||
    typeof row !== "object" ||
    !row.value ||
    typeof row.value !== "object"
  )
    return undefined;
  const { value } = row;
  if (
    value.kind !== query.kind ||
    row.key !== `${query.kind}:${eventId(value.event)}`
  )
    return undefined;
  if (!canonicalUtc(value.expiresAt) || !canonicalUtc(row.expireTime))
    return undefined;
  if (
    Date.parse(value.expiresAt) <= Date.now() ||
    Date.parse(row.expireTime) <= Date.now()
  )
    return undefined;
  const event = value.event as {
    time?: unknown;
    type?: unknown;
    data?: unknown;
  };
  if (
    typeof event !== "object" ||
    event === null ||
    event.type !== value.eventType ||
    !canonicalUtc(event.time) ||
    value.expiresAt !==
      new Date(
        Date.parse(event.time) + retentionDays[query.kind] * 86400000,
      ).toISOString() ||
    `${event.time}#${eventId(event)}` !== value.timeKey ||
    event.time < query.from ||
    event.time >= query.to ||
    !kindTypes[query.kind].has(event.type) ||
    (query.type && event.type !== query.type)
  )
    return undefined;
  const data = event.data as Record<string, unknown> | undefined;
  if (
    !data ||
    data["installationId"] !== installationId ||
    data["environment"] !== environment ||
    (data["correlationId"] ?? "-") !== value.correlationId ||
    (query.correlationId && data["correlationId"] !== query.correlationId)
  )
    return undefined;
  const wrapper = { kind: query.kind, events: [event], order };
  return outputValidators["logs.list"](wrapper) ? event : undefined;
}

function eventId(event: unknown) {
  return typeof event === "object" && event !== null && "id" in event
    ? String((event as { id: unknown }).id)
    : "";
}

async function withReadDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("logs deadline exhausted")),
          1000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function listLogs(
  params: Params,
  context: CommandContext,
): Promise<Result<Page, string>> {
  try {
    return await withReadDeadline(readLogs(params, context));
  } catch {
    return err("logs-unavailable");
  }
}

async function readLogs(
  params: Params,
  context: CommandContext,
): Promise<Result<Page, string>> {
  const authorization = context.principal.authorization;
  if (typeof authorization !== "string") return err("logs-unavailable");
  let admin: Awaited<ReturnType<typeof authenticateAdmin>>;
  try {
    admin = await authenticateAdmin(authorization, context.installation);
  } catch {
    return err("logs-unavailable");
  }
  if (admin.kind === "forbidden") return err("forbidden");
  if (admin.kind !== "authenticated") return err("logs-unavailable");
  let identity: { installationId: string; environment: string };
  try {
    identity = runtimeIdentity();
  } catch {
    return err("logs-unavailable");
  }
  if (!inputValidators["logs.list"](params)) return err("invalid-params");
  let query = canonicalQuery(params);
  let expiresAt = Date.now() + cursorTtlMs;
  let forgeCursor: string | undefined;
  try {
    if (params.cursor) {
      const continuation = await openCursor(params.cursor, params);
      if (!continuation) return err("invalid-params");
      forgeCursor = continuation.forgeCursor;
      query = continuation.query;
      expiresAt = continuation.expiresAt;
    }
    if (!query) return err("invalid-params");
    const selectedQuery = query;
    let builder = kvs
      .entity<StoredLogRecord>(entityName)
      .query({ metadataFields: [MetadataField.EXPIRE_TIME] })
      .index(indexName, { partition: [query.kind] })
      .where(WhereConditions.between(`${query.from}#`, `${query.to}#`))
      .sort(Sort.DESC)
      .limit(query.limit);
    if (forgeCursor) builder = builder.cursor(forgeCursor);
    const page = (await builder.getMany()) as QueryResult;
    const events = page.results
      .map((row) => project(row, selectedQuery))
      .filter((event): event is Page["events"][number] => event !== undefined);
    const cursor = page.nextCursor
      ? await sealCursor({
          query,
          forgeCursor: page.nextCursor,
          installationId: identity.installationId,
          environment: identity.environment,
          expiresAt,
        })
      : undefined;
    return ok({
      kind: query.kind,
      events,
      order,
      ...(cursor ? { nextCursor: cursor } : {}),
    });
  } catch {
    return err("logs-unavailable");
  }
}
