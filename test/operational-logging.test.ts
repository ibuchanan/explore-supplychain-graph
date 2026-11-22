import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  persisted: [] as { kind: string; event: Record<string, unknown> }[],
  identity: {
    installationId: "test-installation",
    environment: "test-environment",
  },
}));

vi.mock("../src/log-events", () => ({
  runtimeIdentity: () => state.identity,
  persistEvent: async (kind: string, event: Record<string, unknown>) => {
    state.persisted.push({ kind, event: structuredClone(event) });
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  state.persisted.length = 0;
});

it("captures approved publication logs to operational storage while preserving console severity", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { logger, withOperationalLogs } = await import("../src/logging");

  await withOperationalLogs(async () => {
    logger.info(
      { stage: "ingestion", outcome: "succeeded", secret: "drop-me" },
      "workdown.publication.summary",
    );
    logger.warn(
      { stage: "notification", outcome: "failed", detail: "drop-me" },
      "workdown.publication.summary",
    );
  });

  expect(info).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(state.persisted).toHaveLength(2);
  expect(state.persisted.map(({ kind }) => kind)).toEqual([
    "operational",
    "operational",
  ]);
  expect(state.persisted.map(({ event }) => event["data"])).toEqual([
    {
      installationId: "test-installation",
      environment: "test-environment",
      level: "info",
      event: "workdown.publication.summary",
      stage: "ingestion",
      outcome: "succeeded",
    },
    {
      installationId: "test-installation",
      environment: "test-environment",
      level: "warn",
      event: "workdown.publication.summary",
      stage: "notification",
      outcome: "failed",
    },
  ]);
  for (const { event } of state.persisted) {
    expect(event).toMatchObject({
      specversion: "1.0",
      source: "urn:workdown:operational",
      id: expect.any(String),
      time: expect.any(String),
    });
    expect(String(event["type"])).toMatch(/^com\.workdown\.log\.(info|warn)$/);
  }
  expect(JSON.stringify(state.persisted)).not.toContain("drop-me");
});

it("caps capture at five events, drops unknown records, and isolates invocations", async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const { logger, withOperationalLogs } = await import("../src/logging");
  await withOperationalLogs(async () => {
    logger.info({ stage: "ingestion", outcome: "succeeded" }, "unapproved");
    for (let i = 0; i < 9; i++)
      logger.info(
        { stage: "ingestion", outcome: "succeeded" },
        "workdown.publication.summary",
      );
  });
  expect(state.persisted).toHaveLength(5);
  await withOperationalLogs(async () => {});
  expect(state.persisted).toHaveLength(5);
});

it("flushes partial failures once and returns the business result at the elapsed budget", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "info").mockImplementation(() => {});
  const events = await import("../src/log-events");
  const write = vi
    .spyOn(events, "persistEvent")
    .mockRejectedValueOnce(Error("private"))
    .mockImplementationOnce(() => new Promise(() => {}));
  const { logger, withOperationalLogs } = await import("../src/logging");
  const work = withOperationalLogs(async () => {
    for (let i = 0; i < 2; i++)
      logger.info(
        { stage: "ingestion", outcome: "succeeded" },
        "workdown.publication.summary",
      );
    return "business-result";
  });
  await vi.advanceTimersByTimeAsync(250);
  expect(await work).toBe("business-result");
  expect(write).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
