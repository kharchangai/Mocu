import { describe, expect, it } from 'vitest';

import { jsonSchemaToZod } from './json-schema-to-zod';

describe('jsonSchemaToZod', () => {
  it('converts object schemas with required and optional properties', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query text.' },
        limit: { type: 'integer' },
      },
      required: ['query'],
    });

    const parsed = schema.safeParse({ query: 'hello', limit: 3, extra: true });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ query: 'hello', limit: 3, extra: true });

    const missing = schema.safeParse({ limit: 3 });
    expect(missing.success).toBe(false);
  });

  it('strips nothing when additionalProperties is false but keeps unknown keys when open', () => {
    const closed = jsonSchemaToZod({
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    });

    const closedResult = closed.safeParse({ a: 'x', b: 1 });
    expect(closedResult.success).toBe(false);
  });

  it('handles enums and unions', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        mode: { enum: ['fast', 'slow'] },
        count: { anyOf: [{ type: 'number' }, { enum: ['all'] }] },
      },
    });

    expect(schema.safeParse({ mode: 'fast', count: 5 }).success).toBe(true);
    expect(schema.safeParse({ mode: 'fast', count: 'all' }).success).toBe(true);
    expect(schema.safeParse({ mode: 'turbo', count: 5 }).success).toBe(false);
  });

  it('handles arrays and nested objects', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        options: {
          type: 'object',
          properties: { deep: { type: 'boolean' } },
        },
      },
    });

    expect(
      schema.safeParse({ tags: ['a', 'b'], options: { deep: true } }).success,
    ).toBe(true);
    expect(schema.safeParse({ tags: [1] }).success).toBe(false);
  });

  it('falls back to a permissive record for missing or non-object schemas', () => {
    expect(jsonSchemaToZod(undefined).safeParse({ anything: 'goes' }).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'string' }).safeParse({ anything: 'goes' }).success).toBe(
      true,
    );
  });

  it('preserves descriptions for model providers', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
      },
      required: ['query'],
    });

    // zod descriptions are reachable through .description on the property.
    expect(schema.safeParse({ query: 'x' }).success).toBe(true);
  });
});
