import { InvocationError, InvocationErrorCode } from "@forge/events";
import type { StageStatus } from "./exchange";

export type IngestionFailure = {
  kind:
    | "authorization"
    | "validation"
    | "rate-limited"
    | "unavailable"
    | "timeout"
    | "unknown";
  retryAfter?: string;
};
export function classifyFailure(error: unknown): IngestionFailure {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status = value["status"];
  const categories = [
    "authorization",
    "validation",
    "rate-limited",
    "unavailable",
    "timeout",
    "unknown",
  ] as const;
  const kind =
    categories.find((kind) => kind === value["kind"]) ??
    (status === 401 || status === 403
      ? "authorization"
      : status === 400 || status === 404 || status === 422
        ? "validation"
        : status === 429
          ? "rate-limited"
          : typeof status === "number" && status >= 500 && status <= 599
            ? "unavailable"
            : value["name"] === "TimeoutError" || value["name"] === "AbortError"
              ? "timeout"
              : "unknown");
  const headers = value["headers"];
  let retryAfter: unknown = value["retryAfter"];
  if (headers && typeof headers === "object") {
    if ("get" in headers && typeof headers.get === "function")
      retryAfter = headers.get("Retry-After");
    else
      retryAfter = Object.entries(headers).find(
        ([key]) => key.toLowerCase() === "retry-after",
      )?.[1];
  }
  return { kind, ...(typeof retryAfter === "string" ? { retryAfter } : {}) };
}

export type Stage = "delivery" | "ingestion" | "notification";
export type RetryBody = {
  connection: string;
  document: string;
  stage: Stage;
  sequence: number;
};
export type RetryEvent = {
  body: unknown;
  retryContext?: { retryCount: number };
};
export const stageStatus = (
  state: StageStatus["state"],
  sequence: number | null,
  lastSuccessfulSequence: number | null,
  attempts: number | null,
  lastFailure: StageStatus["lastFailure"] = null,
  nextAttemptAt: string | null = null,
): StageStatus => ({
  state,
  sequence,
  lastSuccessfulSequence,
  attempts,
  lastFailure,
  nextAttemptAt,
});
export const stopped = (status?: StageStatus) =>
  !!status &&
  [
    "succeeded",
    "failed",
    "exhausted",
    "retry-delay-unsupported",
    "disabled",
  ].includes(status.state);

export function failureStatus(
  error: unknown,
  sequence: number,
  previous: StageStatus | undefined,
  attempts: number,
  now: number,
  random: number,
): StageStatus {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const { kind, retryAfter: raw } = classifyFailure(value);
  let provider = 0;
  if (typeof raw === "string") {
    const header = raw.trim();
    if (/^\d+$/.test(header)) provider = Number(header);
    else if (
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
        header,
      )
    ) {
      const date = Date.parse(header);
      if (Number.isFinite(date)) provider = Math.max(0, (date - now) / 1000);
    }
  }
  const last = previous?.lastSuccessfulSequence ?? null;
  if (kind === "authorization" || kind === "validation")
    return stageStatus("failed", sequence, last, attempts, kind);
  if (provider > 900)
    return stageStatus(
      "retry-delay-unsupported",
      sequence,
      last,
      attempts,
      kind,
    );
  if (attempts >= 4) return stageStatus("exhausted", sequence, last, 4, kind);
  const delay = Math.ceil(
    Math.max(
      provider,
      ([5, 15, 45][attempts - 1] ?? 45) * (0.8 + random * 0.4),
    ),
  );
  return stageStatus(
    "retrying",
    sequence,
    last,
    attempts,
    kind,
    new Date(now + delay * 1000).toISOString(),
  );
}
export function nativeRetry(status: StageStatus, now: number) {
  if (status.state !== "retrying" || !status.nextAttemptAt) return undefined;
  return new InvocationError({
    retryAfter: Math.min(
      900,
      Math.max(1, Math.ceil((Date.parse(status.nextAttemptAt) - now) / 1000)),
    ),
    retryReason:
      status.lastFailure === "rate-limited"
        ? InvocationErrorCode.FUNCTION_UPSTREAM_RATE_LIMITED
        : InvocationErrorCode.FUNCTION_RETRY_REQUEST,
    retryData: { stageState: "retrying" },
  });
}
