import { afterEach, expect, it, vi } from "vitest";
import "./audit-runtime";
import { runAsync, runSync } from "../src/index";

const context = {
  installContext: "ari:cloud:jira::site/00000000-0000-4000-8000-000000000001",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("logs bounded failure metadata without request content and isolates invocation context", async () => {
  const output = vi.spyOn(console, "info").mockImplementation(() => {});
  const secret = "private-request-content";
  const responses = await Promise.all(
    [runSync, runAsync].map((handler) =>
      handler(
        {
          method: "POST",
          headers: {
            "Content-Type": ["application/json"],
            Authorization: [`Basic ${secret}`],
          },
          body: secret,
          queryParameters: { private: [secret] },
        },
        context,
      ),
    ),
  );
  expect(responses.map((response) => response.statusCode)).toEqual([400, 400]);
  const records = output.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(records).toHaveLength(2);
  for (const record of records) {
    expect(record).toMatchObject({
      name: "workdown",
      operation: "webtrigger",
      eventType: "webtrigger",
      msg: "workdown.rpc.completed",
      statusCode: 400,
      outcome: "failure",
      durationMs: expect.any(Number),
      requestId: expect.any(String),
    });
    expect(Object.keys(record).sort()).toEqual(
      [
        "durationMs",
        "eventType",
        "kind",
        "level",
        "msg",
        "name",
        "operation",
        "outcome",
        "requestId",
        "statusCode",
        "time",
      ].sort(),
    );
  }
  expect(records[0].requestId).not.toBe(records[1].requestId);
  expect(JSON.stringify(records)).not.toContain(secret);
});

it("distinguishes successful JSON-RPC responses from errors over HTTP 200", async () => {
  const output = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("/myself")
      ? Response.json({
          accountId: "private-account",
          active: true,
          accountType: "atlassian",
        })
      : Response.json({
          permissions: { ADMINISTER: { havePermission: true } },
        }),
  );
  for (const method of ["rpc.discover", "private-unknown-method"]) {
    const response = await runSync(
      {
        method: "POST",
        headers: {
          "Content-Type": ["application/json"],
          Authorization: ["Basic dGVzdDpmYWtl"],
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "private-id",
          method,
          params: {},
        }),
      },
      context,
    );
    expect(response.statusCode).toBe(200);
  }
  const records = output.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(records[0]).toMatchObject({ outcome: "success", statusCode: 200 });
  expect(records[1]).toMatchObject({
    outcome: "failure",
    statusCode: 200,
    rpcErrorCode: -32601,
  });
  for (const value of [
    "private-account",
    "private-id",
    "private-unknown-method",
    "dGVzdDpmYWtl",
    "openrpc",
  ])
    expect(JSON.stringify(records)).not.toContain(value);
});
