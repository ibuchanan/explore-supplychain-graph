import { isDeepStrictEqual } from "node:util";
import { expect, it } from "vitest";
import { parse } from "yaml";
import contract from "../src/openrpc.json";
import { validateWorkdown } from "../src/workdown-validation";
import { createDeployedRpc, loadDeployedScenarios } from "./deployed-harness";
import { validateOpenRpc } from "./openrpc";

// Validate every scenario before any network request; never silently skip expectations.
const scenarios = loadDeployedScenarios();
const call = createDeployedRpc();

it("authenticates discovery through the deployed Forge webtrigger", async () => {
  expect((await call("rpc.discover", {}, false)).status).toBe(401);
  const discovery = await call("rpc.discover", {});
  expect(discovery.status).toBe(200);
  expect(validateOpenRpc(discovery.result)).toBe(true);
  const expected = {
    ...contract,
    methods: contract.methods.map(
      ({ "x-forge-ahead": _policy, ...method }) => method,
    ),
  };
  // Boolean assertions avoid dumping private response content on failure.
  expect(isDeepStrictEqual(discovery.result, expected)).toBe(true);
}, 45_000);

for (const [alias, issue] of Object.entries(scenarios.issues)) {
  it(`exports ${alias} (${issue.projectType}) through the deployed Forge webtrigger`, async () => {
    const response = await call("workdown.export", {
      profile: "jira-epic",
      issue: issue.key,
    });
    expect(response.status).toBe(200);
    expect(validateWorkdown(response.result)).toBe(true);
    const metadata = parse(
      (response.result as string).split("---\n")[1] ?? "",
    ) as Record<string, unknown>;
    expect(Object.hasOwn(metadata, "key"), "key is present").toBe(true);
    expect(metadata["key"] === issue.key, "key matches scenario").toBe(true);
    const allowed = new Set([
      "format",
      "format_version",
      "type",
      "source_id",
      "title",
      "resource",
      "work_type",
      "key",
      "work_status",
      "resolution",
      "priority",
      "tags",
      "created_at",
      "updated_at",
      "start_date",
      "due_date",
      "generated",
      "sources",
    ]);
    expect(
      Object.keys(metadata).every((key) => allowed.has(key)),
      "metadata stays within allowlist",
    ).toBe(true);
    const expected = issue.expected.start_date;
    expect(
      expected === null
        ? !Object.hasOwn(metadata, "start_date")
        : metadata["start_date"] === expected,
      "start_date matches scenario (null requires omission)",
    ).toBe(true);
  }, 25_000);
}
