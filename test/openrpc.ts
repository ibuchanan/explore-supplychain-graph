import { createRequire } from "node:module";
import Ajv, { type AnySchemaObject } from "ajv";

const require = createRequire(import.meta.url);
const {
  jsonSchema,
}: { jsonSchema: AnySchemaObject } = require("@json-schema-tools/meta-schema");
const {
  openrpcDocument,
}: { openrpcDocument: AnySchemaObject } = require("@open-rpc/meta-schema");

// Upstream publishes runtime schemas with declaration files containing only document types.
export const validateOpenRpc = new Ajv({
  strict: false,
  validateFormats: false,
})
  .addMetaSchema(jsonSchema)
  .addMetaSchema(jsonSchema, "https://meta.json-schema.tools")
  .compile(openrpcDocument);
