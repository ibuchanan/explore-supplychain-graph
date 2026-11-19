import { readFileSync } from "node:fs";
import { err } from "@forge-ahead/errors";
import { createDispatcher } from "@forge-ahead/rpc";
import { describe, expect, it } from "vitest";
import { generateContract } from "../scripts/command-contract.mjs";
import { commandErrors } from "../src/command-errors";
import {
  inputValidators,
  outputValidators,
} from "../src/generated/validators.js";
import commands from "../src/openrpc.json";
import { validateWorkdown } from "../src/workdown-validation";
import { validateOpenRpc } from "./openrpc";

const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/workdown-export/${name}.workdown`, import.meta.url),
    "utf8",
  );

describe("application Command contract", () => {
  it("declares generated validator helpers as production dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const validators = readFileSync(
      new URL("../src/generated/validators.js", import.meta.url),
      "utf8",
    );
    for (const [, specifier] of validators.matchAll(/require\("([^"]+)"\)/g)) {
      const dependency = specifier?.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : specifier?.split("/")[0];
      expect(manifest.dependencies).toHaveProperty(dependency as string);
    }
  });
  it("validates every approved example and rejects non-safe-integer output sequences", () => {
    for (const method of commands.methods) {
      const name = method.name as keyof typeof inputValidators;
      for (const example of method.examples) {
        expect(
          inputValidators[name](
            Object.fromEntries(
              example.params.map((param) => [param.name, param.value]),
            ),
          ),
        ).toBe(true);
        expect(outputValidators[name](example.result.value)).toBe(true);
      }
    }
    const example = commands.methods[1]?.examples[0]?.result.value;
    for (const updateSequenceNumber of [
      0,
      -1,
      1.5,
      9007199254740992,
      "1",
      null,
    ])
      expect(
        outputValidators["exchange.start"]({
          ...(example as object),
          updateSequenceNumber,
        }),
      ).toBe(false);
  });
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
      "exchange.start",
      "document.get",
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
