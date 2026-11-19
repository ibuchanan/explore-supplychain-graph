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

it.skip.each([
  ["readableSecuredEpic", -32005],
  ["unreadableEpic", -32001],
] as const)(
  "rejects %s without a document (deferred: independently verified Epic fixture unavailable)",
  async (alias, errorCode) => {
    const issue = scenarios.issues[alias];
    if (!issue)
      throw new Error(
        "Configure the independently verified Epic scenario before enabling this test",
      );
    expect(issue.expected).toEqual({ errorCode });
    const response = await call(
      "workdown.export",
      { profile: "jira-epic", issue: issue.key },
      true,
      errorCode,
    );
    expect(response.status).toBe(200);
    expect(response.errorCode).toBe(errorCode);
    expect(response).not.toHaveProperty("result");
  },
);

it("authenticates discovery through the deployed Forge webtrigger", async () => {
  expect((await call("rpc.discover", {}, false)).status).toBe(401);
  const discovery = await call("rpc.discover", {});
  expect(discovery.status).toBe(200);
  expect(validateOpenRpc(discovery.result)).toBe(true);
  const expected = {
    ...contract,
    methods: contract.methods.map(
      ({ "x-forge-ahead": _policy, examples: _examples, ...method }) => method,
    ),
  };
  // Boolean assertions avoid dumping private response content on failure.
  expect(isDeepStrictEqual(discovery.result, expected)).toBe(true);
}, 45_000);

for (const [alias, issue] of Object.entries(scenarios.issues)) {
  if (!("errorCode" in issue.expected)) {
    const expectedDescription = issue.expected.description;
    it(`starts ${alias} concurrently and reads its retained development loopback document`, async () => {
      const params = {
        connection: "development-loopback",
        profile: "jira-epic",
        issue: issue.key,
      };
      expect((await call("exchange.start", params, false)).status).toBe(401);
      const responses = await Promise.all([
        call("exchange.start", params),
        call("exchange.start", params),
      ]);
      const values = responses.map(
        (response) =>
          response.result as {
            connection: string;
            loopback: boolean;
            document: string;
            updateSequenceNumber: number;
          },
      );
      for (const value of values) {
        expect(
          value.connection === params.connection && value.loopback === true,
        ).toBe(true);
        expect(
          Number.isSafeInteger(value.updateSequenceNumber) &&
            value.updateSequenceNumber > 0,
        ).toBe(true);
      }
      expect(values[0]?.document === values[1]?.document).toBe(true);
      expect(
        values[0]?.updateSequenceNumber === values[1]?.updateSequenceNumber,
      ).toBe(true);
      const first = values[0];
      if (!first) throw new Error("Missing start acknowledgment");
      expect(
        (
          await call(
            "document.get",
            { connection: params.connection, document: first.document },
            false,
          )
        ).status,
      ).toBe(401);
      const response = await call("document.get", {
        connection: params.connection,
        document: first.document,
      });
      const retained = response.result as typeof first & { workdown: string };
      expect(
        retained.document === first.document && retained.loopback === true,
      ).toBe(true);
      expect(retained.updateSequenceNumber >= first.updateSequenceNumber).toBe(
        true,
      );
      expect(validateWorkdown(retained.workdown)).toBe(true);
      expect(
        retained.workdown.includes(`## Description\n\n${expectedDescription}`),
      ).toBe(true);
      const statusParams = {
        connection: params.connection,
        document: first.document,
      };
      expect(
        (await call("publication.status", statusParams, false)).status,
      ).toBe(401);
      const status = await call("publication.status", statusParams);
      expect(status.result).toMatchObject({
        ...statusParams,
        loopback: true,
        retainedSequence: retained.updateSequenceNumber,
      });
      const published = (status.result as { publishedSequence: number | null })
        .publishedSequence;
      expect(
        published === null ||
          (Number.isSafeInteger(published) &&
            published > 0 &&
            published <= retained.updateSequenceNumber),
      ).toBe(true);
      const repeated = await call("exchange.start", params);
      expect(
        (repeated.result as typeof first).updateSequenceNumber ===
          retained.updateSequenceNumber,
      ).toBe(true);
    }, 90_000);
  }
  it(`exports ${alias} (${issue.projectType}) through the deployed Forge webtrigger`, async () => {
    const expectedError =
      "errorCode" in issue.expected ? issue.expected.errorCode : undefined;
    const response = await call(
      "workdown.export",
      {
        profile: "jira-epic",
        issue: issue.key,
      },
      true,
      expectedError,
    );
    if ("errorCode" in issue.expected) {
      expect(response.status).toBe(200);
      expect(response.errorCode).toBe(issue.expected.errorCode);
      expect(response).not.toHaveProperty("result");
      return;
    }
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
      "children",
    ]);
    expect(
      Object.keys(metadata).every((key) => allowed.has(key)),
      "metadata stays within allowlist",
    ).toBe(true);
    const children = metadata["children"] as { key: string }[] | undefined;
    expect(
      isDeepStrictEqual(
        (children ?? []).map((child) => child.key),
        issue.expected.children,
      ),
      "children match independent scenario in native-ID lexical order",
    ).toBe(true);
    expect(Object.hasOwn(metadata, "parent"), "Epic omits parent").toBe(false);
    const document = response.result as string;
    const description = document.slice(
      document.indexOf("\n## Description\n\n") + "\n## Description\n\n".length,
    );
    const childTable = children?.length
      ? description.lastIndexOf("\n\n## Children\n\n")
      : -1;
    const actualDescription =
      childTable < 0
        ? description.slice(0, -1)
        : description.slice(0, childTable);
    expect(
      actualDescription === issue.expected.description,
      "description matches independent scenario",
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
