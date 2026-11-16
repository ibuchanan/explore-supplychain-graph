import { describe, expect, it } from "vitest";
import document from "../src/openrpc.json";
import { dispatch } from "../src/rpc";
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
        method: "workdown.export",
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
  it("returns the discovery-only OpenRPC document", async () => {
    const response = await dispatch({
      jsonrpc: "2.0",
      id: "discovery",
      method: "rpc.discover",
      params: {},
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "discovery",
      result: {
        openrpc: "1.3.2",
        info: { title: "Explore Supplychain Graph", version: "0.1.0" },
        methods: [
          {
            name: "rpc.discover",
            summary: "Discover the app's OpenRPC contract",
            paramStructure: "by-name",
            params: [],
            result: { name: "OpenRPC document", schema: { type: "object" } },
          },
        ],
      },
    });
  });
});
