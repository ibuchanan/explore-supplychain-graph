import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";

// App-local draft-07 generation preserves the approved numeric sequence schema.
export function generateContract(document, source) {
  const header = `// Generated from ${source}; do not edit.\n`;
  const ajv = new Ajv({ code: { source: true, esm: true }, strict: true });
  const schemas = document.components?.schemas ?? {};
  function type(schema) {
    if (schema.$ref) {
      const name = schema.$ref.replace("#/components/schemas/", "");
      if (!schemas[name]) throw new Error(`Unknown schema: ${schema.$ref}`);
      return type(schemas[name]);
    }
    if (schema.enum)
      return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
    switch (schema.type) {
      case "string":
        return "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "array":
        return `Array<${type(schema.items)}>`;
      case "object":
        return `{ ${Object.entries(schema.properties ?? {})
          .map(
            ([key, value]) =>
              `${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${type(value)}`,
          )
          .join("; ")} }`;
      default:
        throw new Error(`Unsupported schema type: ${schema.type}`);
    }
  }
  const inputs = {};
  const outputs = {};
  const commands = [];
  const policies = {};
  document.methods.forEach((method, index) => {
    if (method.paramStructure !== "by-name")
      throw new Error("Named params required");
    const params = {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        method.params.map((p) => [p.name, p.schema]),
      ),
      required: method.params.filter((p) => p.required).map((p) => p.name),
    };
    for (const [suffix, schema, map] of [
      ["input", params, inputs],
      ["output", method.result.schema, outputs],
    ]) {
      const id = `urn:workdown:command:${index}:${suffix}`;
      // Local component references become draft-07 definitions for Ajv standalone.
      const resolve = (value) => {
        if (Array.isArray(value)) return value.map(resolve);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            k === "$ref"
              ? v.replace("#/components/schemas/", "#/definitions/")
              : resolve(v),
          ]),
        );
      };
      ajv.removeSchema(id);
      ajv.addSchema(resolve({ ...schema, $id: id, definitions: schemas }));
      map[method.name] = id;
    }
    commands.push(
      `${JSON.stringify(method.name)}: { params: ${type(params)}; result: ${type(method.result.schema)} };`,
    );
    const policy = method["x-forge-ahead"];
    if (
      !policy ||
      typeof policy.web !== "boolean" ||
      !["asUser", "asApp"].includes(policy.execution) ||
      !["standard", "critical"].includes(policy.audit)
    )
      throw new Error(`Unsupported policy: ${method.name}`);
    policies[method.name] = policy;
  });
  const exports = {};
  for (const [i, name] of Object.keys(inputs).entries()) {
    exports[`input${i}`] = inputs[name];
    exports[`output${i}`] = outputs[name];
  }
  // Ajv emits CommonJS helper loads even with esm:true. Static imports let
  // Forge bundle those helpers; normalize Node/webpack CommonJS interop.
  const helpers = new Map();
  const body = standaloneCode(ajv, exports).replace(
    /require\("(ajv\/dist\/runtime\/[^\"]+)"\)\.default/g,
    (_, path) => {
      if (!helpers.has(path)) helpers.set(path, `helper${helpers.size}`);
      return helpers.get(path);
    },
  );
  const imports = [...helpers]
    .map(
      ([path, name]) =>
        `import ${name}Module from "${path}.js";\nconst ${name} = ${name}Module.default ?? ${name}Module;\n`,
    )
    .join("");
  const code = imports + body;
  const mapCode = (kind) =>
    `{ ${Object.keys(inputs)
      .map((name, i) => `${JSON.stringify(name)}: ${kind}${i}`)
      .join(", ")} }`;
  return {
    contract: `${header}import type { Result } from "@forge-ahead/errors";\nexport interface Commands {\n${commands.join("\n")}\n}\nexport type HandlerMap<Context, Failure> = { [M in keyof Commands]: (params: Commands[M]["params"], context: Context) => Promise<Result<Commands[M]["result"], Failure>> };\nexport type Caller = <M extends keyof Commands>(method: M, params: Commands[M]["params"]) => Promise<Commands[M]["result"]>;\n`,
    policy: `${header}export const webPolicy = ${JSON.stringify(policies, null, 2)} as const;\n`,
    validators: `${header}${code}\nexport const inputValidators = ${mapCode("input")};\nexport const outputValidators = ${mapCode("output")};\n`,
    declarations: `${header}import type { Commands } from "./contract";\ntype Validate<T> = (value: unknown) => value is T;\nexport const inputValidators: { [M in keyof Commands]: Validate<Commands[M]["params"]> };\nexport const outputValidators: { [M in keyof Commands]: Validate<Commands[M]["result"]> };\n`,
  };
}
