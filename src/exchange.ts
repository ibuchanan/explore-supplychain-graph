import { err, ok, type Result } from "@forge-ahead/errors";
import { parse } from "yaml";
import type { Commands } from "./generated/contract";
import { outputValidators } from "./generated/validators.js";
import type { CommandContext } from "./jira";
import {
  failureStatus,
  nativeRetry,
  type RetryBody,
  type RetryEvent,
  type Stage,
  stageStatus,
  stopped,
} from "./retry";
import { validateWorkdown } from "./workdown-validation";

export type StageStatus = Commands["exchange.status"]["result"]["delivery"];
export type RetainedDocument = {
  delivery?: StageStatus;
  ingestion?: StageStatus;
  notification?: StageStatus;
  revision?: string;
  document: string;
  updateSequenceNumber: number;
  workdown: string;
  publishedSequence?: number;
  notificationPending?: boolean;
};
export type ExchangeStore = {
  read(key: string): Promise<RetainedDocument | undefined>;
  compareAndSet(
    key: string,
    previous: number,
    value: RetainedDocument,
    publication?: {
      sequence?: number | undefined;
      pending?: boolean | undefined;
      revision?: string | undefined;
    },
  ): Promise<boolean>;
};
export type Binding = { cloudId: string; connection: string };
export type PublicationNotification = {
  jsonrpc: "2.0";
  method: "publication.published";
  params: {
    connection: string;
    loopback: boolean;
    document: string;
    updateSequenceNumber: number;
  };
};
type PublicationDependencies = {
  schedule?: ((body: RetryBody, delay: number) => Promise<void>) | undefined;
  now?: () => number;
  random?: () => number;
  notificationEnabled?: boolean;
  ingest?: (record: RetainedDocument, binding: Binding) => Promise<boolean>;
  notify?: (notification: PublicationNotification) => Promise<void>;
  reportPublication?: (
    stage:
      | "ingestion"
      | "acknowledgment-storage"
      | "notification"
      | "notification-storage",
    outcome: "recorded" | "conflict" | "exception",
  ) => void;
};
type Receipt = (
  candidate: RetainedDocument,
  binding: Binding,
) => Promise<Result<number, string>>;
export type ExchangeRegistration = Binding & {
  document: string;
  accountId: string;
};
type Dependencies = PublicationDependencies & {
  remember?: (registration: ExchangeRegistration) => Promise<void>;
  store: ExchangeStore;
  environment: () => string;
  generate: (
    params: Commands["workdown.export"]["params"],
    context: CommandContext,
  ) => Promise<Result<string, string>>;
  isProjectAdmin: (issue: string, context: CommandContext) => Promise<boolean>;
  deliver?: Receipt;
};
const active = (environment: string, connection: string) =>
  environment === "DEVELOPMENT" && connection === "development-loopback";
const key = (role: string, binding: Binding, document: string) =>
  JSON.stringify([binding.cloudId, binding.connection, role, document]);
const identity = (workdown: string): string =>
  (
    parse(workdown.slice(4, workdown.indexOf("\n---\n", 4))) as {
      source_id: string;
    }
  ).source_id;
function valid(record: RetainedDocument): boolean {
  return (
    typeof record === "object" &&
    record !== null &&
    [record.delivery, record.ingestion, record.notification].every(
      (status) =>
        status === undefined ||
        (outputValidators["exchange.status"]({
          connection: "development-loopback",
          loopback: true,
          document: record.document,
          preparedSequence: record.updateSequenceNumber,
          delivery: status,
        }) &&
          (status.nextAttemptAt === null ||
            (Number.isFinite(Date.parse(status.nextAttemptAt)) &&
              new Date(status.nextAttemptAt).toISOString() ===
                status.nextAttemptAt)) &&
          (status.sequence === null ||
            status.sequence <= record.updateSequenceNumber) &&
          (status.lastSuccessfulSequence === null ||
            status.lastSuccessfulSequence <=
              (status.sequence ?? record.updateSequenceNumber))),
    ) &&
    Number.isSafeInteger(record.updateSequenceNumber) &&
    record.updateSequenceNumber >= 1 &&
    (record.publishedSequence === undefined ||
      (Number.isSafeInteger(record.publishedSequence) &&
        record.publishedSequence >= 1 &&
        record.publishedSequence <= record.updateSequenceNumber)) &&
    (record.notificationPending === undefined ||
      typeof record.notificationPending === "boolean") &&
    (!record.notificationPending || record.publishedSequence !== undefined) &&
    validateWorkdown(record.workdown) &&
    Buffer.byteLength(record.workdown, "utf8") <= 262144 &&
    identity(record.workdown) === record.document
  );
}

