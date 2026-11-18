import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createDeployedRpc, parseDeployedScenarios } from "./deployed-harness";

const scenario = (start_date: unknown = "2026-11-17") => ({
  issues: {
    epic: {
      key: "EXAMPLE-123",
      projectType: "company-managed",
      expected: { start_date },
    },
  },
});

it("loads named issue expectations including explicit omission", () => {
  for (const date of ["2026-11-17", null]) {
    const value = scenario(date);
    expect(parseDeployedScenarios(JSON.stringify(value))).toEqual(value);
  }
  expect(
    parseDeployedScenarios(
      readFileSync(new URL("./deployed.example.json", import.meta.url), "utf8"),
    ).issues,
  ).toHaveProperty("epicWithStartDate");
});

it.each([
  "private malformed input",
  JSON.stringify({ issues: {} }),
  JSON.stringify({
    issues: {
      epic: {
        key: "EXAMPLE-123",
        projectType: "company-managed",
        expected: {},
      },
    },
  }),
  JSON.stringify(scenario("2026-02-30")),
  JSON.stringify(scenario("not-a-date")),
  JSON.stringify({
    issues: { epic: { ...scenario().issues.epic, projectType: "unknown" } },
  }),
  JSON.stringify({ issues: { epic: { ...scenario().issues.epic, key: "" } } }),
  JSON.stringify({
    issues: {
      epic: {
        ...scenario().issues.epic,
        expected: { start_date: null, typo: "private" },
      },
    },
  }),
])(
  "rejects invalid configuration without exposing its contents (case %#)",
  (text) => {
    expect(() => parseDeployedScenarios(text)).toThrow(/content suppressed/);
  },
);

it("loads explicit eligibility failure expectations without a Start date", () => {
  const value = scenario();
  const text = JSON.stringify(value).replace(
    '"start_date":"2026-11-17"',
    '"errorCode":-32006',
  );
  expect(parseDeployedScenarios(text).issues["epic"]?.expected).toEqual({
    errorCode: -32006,
  });
});

const env = {
  WORKDOWN_RPC_URL: "https://example.invalid/private",
  WORKDOWN_TEST_EMAIL: "synthetic@example.invalid",
  WORKDOWN_TEST_API_TOKEN: "synthetic-token",
};
const response = (value: unknown) => new Response(JSON.stringify(value));
const envelope = { jsonrpc: "2.0", id: "cloud", result: { ok: true } };

describe("deployed RPC helper", () => {
  it("sends authenticated JSON-RPC without redirects and allows an unauthenticated probe", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(envelope));
    const call = createDeployedRpc(env, request);
    expect(await call("rpc.discover", {})).toEqual({
      status: 200,
      result: { ok: true },
    });
    const init = request.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toHaveProperty(
      "Authorization",
      `Basic ${Buffer.from(`${env.WORKDOWN_TEST_EMAIL}:${env.WORKDOWN_TEST_API_TOKEN}`).toString("base64")}`,
    );
    expect(JSON.parse(init?.body as string)).toEqual({
      jsonrpc: "2.0",
      id: "cloud",
      method: "rpc.discover",
      params: {},
    });
    await call("rpc.discover", {}, false);
    expect(request.mock.calls[1]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it("returns only the expected RPC error code and rejects accidental success", async () => {
    const call = createDeployedRpc(
      env,
      vi.fn<typeof fetch>().mockResolvedValue(
        response({
          jsonrpc: "2.0",
          id: "cloud",
          error: { code: -32006, message: "private" },
        }),
      ),
    );
    expect(await call("workdown.export", {}, true, -32006)).toEqual({
      status: 200,
      errorCode: -32006,
    });
    await expect(
      createDeployedRpc(
        env,
        vi.fn<typeof fetch>().mockResolvedValue(response(envelope)),
      )("workdown.export", {}, true, -32006),
    ).rejects.toThrow(/Expected RPC failure/);
  });
  it("requires connection credentials and HTTPS before making requests", () => {
    const request = vi.fn<typeof fetch>();
    expect(() => createDeployedRpc({}, request)).toThrow(/WORKDOWN_RPC_URL/);
    for (const url of [
      "http://example.invalid",
      "https://user:secret@example.invalid",
      "invalid-private-url",
    ])
      expect(() =>
        createDeployedRpc({ ...env, WORKDOWN_RPC_URL: url }, request),
      ).toThrow(/HTTPS/);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns HTTP status without exposing error bodies", async () => {
    const call = createDeployedRpc(
      env,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("private", { status: 401 })),
    );
    expect(await call("rpc.discover", {})).toEqual({
      status: 401,
      result: undefined,
    });
  });

  it.each([
    [
      "transport",
      () => Promise.reject(new Error("private token and URL")),
      /connection details suppressed/,
    ],
    [
      "invalid JSON",
      () => Promise.resolve(new Response("private malformed response")),
      /response content suppressed/,
    ],
    [
      "RPC failure",
      () =>
        Promise.resolve(
          response({
            ...envelope,
            error: { code: -32004, message: "private" },
          }),
        ),
      /code -32004; response content suppressed/,
    ],
    [
      "missing result",
      () => Promise.resolve(response({ jsonrpc: "2.0", id: "cloud" })),
      /response content suppressed/,
    ],
    [
      "wrong envelope",
      () => Promise.resolve(response({ ...envelope, id: "private" })),
      /response content suppressed/,
    ],
  ] as const)("sanitizes %s failures", async (_name, request, message) => {
    await expect(
      createDeployedRpc(env, request)("workdown.export", {
        issue: "EXAMPLE-123",
      }),
    ).rejects.toThrow(message);
  });
});
