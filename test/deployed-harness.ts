import { readFileSync } from "node:fs";
import Ajv from "ajv";

export interface DeployedScenarios {
  issues: Record<
    string,
    {
      key: string;
      projectType: "company-managed" | "team-managed";
      expected:
        | { start_date: string | null; children: string[]; description: string }
        | { errorCode: -32001 | -32005 | -32006 };
    }
  >;
}

const validScenarios = new Ajv().compile<DeployedScenarios>({
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "object",
      minProperties: 1,
      propertyNames: { pattern: "^[a-zA-Z][a-zA-Z0-9_-]*$" },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        required: ["key", "projectType", "expected"],
        properties: {
          key: { type: "string", pattern: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$" },
          projectType: { enum: ["company-managed", "team-managed"] },
          expected: {
            type: "object",
            additionalProperties: false,
            oneOf: [
              {
                required: ["start_date", "children", "description"],
                not: { required: ["errorCode"] },
              },
              {
                required: ["errorCode"],
                not: {
                  anyOf: [
                    { required: ["start_date"] },
                    { required: ["children"] },
                    { required: ["description"] },
                  ],
                },
              },
            ],
            properties: {
              description: {
                type: "string",
                minLength: 1,
                pattern: "^[^\\r]+$",
              },
              children: {
                type: "array",
                uniqueItems: true,
                items: {
                  type: "string",
                  pattern: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$",
                },
              },
              errorCode: { enum: [-32001, -32005, -32006] },
              start_date: {
                anyOf: [
                  { type: "null" },
                  { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
                ],
              },
            },
          },
        },
      },
    },
  },
});

export function parseDeployedScenarios(text: string): DeployedScenarios {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "Deployed scenarios must be valid JSON; content suppressed",
    );
  }
  if (!validScenarios(value))
    throw new Error(
      "Invalid deployed scenarios: require named issues with key, projectType, and expected.start_date (date or null) plus ordered expected.children and nonempty LF-only expected.description, or expected.errorCode (-32001, -32005, -32006); content suppressed",
    );
  for (const issue of Object.values(value.issues)) {
    if (!("start_date" in issue.expected)) continue;
    const date = issue.expected.start_date;
    if (date !== null) {
      const parsed = new Date(`${date}T00:00:00.000Z`);
      if (
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date
      )
        throw new Error(
          "Invalid expected.start_date calendar date; content suppressed",
        );
    }
  }
  return value;
}

export function loadDeployedScenarios(): DeployedScenarios {
  let text: string;
  try {
    text = readFileSync(
      new URL("./deployed.local.json", import.meta.url),
      "utf8",
    );
  } catch {
    throw new Error(
      "Cannot read test/deployed.local.json; copy test/deployed.example.json and populate independent expectations",
    );
  }
  return parseDeployedScenarios(text);
}

export function createDeployedRpc(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
) {
  const required = (name: string) => {
    const value = env[name];
    if (!value)
      throw new Error(
        `Set ${name} through SecretSpec before running deployed tests`,
      );
    return value;
  };
  const url = required("WORKDOWN_RPC_URL");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error();
  } catch {
    throw new Error(
      "WORKDOWN_RPC_URL must be an HTTPS URL without embedded credentials",
    );
  }
  const authorization = `Basic ${Buffer.from(`${required("WORKDOWN_TEST_EMAIL")}:${required("WORKDOWN_TEST_API_TOKEN")}`).toString("base64")}`;
  return async (
    method: string,
    params: unknown,
    authenticated = true,
    expectedErrorCode?: number,
  ) => {
    let response: Response;
    try {
      response = await request(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authenticated ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "cloud", method, params }),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "Deployed RPC request failed; connection details suppressed",
      );
    }
    if (response.status !== 200)
      return { status: response.status, result: undefined };
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new Error("Invalid deployed RPC JSON; response content suppressed");
    }
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("jsonrpc" in envelope) ||
      envelope.jsonrpc !== "2.0" ||
      !("id" in envelope) ||
      envelope.id !== "cloud"
    )
      throw new Error(
        "Invalid deployed RPC envelope; response content suppressed",
      );
    if ("error" in envelope) {
      const error = envelope.error;
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
          ? error.code
          : "unknown";
      if (code === expectedErrorCode && !("result" in envelope))
        return { status: response.status, errorCode: code };
      throw new Error(
        `Deployed RPC failed with JSON-RPC code ${code}; response content suppressed`,
      );
    }
    if (expectedErrorCode !== undefined)
      throw new Error(
        "Expected RPC failure but received success; response content suppressed",
      );
    if (!("result" in envelope))
      throw new Error(
        "Missing deployed RPC result; response content suppressed",
      );
    return { status: response.status, result: envelope.result };
  };
}