// Internal receipt seam: binding is trusted adapter context, never a public RPC
// parameter. Only the authenticated source Command can invoke loopback receipt.
async function saveStage(
  store: ExchangeStore,
  storageKey: string,
  record: RetainedDocument,
  next: RetainedDocument,
) {
  return store.compareAndSet(storageKey, record.updateSequenceNumber, next, {
    sequence: record.publishedSequence,
    pending: record.notificationPending,
    revision: record.revision,
  });
}
async function scheduleStage(
  deps: PublicationDependencies,
  status: StageStatus,
  body: RetryBody,
) {
  if (!deps.schedule || status.state !== "retrying" || !status.nextAttemptAt)
    return;
  try {
    await deps.schedule(
      body,
      Math.max(
        1,
        Math.ceil(
          (Date.parse(status.nextAttemptAt) - (deps.now?.() ?? Date.now())) /
            1000,
        ),
      ),
    );
  } catch {
    /* Enqueue gaps are an accepted limit; status is not a queue receipt. */
  }
}
async function deliverCandidate(
  deps: Dependencies,
  receive: Receipt,
  record: RetainedDocument,
  binding: Binding,
  storageKey: string,
  retryCount?: number,
): Promise<Result<number, string>> {
  const previous = record.delivery;
  if (previous?.state === "succeeded") return ok(record.updateSequenceNumber);
  if (
    stopped(previous) ||
    (previous?.nextAttemptAt &&
      Date.parse(previous.nextAttemptAt) > (deps.now?.() ?? Date.now()))
  )
    return err("delivery-unconfirmed");
  const attempts = Math.min(
    4,
    Math.max(
      (previous?.attempts ?? 0) + 1,
      retryCount === undefined ? 1 : retryCount + 2,
    ),
  );
  let accepted: Result<number, string>;
  let deliveryError: unknown;
  try {
    accepted = await receive(record, binding);
  } catch (error) {
    deliveryError = error;
    accepted = err("delivery-unconfirmed");
  }
  const succeeded =
    "value" in accepted &&
    Number.isSafeInteger(accepted.value) &&
    accepted.value >= record.updateSequenceNumber;
  const status = succeeded
    ? stageStatus(
        "succeeded",
        record.updateSequenceNumber,
        record.updateSequenceNumber,
        attempts,
      )
    : failureStatus(
        deliveryError ?? {
          kind:
            "error" in accepted && accepted.error === "invalid-params"
              ? "validation"
              : "unknown",
        },
        record.updateSequenceNumber,
        previous,
        attempts,
        deps.now?.() ?? Date.now(),
        deps.random?.() ?? Math.random(),
      );
  if (
    !(await saveStage(deps.store, storageKey, record, {
      ...record,
      delivery: status,
    }))
  )
    return err("delivery-unconfirmed");
  await scheduleStage(deps, status, {
    connection: binding.connection,
    document: record.document,
    stage: "delivery",
    sequence: record.updateSequenceNumber,
  });
  return succeeded ? accepted : err("delivery-unconfirmed");
}
async function runDestination(
  store: ExchangeStore,
  deps: PublicationDependencies,
  original: RetainedDocument,
  binding: Binding,
  storageKey: string,
  only?: Stage,
  retryCount?: number,
) {
  let record = original;
  const now = () => deps.now?.() ?? Date.now();
  async function perform(
    stage: "ingestion" | "notification",
    sequence: number,
  ): Promise<boolean> {
    const prior = record[stage];
    if (prior?.sequence === sequence) {
      if (prior.state === "succeeded") return true;
      if (
        stopped(prior) ||
        (prior.nextAttemptAt && Date.parse(prior.nextAttemptAt) > now())
      )
        return false;
    }
    const previous = prior?.sequence === sequence ? prior : undefined;
    const attempts = Math.min(
      4,
      Math.max(
        (previous?.attempts ?? 0) + 1,
        retryCount === undefined || only !== stage ? 1 : retryCount + 1,
      ),
    );
    let status: StageStatus;
    try {
      if (stage === "ingestion") {
        if (!deps.ingest || !(await deps.ingest(record, binding)))
          throw { kind: "unknown" };
      } else {
        if (!deps.notify || deps.notificationEnabled === false) {
          const next = {
            ...record,
            notification: stageStatus(
              "disabled",
              null,
              prior?.lastSuccessfulSequence ?? null,
              0,
            ),
            notificationPending: false,
          };
          if (!(await saveStage(store, storageKey, record, next))) return false;
          record = (await store.read(storageKey)) ?? next;
          return true;
        }
        await deps.notify({
          jsonrpc: "2.0",
          method: "publication.published",
          params: {
            connection: binding.connection,
            loopback: true,
            document: record.document,
            updateSequenceNumber: sequence,
          },
        });
      }
      status = stageStatus("succeeded", sequence, sequence, attempts);
    } catch (error) {
      status = failureStatus(
        error,
        sequence,
        prior,
        attempts,
        now(),
        deps.random?.() ?? Math.random(),
      );
    }
    const succeeded = status.state === "succeeded";
    const next: RetainedDocument = {
      ...record,
      [stage]: status,
      ...(stage === "ingestion" && succeeded
        ? { publishedSequence: sequence, notificationPending: true }
        : {}),
      ...(stage === "notification" && succeeded
        ? { notificationPending: false }
        : {}),
    };
    if (!(await saveStage(store, storageKey, record, next))) {
      deps.reportPublication?.("acknowledgment-storage", "conflict");
      return false;
    }
    record = (await store.read(storageKey)) ?? next;
    if (!succeeded && only !== stage)
      await scheduleStage(deps, status, {
        connection: binding.connection,
        document: record.document,
        stage,
        sequence,
      });
    return succeeded;
  }
  if (
    record.notificationPending &&
    record.publishedSequence !== record.updateSequenceNumber
  ) {
    if (only === "ingestion") return;
    if (!(await perform("notification", record.publishedSequence as number)))
      return;
  }
  if (record.publishedSequence !== record.updateSequenceNumber) {
    if (only === "notification") {
      if (deps.schedule)
        await deps.schedule(
          {
            connection: binding.connection,
            document: record.document,
            stage: "ingestion",
            sequence: record.updateSequenceNumber,
          },
          0,
        );
      return;
    }
    if (!(await perform("ingestion", record.updateSequenceNumber))) return;
  }
  if (record.notificationPending)
    await perform("notification", record.publishedSequence as number);
}

