import { z } from "zod";

/**
 * JSON-schema-shaped object accepted by both OpenAI-compatible and Gemini
 * tool definitions. The shape produced by `z.toJSONSchema()` is broader
 * than what Gemini accepts, so we strip a few unsupported keywords.
 */
export type JSONSchemaForTool = Record<string, unknown>;

/**
 * Convert a Zod schema to JSON Schema for OpenAI-compatible providers
 * (Groq + OpenRouter both accept a JSON Schema in `function.parameters`).
 *
 * Uses Zod 4's built-in `z.toJSONSchema()` and removes the `$schema`
 * key the OpenAI SDK doesn't expect.
 */
export function zodToOpenAISchema(
  schema: z.ZodType<Record<string, unknown>>
): JSONSchemaForTool {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json;
}

/**
 * Convert a Zod schema to a Gemini-compatible function-declaration
 * schema. Gemini's schema language is OpenAPI-3-shaped and rejects a
 * few JSON Schema keywords.
 *
 * - Drops `$schema`, `additionalProperties`, `definitions`, `$defs`,
 *   `not`, `oneOf`, `anyOf`, `allOf` (Gemini supports `anyOf` only at
 *   the top level since SDK 0.20+; we drop for safety on lower versions).
 * - Type strings are mapped to upper-case OpenAPI type names where
 *   needed (string → STRING, etc.).
 *
 * Gemini's typing in the SDK is loose, so the return is `unknown`.
 */
export function zodToGeminiSchema(
  schema: z.ZodType<Record<string, unknown>>
): unknown {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return stripForGemini(json);
}

const GEMINI_TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  integer: "INTEGER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

const GEMINI_DROP_KEYS = new Set([
  "$schema",
  "$defs",
  "definitions",
  "additionalProperties",
  "not",
  "oneOf",
  "anyOf",
  "allOf",
]);

function stripForGemini(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map(stripForGemini);
  }
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (GEMINI_DROP_KEYS.has(key)) continue;
      if (key === "type" && typeof value === "string") {
        out[key] = GEMINI_TYPE_MAP[value] ?? value.toUpperCase();
        continue;
      }
      out[key] = stripForGemini(value);
    }
    return out;
  }
  return input;
}
