import { describe, expect, it } from "vitest";
import contract from "../src/openrpc.json";

const document = {
  ...contract,
  methods: contract.methods.map(
    ({ "x-forge-ahead": _policy, ...method }) => method,
  ),
};

import { dispatch as dispatchCommand } from "../src/rpc";

const dispatch = (request: unknown) =>
  dispatchCommand(request, {
    installation: {
      cloudId: "00000000-0000-4000-8000-000000000001",
      apiBase:
        "https://api.atlassian.com/ex/jira/00000000-0000-4000-8000-000000000001",
    },
    principal: { accountId: "reader", authorization: "Basic dGVzdDpmYWtl" },
  });

import { validateOpenRpc } from "./openrpc";

describe("discovery dispatcher", () => {
  it("serves a document valid against the standard OpenRPC meta-schema", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "rpc.discover",
      params: {},
    });
    expect("result" in response).toBe(true);
    if (!("result" in response)) throw new Error("Discovery failed");
    expect(
      validateOpenRpc(response.result),
      JSON.stringify(validateOpenRpc.errors),
    ).toBe(true);
    expect(response.result).toEqual(document);
  });

  it("rejects unexpected discovery parameters", async () => {
    await expect(
      dispatch({
        jsonrpc: "2.0",
        id: 4,
        method: "rpc.discover",
        params: { accountId: "untrusted" },
      }),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32602, message: "Invalid params" },
    });
  });

  it("returns parse-error for invalid JSON", async () => {
    await expect(dispatch("{")).resolves.toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("returns method-not-found for an unknown method", async () => {
    await expect(
      dispatch({
        jsonrpc: "2.0",
        id: 2,
        method: "nonexistent.method",
        params: {},
      }),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 2,
      error: { code: -32601, message: "Method not found" },
    });
  });

  it("returns invalid-request for a malformed request", async () => {
    await expect(
      dispatch({ jsonrpc: "1.0", id: 3, method: "rpc.discover", params: {} }),
    ).resolves.toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32600, message: "Invalid request" },
    });
  });
  it("serves the application contract, which does not list discovery itself", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: "discovery",
      method: "rpc.discover",
      params: {},
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "discovery",
      result: document,
    });
    expect(document.methods.map((method) => method.name)).toEqual([
      "workdown.export",
    ]);
  });
});