export function createLoopbackReceiver(
  store: ExchangeStore,
  environment: () => string,
  publication: PublicationDependencies = {},
): Receipt {
  async function publish(
    record: RetainedDocument,
    binding: Binding,
    storageKey: string,
  ) {
    try {
      await runDestination(store, publication, record, binding, storageKey);
    } catch {
      publication.reportPublication?.("acknowledgment-storage", "exception");
    }
  }
  return async (candidate, binding) => {
    if (!active(environment(), binding.connection))
      return err("connection-unavailable");
    if (
      !valid(candidate) ||
      !candidate.document.startsWith(`ari:cloud:jira:${binding.cloudId}:issue/`)
    )
      return err("invalid-params");
    const storageKey = key("destination", binding, candidate.document);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await store.read(storageKey);
        if (current && !valid(current)) return err("internal-error");
        if (
          current &&
          current.updateSequenceNumber >= candidate.updateSequenceNumber
        ) {
          if (
            current.updateSequenceNumber === candidate.updateSequenceNumber &&
            current.workdown !== candidate.workdown
          )
            return err("invalid-params");
          if (current.updateSequenceNumber === candidate.updateSequenceNumber)
            await publish(current, binding, storageKey);
          return ok(current.updateSequenceNumber);
        }
        const retained = {
          document: candidate.document,
          workdown: candidate.workdown,
          updateSequenceNumber: candidate.updateSequenceNumber,
          ...(current?.publishedSequence === undefined
            ? {}
            : { publishedSequence: current.publishedSequence }),
          ...(current?.notificationPending === undefined
            ? {}
            : { notificationPending: current.notificationPending }),
          ingestion: stageStatus(
            "pending",
            candidate.updateSequenceNumber,
            current?.publishedSequence ?? null,
            0,
          ),
          ...(current?.notification
            ? { notification: current.notification }
            : {}),
        };
        if (
          await store.compareAndSet(
            storageKey,
            current?.updateSequenceNumber ?? 0,
            retained,
            {
              sequence: current?.publishedSequence,
              pending: current?.notificationPending,
              revision: current?.revision,
            },
          )
        ) {
          await publish(
            (await store.read(storageKey)) ?? retained,
            binding,
            storageKey,
          );
          return ok(candidate.updateSequenceNumber);
        }
      }
      return err("delivery-unconfirmed");
    } catch {
      return err("storage-unavailable");
    }
  };
}

