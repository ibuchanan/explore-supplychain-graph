import { isDeepStrictEqual } from "node:util";
import { getAppContext } from "@forge/api";
import { kvs, MetadataField } from "@forge/kvs";
import type { WebtriggerOptions } from "@forge-ahead/rpc/webtrigger";
import { webPolicy } from "./generated/policy";
import type { CommandContext, Installation, Principal } from "./jira";

const reasons = new Set([
  "authenticated",
  "invalid-credentials",
  "not-admin",
  "unavailable",
  "allowed",
  "denied",
  "unknown",
  "started",
  "succeeded",
  "failed",
]);
const phases = new Set([
  "authentication",
  "authorization",
  "attempt",
  "outcome",
]);
const bounded = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  [...value].every((character) => character >= " " && character !== "\x7f");
const runtimeIdentity = () => {
  const { installationAri, environmentAri } = getAppContext();
  const installationId = installationAri.installationId;
  const environment = environmentAri.environmentId;
  if (!bounded(installationId) || !bounded(environment))
    throw new Error("Audit identity unavailable");
  return { installationId, environment };
};

type AuditPort = NonNullable<
  WebtriggerOptions<CommandContext, unknown, Installation, Principal>["audit"]
>;
type AuditEvent = Parameters<AuditPort["publish"]>[0];

export const audit: AuditPort = {
  source: "urn:workdown:audit",
  identity: runtimeIdentity,
  // Only Jira-token admission currently establishes a human web caller.
  accountId: (principal) =>
    typeof principal.authorization === "string" &&
    /^Basic [A-Za-z0-9+/]+={0,2}$/.test(principal.authorization)
      ? principal.accountId
      : "",
  timeoutMs: 1000,
  onFailure: () => {},
  async publish(event) {
    const identity = runtimeIdentity();
    if (
      event.specversion !== "1.0" ||
      event.source !== "urn:workdown:audit" ||
      !/^com\.forge-ahead\.rpc\./.test(event.type) ||
      !phases.has(event.type.slice("com.forge-ahead.rpc.".length)) ||
      !/^[A-Za-z0-9-]{1,200}$/.test(event.id) ||
      !bounded(event.time) ||
      !Number.isFinite(Date.parse(event.time)) ||
      !bounded(event.data.correlationId) ||
      event.data.installationId !== identity.installationId ||
      event.data.environment !== identity.environment ||
      !reasons.has(event.data.reason) ||
      (event.data.method !== undefined &&
        !Object.hasOwn(webPolicy, event.data.method)) ||
      (event.data.accountId !== undefined && !bounded(event.data.accountId))
    )
      throw new Error("Invalid audit event");
    const record: AuditEvent = {
      specversion: event.specversion,
      id: event.id,
      source: event.source,
      type: event.type,
      time: event.time,
      data: {
        installationId: event.data.installationId,
        environment: event.data.environment,
        correlationId: event.data.correlationId,
        reason: event.data.reason,
        ...(event.data.method ? { method: event.data.method } : {}),
        ...(event.data.accountId ? { accountId: event.data.accountId } : {}),
      },
    };
    const key = `audit:v1:${record.id}`;
    try {
      await kvs.set(key, record, {
        keyPolicy: "FAIL_IF_EXISTS",
        ttl: { value: 90, unit: "DAYS" },
      });
    } catch {
      const stored = await kvs.get<AuditEvent>(key, {
        metadataFields: [MetadataField.EXPIRE_TIME],
      });
      if (
        !stored?.expireTime ||
        !(Date.parse(stored.expireTime) > Date.now()) ||
        !isDeepStrictEqual(stored.value, record)
      )
        throw new Error("Audit acknowledgment unavailable");
    }
  },
};
