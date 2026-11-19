import { err, ok, type Result } from "@forge-ahead/errors";
import { parse } from "yaml";
import type { Commands } from "./generated/contract";
import type { CommandContext } from "./jira";
import { validateWorkdown } from "./workdown-validation";

export type RetainedDocument = {
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
type Dependencies = PublicationDependencies & {
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
    let stage: Parameters<
      NonNullable<PublicationDependencies["reportPublication"]>
    >[0] = "ingestion";
    try {
      if (
        record.notificationPending &&
        record.publishedSequence !== record.updateSequenceNumber
      ) {
        if (!publication.notify) return;
        stage = "notification";
        await publication.notify({
          jsonrpc: "2.0",
          method: "publication.published",
          params: {
            connection: binding.connection,
            loopback: true,
            document: record.document,
            updateSequenceNumber: record.publishedSequence as number,
          },
        });
        const next = { ...record, notificationPending: false };
        stage = "notification-storage";
        if (
          !(await store.compareAndSet(
            storageKey,
            record.updateSequenceNumber,
            next,
            { sequence: record.publishedSequence, pending: true },
          ))
        ) {
          publication.reportPublication?.(stage, "conflict");
          return;
        }
        record = next;
      }
      if (record.publishedSequence !== record.updateSequenceNumber) {
        stage = "ingestion";
        if (!publication.ingest || !(await publication.ingest(record, binding)))
          return;
        stage = "acknowledgment-storage";
        const next = {
          ...record,
          publishedSequence: record.updateSequenceNumber,
          notificationPending: true,
        };
        if (
          !(await store.compareAndSet(
            storageKey,
            record.updateSequenceNumber,
            next,
            {
              sequence: record.publishedSequence,
              pending: record.notificationPending,
            },
          ))
        ) {
          publication.reportPublication?.(stage, "conflict");
          return;
        }
        publication.reportPublication?.(stage, "recorded");
        record = next;
      }
      if (record.notificationPending && publication.notify) {
        stage = "notification";
        await publication.notify({
          jsonrpc: "2.0",
          method: "publication.published",
          params: {
            connection: binding.connection,
            loopback: true,
            document: record.document,
            updateSequenceNumber: record.updateSequenceNumber,
          },
        });
        stage = "notification-storage";
        const recorded = await store.compareAndSet(
          storageKey,
          record.updateSequenceNumber,
          { ...record, notificationPending: false },
          { sequence: record.publishedSequence, pending: true },
        );
        publication.reportPublication?.(
          stage,
          recorded ? "recorded" : "conflict",
        );
      }
    } catch {
      publication.reportPublication?.(stage, "exception");
      // Destination acceptance survives ingestion or notification failure.
      // Pending notification state permits at-least-once retry without reingestion.
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
        };
        if (
          await store.compareAndSet(
            storageKey,
            current?.updateSequenceNumber ?? 0,
            retained,
            {
              sequence: current?.publishedSequence,
              pending: current?.notificationPending,
            },
          )
        ) {
          await publish(retained, binding, storageKey);
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
          const next = {
            document,
            updateSequenceNumber: sequence + 1,
            workdown: generated.value,
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
      try {
        const accepted = await receive(candidate, binding);
        if ("error" in accepted) return accepted;
        if (
          !Number.isSafeInteger(accepted.value) ||
          accepted.value < candidate.updateSequenceNumber
        )
          return err("delivery-unconfirmed");
        return ok({
          connection: params.connection,
          loopback: true,
          document,
          updateSequenceNumber: accepted.value,
        });
      } catch {
        return err("delivery-unconfirmed");
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
