import { expect, it } from "vitest";
import document from "../src/openrpc.json";
import { validateOpenRpc } from "./openrpc";

it("discovers the contract through the deployed Forge webtrigger", async () => {
  const url = process.env["WORKDOWN_RPC_URL"];
  if (!url)
    throw new Error(
      "Set WORKDOWN_RPC_URL to the approved installation's webtrigger URL",
    );
  if (new URL(url).protocol !== "https:")
    throw new Error("WORKDOWN_RPC_URL must use HTTPS");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cloud-discovery",
      method: "rpc.discover",
      params: {},
    }),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });

  expect(response.status).toBe(200);
  const envelope = await response.json();
  expect(envelope).toEqual({
    jsonrpc: "2.0",
    id: "cloud-discovery",
    result: document,
  });
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("result" in envelope)
  ) {
    throw new Error("Discovery response has no result");
  }
  expect(
    validateOpenRpc(envelope.result),
    JSON.stringify(validateOpenRpc.errors),
  ).toBe(true);
}, 25_000);