export function createExchangeCommands(deps: Dependencies) {
  const receive =
    deps.deliver ?? createLoopbackReceiver(deps.store, deps.environment, deps);
  const authenticated = (context: CommandContext) =>
    !!context.principal.accountId && !!context.principal.authorization;
  async function readRecord(
    params: Commands["document.get"]["params"],
    context: CommandContext,
  ) {
    if (!authenticated(context)) return err("forbidden");
    if (!active(deps.environment(), params.connection))
      return err("connection-unavailable");
    try {
      const record = await deps.store.read(
        key(
          "destination",
          {
            cloudId: context.installation.cloudId,
            connection: params.connection,
          },
          params.document,
        ),
      );
      if (!record) return err("document-unavailable");
      if (!valid(record) || record.document !== params.document)
        return err("internal-error");
      return ok(record);
    } catch {
      return err("storage-unavailable");
    }
  }
  return {
    async start(
      params: Commands["exchange.start"]["params"],
      context: CommandContext,
    ) {
      if (!authenticated(context)) return err("forbidden");
      if (!(await deps.isProjectAdmin(params.issue, context)))
        return err("forbidden");
      if (!active(deps.environment(), params.connection))
        return err("connection-unavailable");
      const generated = await deps.generate(params, context);
      if ("error" in generated) return generated;
      if (
        !validateWorkdown(generated.value) ||
        Buffer.byteLength(generated.value, "utf8") > 262144
      )
        return err("internal-error");
      const document = identity(generated.value);
      if (
        !new RegExp(
          `^ari:cloud:jira:${context.installation.cloudId}:issue/[0-9]+$`,
        ).test(document)
      )
        return err("internal-error");
      const binding = {
        cloudId: context.installation.cloudId,
        connection: params.connection,
      };
      try {
        if (typeof context.principal.authorization === "string")
          await deps.remember?.({
            ...binding,
            document,
            accountId: context.principal.accountId,
          });
      } catch {
        return err("storage-unavailable");
      }
      const storageKey = key("source", binding, document);
      let candidate: RetainedDocument | undefined;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await deps.store.read(storageKey);
          if (current && !valid(current)) return err("internal-error");
          if (current?.workdown === generated.value) {
            candidate = current;
            break;
          }
          const sequence = current?.updateSequenceNumber ?? 0;
          if (sequence >= Number.MAX_SAFE_INTEGER)
            return err("storage-unavailable");
          const next: RetainedDocument = {
            document,
            updateSequenceNumber: sequence + 1,
            workdown: generated.value,
            delivery: stageStatus(
              "pending",
              sequence + 1,
              current?.delivery?.lastSuccessfulSequence ?? null,
              0,
            ),
          };
          if (await deps.store.compareAndSet(storageKey, sequence, next)) {
            candidate = next;
            break;
          }
        }
      } catch {
        return err("storage-unavailable");
      }
      if (!candidate) return err("delivery-unconfirmed");
      candidate = (await deps.store.read(storageKey)) ?? candidate;
      const delivered = await deliverCandidate(
        deps,
        receive,
        candidate,
        binding,
        storageKey,
      );
      if ("error" in delivered) return delivered;
      return ok({
        connection: params.connection,
        loopback: true,
        document,
        updateSequenceNumber: delivered.value,
      });
    },
    async consume(event: RetryEvent, context: CommandContext) {
      const body = event.body as Partial<RetryBody> | null;
      if (
        !body ||
        typeof body !== "object" ||
        typeof body.document !== "string" ||
        typeof body.connection !== "string" ||
        !["delivery", "ingestion", "notification"].includes(
          String(body.stage),
        ) ||
        !Number.isSafeInteger(body.sequence) ||
        (body.sequence ?? 0) < 1
      )
        return;
      if (!active(deps.environment(), body.connection)) return;
      const subject = new RegExp(
        `^ari:cloud:jira:${context.installation.cloudId}:issue/([0-9]+)$`,
      ).exec(body.document)?.[1];
      if (!subject || !authenticated(context)) return;
      const authorized = await deps.isProjectAdmin(subject, context);
      const binding = {
        cloudId: context.installation.cloudId,
        connection: body.connection,
      };
      const stage = body.stage as Stage;
      const storageKey = key(
        stage === "delivery" ? "source" : "destination",
        binding,
        body.document,
      );
      const record = await deps.store.read(storageKey);
      if (!record || !valid(record) || record.document !== body.document)
        return;
      const status = record[stage];
      if (!status || status.sequence !== body.sequence || stopped(status))
        return;
      if (!authorized) {
        await saveStage(deps.store, storageKey, record, {
          ...record,
          [stage]: stageStatus(
            "failed",
            status.sequence,
            status.lastSuccessfulSequence,
            status.attempts ?? 1,
            "authorization",
          ),
        });
        return;
      }
      const now = deps.now?.() ?? Date.now();
      if (status.nextAttemptAt && Date.parse(status.nextAttemptAt) > now)
        return nativeRetry(status, now);
      if (stage === "delivery")
        await deliverCandidate(
          { ...deps, schedule: undefined },
          receive,
          record,
          binding,
          storageKey,
          event.retryContext?.retryCount ?? 0,
        );
      else
        await runDestination(
          deps.store,
          deps,
          record,
          binding,
          storageKey,
          stage,
          event.retryContext?.retryCount ?? 0,
        );
      const latest = await deps.store.read(storageKey);
      const nextStatus = latest?.[stage];
      return nextStatus && nextStatus.sequence === body.sequence
        ? nativeRetry(nextStatus, deps.now?.() ?? Date.now())
        : undefined;
    },
    async sourceStatus(
      params: Commands["exchange.status"]["params"],
      context: CommandContext,
    ) {
      if (!authenticated(context)) return err("forbidden");
      const subject = new RegExp(
        `^ari:cloud:jira:${context.installation.cloudId}:issue/([0-9]+)$`,
      ).exec(params.document)?.[1];
      if (!subject || !(await deps.isProjectAdmin(subject, context)))
        return err("forbidden");
      if (!active(deps.environment(), params.connection))
        return err("connection-unavailable");
      try {
        const record = await deps.store.read(
          key(
            "source",
            {
              cloudId: context.installation.cloudId,
              connection: params.connection,
            },
            params.document,
          ),
        );
        if (!record) return err("document-unavailable");
        if (!valid(record) || record.document !== params.document)
          return err("internal-error");
        return ok({
          ...params,
          loopback: true,
          preparedSequence: record.updateSequenceNumber,
          delivery: record.delivery ?? {
            state: "unknown" as const,
            sequence: record.updateSequenceNumber,
            lastSuccessfulSequence: null,
            attempts: null,
            lastFailure: null,
            nextAttemptAt: null,
          },
        });
      } catch {
        return err("storage-unavailable");
      }
    },
    async status(
      params: Commands["publication.status"]["params"],
      context: CommandContext,
    ) {
      const result = await readRecord(params, context);
      if ("error" in result)
        return result.error === "internal-error"
          ? err("storage-unavailable")
          : result;
      const record = result.value;
      return ok({
        connection: params.connection,
        loopback: true,
        document: record.document,
        retainedSequence: record.updateSequenceNumber,
        publishedSequence: record.publishedSequence ?? null,
        ingestion:
          record.ingestion ??
          stageStatus(
            "unknown",
            record.updateSequenceNumber,
            record.publishedSequence ?? null,
            null,
          ),
        notification:
          record.notification ??
          stageStatus("unknown", record.publishedSequence ?? null, null, null),
      });
    },
    async get(
      params: Commands["document.get"]["params"],
      context: CommandContext,
    ) {
      const result = await readRecord(params, context);
      if ("error" in result) return result;
      const { document, updateSequenceNumber, workdown } = result.value;
      return ok({
        connection: params.connection,
        loopback: true,
        document,
        updateSequenceNumber,
        workdown,
      });
    },
  };
}
