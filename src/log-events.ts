import { isDeepStrictEqual } from "node:util";
import { getAppContext } from "@forge/api";
import { kvs, MetadataField } from "@forge/kvs";
import { outputValidators } from "./generated/validators.js";

export function runtimeIdentity() {
  const { installationAri, environmentAri } = getAppContext();
  const installationId = installationAri.installationId;
  const environment = environmentAri.environmentId;
  if (
    ![installationId, environment].every(
      (value) =>
        typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value),
    )
  )
    throw Error("Log identity unavailable");
  return { installationId, environment };
}

export async function persistEvent(
  kind: "audit" | "operational",
  event: unknown,
) {
  if (
    !outputValidators["logs.list"]({
      kind,
      events: [event],
      order: "newest-first",
    })
  )
    throw Error("Invalid log event");
  const value = event as {
    id: string;
    time: string;
    type: string;
    data: Record<string, unknown>;
  };
  const identity = runtimeIdentity();
  const days = kind === "audit" ? 90 : 7;
  const time = Date.parse(value.time);
  if (
    value.type.startsWith("com.workdown.log.") !== (kind === "operational") ||
    new Date(time).toISOString() !== value.time ||
    time > Date.now() ||
    time + days * 86400000 <= Date.now() ||
    value.data["installationId"] !== identity.installationId ||
    value.data["environment"] !== identity.environment ||
    (kind === "operational" && Buffer.byteLength(JSON.stringify(event)) > 2048)
  )
    throw Error("Invalid log identity or retention");
  const record = {
    kind,
    timeKey: `${value.time}#${value.id}`,
    eventType: value.type,
    correlationId: value.data["correlationId"] ?? "-",
    expiresAt: new Date(time + days * 86400000).toISOString(),
    event,
  };
  const key = `${kind}:${value.id}`;
  const entity = kvs.entity<typeof record>("log-event");
  try {
    await entity.set(key, record, {
      keyPolicy: "FAIL_IF_EXISTS",
      ttl: { value: days, unit: "DAYS" },
    });
  } catch {
    if (kind === "operational") throw Error("Operational log unconfirmed");
    const stored = await entity.get(key, {
      metadataFields: [MetadataField.EXPIRE_TIME],
    });
    if (
      !stored?.expireTime ||
      !Number.isFinite(Date.parse(stored.expireTime)) ||
      Date.parse(stored.expireTime) <= Date.now() ||
      !isDeepStrictEqual(stored.value, record)
    )
      throw Error("Log write unconfirmed");
  }
}
