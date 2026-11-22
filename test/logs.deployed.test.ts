import { expect, it } from "vitest";
import { outputValidators } from "../src/generated/validators.js";
import { createDeployedRpc } from "./deployed-harness";

const call = createDeployedRpc();
it("browses Custom Entity audit events through the installed governed Command", async () => {
  expect((await call("logs.list", { kind: "audit" }, false)).status).toBe(401);
  const from = new Date(Date.now() - 60_000).toISOString();
  await call("rpc.discover", {});
  let found = false;
  const deadline = Date.now() + 15_000;
  do {
    const page = await call("logs.list", { kind: "audit", from });
    expect(outputValidators["logs.list"](page.result)).toBe(true);
    if (outputValidators["logs.list"](page.result)) {
      found = page.result.events.some(
        (event) =>
          event.source === "urn:workdown:audit" &&
          event.type === "com.forge-ahead.rpc.authentication",
      );
    }
    if (!found) await new Promise((resolve) => setTimeout(resolve, 500));
  } while (!found && Date.now() < deadline);
  expect(found).toBe(true);
}, 45_000);
