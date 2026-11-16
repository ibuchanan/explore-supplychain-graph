import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generateContract } from "@forge-ahead/rpc/generator";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

const artifacts = generateContract(
  JSON.parse(readFileSync("src/openrpc.json", "utf8")),
  "src/openrpc.json",
);
const ajv = new Ajv({ code: { source: true, esm: true } });
const schema = JSON.parse(
  readFileSync("src/workdown-frontmatter.schema.json", "utf8"),
);
const frontmatter = standaloneCode(ajv, {
  validateFrontmatter: ajv.addSchema(schema).getSchema(schema.$id).schema.$id,
});
const outputs = {
  "contract.ts": artifacts.contract,
  "validators.js": artifacts.validators,
  "validators.d.ts": artifacts.declarations,
  "policy.ts": artifacts.policy,
  "frontmatter.js": frontmatter,
  "frontmatter.d.ts":
    "export const validateFrontmatter: (value: unknown) => boolean;\n",
};
mkdirSync("src/generated", { recursive: true });
for (const [file, content] of Object.entries(outputs)) {
  const path = `src/generated/${file}`;
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content)
      throw new Error(`Contract drift: ${path}`);
  } else writeFileSync(path, content);
}
