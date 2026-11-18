import { readFileSync } from "node:fs";
import { err } from "@forge-ahead/errors";
import { createDispatcher } from "@forge-ahead/rpc";
import { generateContract } from "@forge-ahead/rpc/generator";
import { describe, expect, it } from "vitest";
import { commandErrors } from "../src/command-errors";
import commands from "../src/openrpc.json";
import { validateWorkdown } from "../src/workdown-validation";
import { validateOpenRpc } from "./openrpc";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/workdown-export/${name}.workdown`, import.meta.url),
    "utf8",
  );

describe("application Command contract", () => {
  it("is a valid OpenRPC document", () => {
    expect(
      validateOpenRpc(commands),
      JSON.stringify(validateOpenRpc.errors),
    ).toBe(true);
  });

  it("provides a valid rich-description Workdown example", () => {
    const example = commands.methods[0]?.examples[0]?.result.value;
    expect(validateWorkdown(example)).toBe(true);
    expect(example).toContain("\n## Description\n\n**Acceptance criteria**");
    expect(example).toContain("[media omitted]");
  });

  it("does not declare the reserved discovery method", () => {
    expect(commands.methods.map((method) => method.name)).toEqual([
      "workdown.export",
    ]);
  });

  it("is accepted by the contract generator with the reviewed web policy", () => {
    const { policy } = generateContract(commands, "src/openrpc.json");
    expect(policy).toContain("workdown.export");
    expect(policy).toContain("asUser");
    expect(policy).toContain("standard");
  });
});

describe("application error catalog", () => {
  it.each([
    ["profile-mismatch", -32002, "Profile mismatch"],
    ["field-unresolved", -32003, "Field unresolved"],
    ["field-unreadable", -32004, "Field unreadable"],
  ] as const)(
    "maps %s to its public JSON-RPC error",
    async (name, code, message) => {
      const dispatch = createDispatcher<undefined>({
        handlers: { "workdown.export": async () => err(name) },
        errorCatalog: commandErrors,
        inputValidators: { "workdown.export": () => true },
        outputValidators: { "workdown.export": () => true },
      });

      await expect(
        dispatch(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "workdown.export",
            params: { profile: "jira-epic", issue: "DEMO-1" },
          },
          undefined,
        ),
      ).resolves.toEqual({
        jsonrpc: "2.0",
        id: 1,
        error: { code, message },
      });
    },
  );
});

describe("workdown.export golden fixtures", () => {
  it.each(["epic-empty-description", "epic-plain-description"])(
    "%s is LF-only, BOM-free, and ends with exactly one newline",
    (name) => {
      const text = fixture(name);
      expect(text.startsWith("---\n")).toBe(true);
      expect(text).not.toContain("\r");
      expect(text.charCodeAt(0)).not.toBe(0xfeff);
      expect(text.endsWith("\n")).toBe(true);
      expect(text.endsWith("\n\n")).toBe(false);
    },
  );

  it("uses the specified empty-description paragraph", () => {
    expect(fixture("epic-empty-description")).toContain(
      "\n## Description\n\nNo description provided.\n",
    );
  });
});
