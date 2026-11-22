import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createForgeLogger, getLogContext } from "@forge-ahead/logging";
import { persistEvent, runtimeIdentity } from "./log-events";

type CapturedEvent = {
  specversion: "1.0";
  id: string;
  source: "urn:workdown:operational";
  type: `com.workdown.log.${"info" | "warn" | "error" | "fatal"}`;
  time: string;
  data: Record<string, string>;
};
type BufferState = {
  events: CapturedEvent[];
  bytes: number;
};

type Destination = {
  lastLevel?: number;
  write(chunk: string): void;
};

const capture = new AsyncLocalStorage<BufferState>();
type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";
const levelByNumber: Record<number, LogLevel> = {
  60: "fatal",
  50: "error",
  40: "warn",
  30: "info",
  20: "debug",
  10: "trace",
};
const logLevels = new Set<LogLevel>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);
const recordLevel = (value: unknown): LogLevel | undefined =>
  typeof value === "number"
    ? levelByNumber[value]
    : typeof value === "string" && logLevels.has(value as LogLevel)
      ? (value as LogLevel)
      : undefined;
const consoleMethodByLevel = {
  fatal: "error",
  error: "error",
  warn: "warn",
  info: "info",
  debug: "debug",
  trace: "debug",
} as const;
const publicationStages = new Set([
  "ingestion",
  "acknowledgment-storage",
  "notification",
  "notification-storage",
]);
const publicationOutcomes = new Set(["recorded", "conflict", "exception"]);
const summaryStages = new Set(["ingestion", "notification"]);
const summaryOutcomes = new Set(["succeeded", "failed"]);
const validCorrelationId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value);
const encodedSize = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

function dataFor(record: Record<string, unknown>, level: string) {
  let identity: { installationId: string; environment: string };
  try {
    identity = runtimeIdentity();
  } catch {
    return undefined;
  }
  const base: Record<string, string> = {
    installationId: identity.installationId,
    environment: identity.environment,
    level,
  };
  const requestId = getLogContext()["requestId"];
  if (validCorrelationId(requestId)) base["correlationId"] = requestId;
  if (record["msg"] === "workdown.publication") {
    if (
      publicationStages.has(String(record["stage"])) &&
      publicationOutcomes.has(String(record["outcome"]))
    )
      return {
        ...base,
        event: "workdown.publication",
        stage: String(record["stage"]),
        outcome: String(record["outcome"]),
      };
    return undefined;
  }
  if (record["msg"] === "workdown.publication.summary") {
    if (
      summaryStages.has(String(record["stage"])) &&
      summaryOutcomes.has(String(record["outcome"]))
    )
      return {
        ...base,
        event: "workdown.publication.summary",
        stage: String(record["stage"]),
        outcome: String(record["outcome"]),
      };
  }
  return undefined;
}

function captureRecord(line: string) {
  const state = capture.getStore();
  if (!state) return;
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line);
  } catch {
    return;
  }
  const level = recordLevel(record["level"]);
  if (
    level !== "info" &&
    level !== "warn" &&
    level !== "error" &&
    level !== "fatal"
  )
    return;
  const data = dataFor(record, level);
  if (!data) return;
  const event: CapturedEvent = {
    specversion: "1.0",
    id: randomUUID(),
    source: "urn:workdown:operational",
    type: `com.workdown.log.${level}`,
    time: new Date().toISOString(),
    data,
  };
  const bytes = encodedSize(event);
  if (bytes > 2048 || state.events.length >= 5 || state.bytes + bytes > 10240)
    return;
  state.events.push(event);
  state.bytes += bytes;
}

const destination: Destination = {
  lastLevel: 30,
  write(chunk) {
    const line = chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk;
    const level = levelByNumber[destination.lastLevel ?? 30] ?? "info";
    console[consoleMethodByLevel[level]](line);
    const state = capture.getStore();
    if (state) captureRecord(line);
  },
};

export const logger = createForgeLogger(
  { name: "workdown", pretty: false },
  destination,
);

export async function withOperationalLogs<T>(
  callback: () => T | Promise<T>,
): Promise<T> {
  const state: BufferState = { events: [], bytes: 0 };
  try {
    return await capture.run(state, callback);
  } finally {
    if (state.events.length) {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled(
            state.events.map((event) => persistEvent("operational", event)),
          ),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 250);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
