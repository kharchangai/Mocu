/**
 * Converts MCP tool input JSON Schemas into zod schemas for LangChain
 * tool binding.
 *
 * Handles the subset of JSON Schema that MCP servers commonly use for tool
 * arguments (objects, primitives, arrays, enums, unions) and degrades
 * explicitly (z.unknown / permissive records) rather than guessing. The
 * top level is always object-shaped so model providers can bind the tool.
 */

import { z } from 'zod';

type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
};

function describe<T extends { describe: (text: string) => T }>(
  schema: T,
  jsonSchema: JsonSchema,
): T {
  if (typeof jsonSchema.description === 'string' && jsonSchema.description.trim()) {
    return schema.describe(jsonSchema.description.trim());
  }
  return schema;
}

function primitiveSchema(jsonSchema: JsonSchema): z.ZodType {
  switch (jsonSchema.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}

function unionSchema(jsonSchema: JsonSchema): z.ZodType | null {
  const variants = [
    ...(jsonSchema.anyOf ?? []),
    ...(jsonSchema.oneOf ?? []),
  ];

  if (variants.length === 0 || variants.length > 4) {
    return null;
  }

  const memberSchemas = variants
    .map((variant) => jsonSchemaToZodType(variant))
    .filter((member): member is z.ZodType => member !== null);

  if (memberSchemas.length < 2) {
    return null;
  }

  return z.union(memberSchemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function enumSchema(jsonSchema: JsonSchema): z.ZodType | null {
  if (!Array.isArray(jsonSchema.enum) || jsonSchema.enum.length === 0) {
    return null;
  }

  if (jsonSchema.enum.every((item) => typeof item === 'string')) {
    return z.enum(jsonSchema.enum as [string, ...string[]]);
  }

  const literals = jsonSchema.enum.map((item) =>
    z.literal(item as unknown as string),
  );
  if (literals.length === 1) {
    return literals[0];
  }
  return z.union(
    literals as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
  );
}

function constSchema(jsonSchema: JsonSchema): z.ZodType | null {
  if (jsonSchema.const === undefined) {
    return null;
  }
  return z.literal(jsonSchema.const as never);
}

function objectSchema(jsonSchema: JsonSchema): z.ZodType {
  const properties = jsonSchema.properties ?? {};
  const required = new Set(jsonSchema.required ?? []);

  const shape: Record<string, z.ZodType> = {};

  for (const [key, propertySchema] of Object.entries(properties)) {
    let propertyZod = jsonSchemaToZodType(propertySchema) ?? z.unknown();

    if (!required.has(key)) {
      propertyZod = propertyZod.optional();
    }

    if (propertySchema.default !== undefined && required.has(key)) {
      propertyZod = propertyZod.default(propertySchema.default as never);
    }

    shape[key] = propertyZod;
  }

  let objectZod = z.object(shape);

  // Explicitly closed objects reject unknown keys; open objects (the common
  // MCP case) preserve additional properties — zod strips unknown keys by
  // default, which would silently drop valid arguments.
  if (jsonSchema.additionalProperties === false) {
    objectZod = objectZod.strict();
  } else {
    objectZod = objectZod.loose();
  }

  return objectZod;
}

function jsonSchemaToZodType(jsonSchema: JsonSchema): z.ZodType | null {
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return null;
  }

  const withDescription = <T extends z.ZodType>(schema: T): z.ZodType =>
    describe(schema, jsonSchema);

  const constant = constSchema(jsonSchema);
  if (constant) {
    return withDescription(constant);
  }

  const enumeration = enumSchema(jsonSchema);
  if (enumeration) {
    return withDescription(enumeration);
  }

  const union = unionSchema(jsonSchema);
  if (union) {
    return withDescription(union);
  }

  if (Array.isArray(jsonSchema.type)) {
    const members = jsonSchema.type.map((type) =>
      jsonSchemaToZodType({ ...jsonSchema, type }),
    );
    const valid = members.filter((member): member is z.ZodType => member !== null);
    if (valid.length === 2) {
      return withDescription(z.union(valid as [z.ZodType, z.ZodType]));
    }
    if (valid.length > 2) {
      return withDescription(
        z.union(valid as [z.ZodType, z.ZodType, ...z.ZodType[]]),
      );
    }
    return null;
  }

  switch (jsonSchema.type) {
    case 'object':
      return withDescription(objectSchema(jsonSchema));
    case 'array':
      return withDescription(
        z.array(jsonSchemaToZodType(jsonSchema.items ?? {}) ?? z.unknown()),
      );
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'null':
      return withDescription(primitiveSchema(jsonSchema));
    case undefined:
      // Schema-less properties stay permissive.
      return withDescription(z.unknown());
    default:
      return withDescription(z.unknown());
  }
}

/**
 * Converts a tool input schema into a zod object schema. Returns a
 * permissive record when the schema is missing or not object-shaped, so the
 * arguments still reach the MCP server.
 */
export function jsonSchemaToZod(
  inputSchema: unknown,
): z.ZodType<Record<string, unknown>> {
  if (
    inputSchema &&
    typeof inputSchema === 'object' &&
    (inputSchema as JsonSchema).type === 'object'
  ) {
    const converted = objectSchema(inputSchema as JsonSchema);
    return converted as z.ZodType<Record<string, unknown>>;
  }

  return z.record(z.string(), z.unknown());
}
