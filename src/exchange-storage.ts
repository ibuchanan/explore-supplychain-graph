import { createHash } from "node:crypto";
import { Filter, FilterConditions, kvs } from "@forge/kvs";
import type { ExchangeStore, RetainedDocument } from "./exchange";

type Stored = { version: string; publication?: string; payload: unknown };
const publicationVersion = (sequence?: number, pending?: boolean) =>
  JSON.stringify([sequence ?? null, pending ?? null]);
const entityName = "exchange-document";
const baseKey = (key: string) => createHash("sha256").update(key).digest("hex");
const entity = () => kvs.entity<Stored>(entityName);

// One conditional transaction commits the version and all four bounded chunks.
// Re-read the version to fence chunk reads against a concurrent replacement.
export const exchangeStore: ExchangeStore = {
  async read(key) {
    const base = baseKey(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await entity().get(base);
      if (!before) return undefined;
      const chunks = await Promise.all(
        [0, 1, 2, 3].map((i) => entity().get(`${base}:${i}`)),
      );
      const after = await entity().get(base);
      if (
        after?.version !== before.version ||
        after?.publication !== before.publication
      )
        continue;
      if (
        chunks.some(
          (chunk) =>
            !chunk ||
            chunk.version !== before.version ||
            typeof chunk.payload !== "string",
        )
      )
        throw new Error("Inconsistent retained document");
      const updateSequenceNumber = Number(before.version);
      if (
        !Number.isSafeInteger(updateSequenceNumber) ||
        updateSequenceNumber < 1 ||
        !before.payload ||
        typeof before.payload !== "object" ||
        !("document" in before.payload) ||
        typeof before.payload.document !== "string"
      )
        throw new Error("Invalid retained metadata");
      const publishedSequence =
        "publishedSequence" in before.payload
          ? before.payload.publishedSequence
          : undefined;
      const notificationPending =
        "notificationPending" in before.payload
          ? before.payload.notificationPending
          : undefined;
      if (
        (publishedSequence !== undefined &&
          (typeof publishedSequence !== "number" ||
            !Number.isSafeInteger(publishedSequence) ||
            publishedSequence < 1 ||
            publishedSequence > updateSequenceNumber)) ||
        (notificationPending !== undefined &&
          typeof notificationPending !== "boolean") ||
        (notificationPending === true && publishedSequence === undefined) ||
        before.publication !==
          (publishedSequence === undefined && notificationPending === undefined
            ? undefined
            : publicationVersion(
                publishedSequence as number | undefined,
                notificationPending as boolean | undefined,
              ))
      )
        throw new Error("Invalid publication metadata");
      return {
        document: before.payload.document,
        updateSequenceNumber,
        ...("publishedSequence" in before.payload
          ? { publishedSequence: before.payload.publishedSequence as number }
          : {}),
        ...("notificationPending" in before.payload
          ? {
              notificationPending: before.payload
                .notificationPending as boolean,
            }
          : {}),
        workdown: Buffer.concat(
          chunks.map((chunk) =>
            Buffer.from(chunk?.payload as string, "base64"),
          ),
        ).toString("utf8"),
      };
    }
    throw new Error("Concurrent read unavailable");
  },
  async compareAndSet(key, previous, value: RetainedDocument, publication) {
    const base = baseKey(key);
    const version = String(value.updateSequenceNumber);
    const conditions = new Filter<Stored>().and(
      "version",
      previous === 0
        ? FilterConditions.notExists()
        : FilterConditions.equalTo(String(previous)),
    );
    if (publication)
      conditions.and(
        "publication",
        publication.sequence === undefined && publication.pending === undefined
          ? FilterConditions.notExists()
          : FilterConditions.equalTo(
              publicationVersion(publication.sequence, publication.pending),
            ),
      );
    const {
      workdown: _workdown,
      updateSequenceNumber: _sequence,
      ...metadata
    } = value;
    const transaction = kvs.transact().set(
      base,
      {
        version,
        ...(value.publishedSequence === undefined &&
        value.notificationPending === undefined
          ? {}
          : {
              publication: publicationVersion(
                value.publishedSequence,
                value.notificationPending,
              ),
            }),
        payload: metadata,
      },
      { entityName, conditions },
    );
    const bytes = Buffer.from(value.workdown, "utf8");
    if (bytes.length > 262144)
      throw new Error("Document exceeds storage bound");
    for (let i = 0; i < 4; i++)
      transaction.set(
        `${base}:${i}`,
        {
          version,
          payload: bytes
            .subarray(i * 65536, (i + 1) * 65536)
            .toString("base64"),
        },
        { entityName },
      );
    try {
      await transaction.execute();
      return true;
    } catch (error) {
      // A timeout may have committed. Confirm through retained state, never
      // classify arbitrary SDK failures as conditional conflicts.
      const current = await this.read(key);
      if (
        current &&
        (current.updateSequenceNumber > previous ||
          (publication &&
            (current.publishedSequence !== publication.sequence ||
              current.notificationPending !== publication.pending)))
      )
        return false;
      throw error;
    }
  },
};
