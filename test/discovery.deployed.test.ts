import { expect, it } from "vitest";
import contract from "../src/openrpc.json";
import { validateWorkdown } from "../src/workdown-validation";
import { validateOpenRpc } from "./openrpc";

const required = (name: string) => {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Set ${name} through SecretSpec before running deployed tests`,
    );
  return value;
};

it("authenticates discovery and exports a real Epic through the deployed Forge webtrigger", async () => {
  const url = required("WORKDOWN_RPC_URL");
  if (new URL(url).protocol !== "https:")
    throw new Error("WORKDOWN_RPC_URL must use HTTPS");
  const authorization = `Basic ${Buffer.from(`${required("WORKDOWN_TEST_EMAIL")}:${required("WORKDOWN_TEST_API_TOKEN")}`).toString("base64")}`;
  const issue = required("WORKDOWN_TEST_ISSUE");
  const call = (method: string, params: unknown, authenticated = true) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "cloud", method, params }),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  expect((await call("rpc.discover", {}, false)).status).toBe(401);
  const discovery = await call("rpc.discover", {});
  expect(discovery.status).toBe(200);
  const envelope = (await discovery.json()) as { result?: unknown };
  expect(validateOpenRpc(envelope.result)).toBe(true);
  expect(envelope.result).toEqual({
    ...contract,
    methods: contract.methods.map(
      ({ "x-forge-ahead": _policy, ...method }) => method,
    ),
  });
  const response = await call("workdown.export", {
    profile: "jira-epic",
    issue,
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { result?: unknown };
  // Boolean assertions avoid printing customer documents or credentials on failure.
  expect(validateWorkdown(result.result)).toBe(true);
}, 65_000);
