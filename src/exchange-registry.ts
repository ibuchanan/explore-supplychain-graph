import { createHash } from "node:crypto";
import { kvs, WhereConditions } from "@forge/kvs";
import type { ExchangeRegistration } from "./exchange";

const prefix = (cloudId: string) => `exchange-registration:${cloudId}:`;
const registrationKey = (registration: ExchangeRegistration) =>
  prefix(registration.cloudId) +
  createHash("sha256")
    .update(JSON.stringify([registration.connection, registration.document]))
    .digest("hex");

export async function rememberExchange(registration: ExchangeRegistration) {
  await kvs.set(registrationKey(registration), registration);
}

export async function registeredExchanges(cloudId: string) {
  const registrations: ExchangeRegistration[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    let query = kvs
      .query()
      .where("key", WhereConditions.beginsWith(prefix(cloudId)))
      .limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const row of page.results) {
      // Query results are eventually consistent; read the current principal.
      const value = await kvs.get<ExchangeRegistration>(row.key);
      if (
        !value ||
        value.cloudId !== cloudId ||
        typeof value.accountId !== "string" ||
        !value.accountId.trim() ||
        value.connection !== "development-loopback" ||
        !new RegExp(`^ari:cloud:jira:${cloudId}:issue/[0-9]+$`).test(
          value.document,
        ) ||
        registrationKey(value) !== row.key
      )
        throw new Error("Invalid Exchange registration");
      registrations.push(value);
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Repeated registry cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return registrations;
}
