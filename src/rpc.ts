import { ok } from "@forge-ahead/errors";
import { createDispatcher } from "@forge-ahead/rpc";
import document from "./openrpc.json";

const dispatcher = createDispatcher<undefined>({
  handlers: { "rpc.discover": async () => ok(document) },
  inputValidators: {
    "rpc.discover": (params) =>
      typeof params === "object" &&
      params !== null &&
      Object.keys(params).length === 0,
  },
  outputValidators: { "rpc.discover": (result) => result === document },
});

export const dispatch = (request: unknown) => dispatcher(request, undefined);
