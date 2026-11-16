import { describe, expect, it } from "vitest";
import { runAsync, runSync } from "../src/index";
import document from "../src/openrpc.json";

describe.each([runSync, runAsync])("discovery webtrigger", (handler) => {
  it("rejects non-POST transport requests", async () => {
    const response = await handler({ method: "GET" });
    expect(response.statusCode).toBe(405);
  });

  it("serves discovery as a JSON-RPC HTTP response", async () => {
    const response = await handler({
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "http",
        method: "rpc.discover",
        params: {},
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["Content-Type"]).toEqual(["application/json"]);
    expect(JSON.parse(response.body)).toEqual({
      jsonrpc: "2.0",
      id: "http",
      result: document,
    });
  });
});
