import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { readSettings } from "../../../store";
import { combineAbortSignals } from "../agent/abort";

const FIELD_TYPES = [
  "text",
  "number",
  "date",
  "datetime",
  "time",
  "duration",
  "list",
  "estimate",
  "forecast",
] as const;

const extractionFieldSchema = z.object({
  type: z.enum(FIELD_TYPES),
}).passthrough();

/** Extracts strongly typed values from state via OpenRouter's Extractions API. */
export const extractTypedFieldsTool = tool(
  async ({ state, fields, reference_date }, config: RunnableConfig) => {
    if (typeof state === "string" && !state.trim()) {
      throw new Error("Provide non-empty state for typed extraction.");
    }
    if (Array.isArray(state) && state.length === 0) {
      throw new Error("Provide non-empty state for typed extraction.");
    }
    if (Object.keys(fields).length === 0) {
      throw new Error("Define at least one field to extract.");
    }

    const settings = await readSettings();
    if (!settings.apiKey.trim()) {
      throw new Error("The shared OpenRouter API key is not configured in Settings.");
    }

    const endpointUrl = settings.extractionEndpointUrl.trim();
    if (!endpointUrl) {
      throw new Error("The OpenRouter Extractions API endpoint is not configured in Settings.");
    }

    const model = settings.clairicModel.trim();
    if (!model) {
      throw new Error("The Clairic extraction model is not configured in Settings.");
    }

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state,
        fields,
        ...(reference_date?.trim() ? { reference_date: reference_date.trim() } : {}),
      }),
      signal: combineAbortSignals([
        AbortSignal.timeout(30_000),
        config?.signal,
      ]),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter Extractions API failed: HTTP ${response.status}`);
    }

    const data: unknown = await response.json();
    if (
      !data || typeof data !== "object" || Array.isArray(data) ||
      !("answers" in data) || !data.answers ||
      typeof data.answers !== "object" || Array.isArray(data.answers)
    ) {
      throw new Error("The Extractions API response must contain an answers object.");
    }

    return data;
  },
  {
    name: "extract_typed_fields",
    description:
      "Extract, compute, estimate, or forecast strongly typed fields from text or a state object using cloudflare/clairic and OpenRouter's Extractions API. Define each output field with a supported type (text, number, date, datetime, time, duration, list, estimate, or forecast). Results include each field's value, confidence, and null probability.",
    schema: z.object({
      state: z.union([
        z.string().min(1),
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()).min(1),
      ]).describe("The text or structured state to inspect. Arrays may include multimodal items such as image_url content."),
      fields: z.record(z.string(), extractionFieldSchema).refine(
        (value) => Object.keys(value).length > 0,
        { message: "Define at least one field to extract." },
      ).describe("Map each requested output name to its typed field schema. For example: { invoice_number: { type: 'text' }, total: { type: 'number', unit: 'USD', decimals: 2 }, contacts: { type: 'list', items: 'text' } }. Type-specific options such as unit, decimals, items, min, max, and step are passed through."),
      reference_date: z.string().optional().describe("Optional reference date (YYYY-MM-DD) for relative dates, estimates, or forecasts."),
    }),
  },
);

export default extractTypedFieldsTool;
