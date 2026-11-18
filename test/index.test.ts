import { afterEach, describe, expect, it, vi } from "vitest";
import document from "../src/openrpc.json";

afterEach(() => vi.unstubAllGlobals());

import { runAsync, runSync } from "../src/index";

const context = {
  installContext: "ari:cloud:jira::site/00000000-0000-4000-8000-000000000001",
};

describe.each([runSync, runAsync])("authenticated webtrigger", (handler) => {
  it("rejects non-POST transport requests", async () => {
    const response = await handler({ method: "GET" }, context);
    expect(response.statusCode).toBe(405);
  });

  it.each([true, false])(
    "admits discovery only for Jira administrators (%s)",
    async (admin) => {
      vi.stubGlobal("fetch", async (url: string) => {
        if (url.endsWith("/myself"))
          return Response.json({
            accountId: "test-user",
            active: true,
            accountType: "atlassian",
          });
        if (url.includes("/mypermissions?"))
          return Response.json({
            permissions: { ADMINISTER: { havePermission: admin } },
          });
        throw new Error("Unexpected Jira request");
      });
      const response = await handler(
        {
          method: "POST",
          headers: {
            "Content-Type": ["application/json"],
            Authorization: ["Basic dGVzdDpmYWtl"],
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "rpc.discover",
            params: {},
          }),
        },
        context,
      );
      expect(response.statusCode).toBe(admin ? 200 : 403);
      if (admin)
        expect(JSON.parse(response.body).result).toEqual({
          ...document,
          methods: document.methods.map(
            ({ "x-forge-ahead": _policy, examples: _examples, ...method }) =>
              method,
          ),
        });
    },
  );

  it.each([401, 403, 429, 500])(
    "fails closed when Jira identity returns %s",
    async (status) => {
      vi.stubGlobal("fetch", async () => Response.json({}, { status }));
      const response = await handler(
        {
          method: "POST",
          headers: {
            "Content-Type": ["application/json"],
            Authorization: ["Basic dGVzdDpmYWtl"],
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "rpc.discover",
            params: {},
          }),
        },
        context,
      );
      expect(response.statusCode).toBe(
        status === 401 ? 401 : status === 403 ? 403 : 503,
      );
      expect(response.body).not.toContain("workdown.export");
    },
  );
  it("does not accept installation identity from the HTTP request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await handler(
      {
        method: "POST",
        headers: {
          "Content-Type": ["application/json"],
          Authorization: ["Basic dGVzdDpmYWtl"],
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "rpc.discover",
          params: {},
        }),
      },
      {},
    );
    expect(response.statusCode).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects discovery without credentials", async () => {
    const response = await handler(
      {
        method: "POST",
        headers: { "Content-Type": ["application/json"] },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "rpc.discover",
          params: {},
        }),
      },
      context,
    );
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("workdown.export");
  });
});
