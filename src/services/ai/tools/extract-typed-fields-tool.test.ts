import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSettings } = vi.hoisted(() => ({ readSettings: vi.fn() }));
vi.mock("../../../store", () => ({ readSettings }));

import { extractTypedFieldsTool } from "./extract-typed-fields-tool";

const settings = {
  apiKey: "test-openrouter-key",
  extractionEndpointUrl: "https://openrouter.ai/api/alpha/extractions",
  clairicModel: "cloudflare/clairic",
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  readSettings.mockResolvedValue(settings);
  vi.stubGlobal("fetch", fetchMock);
});

describe("extractTypedFieldsTool", () => {
  it("sends typed field definitions to the Extractions API and returns the complete response", async () => {
    const result = {
      answers: {
        invoice_number: { value: "INV-2291", confidence: 0.99, null_probability: 0.01 },
        total: { value: 1080, confidence: 0.96, null_probability: 0.02 },
      },
      model: "cloudflare/clairic",
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => result });

    await expect(extractTypedFieldsTool.invoke({
      state: "Invoice INV-2291 total $1080",
      fields: {
        invoice_number: { type: "text" },
        total: { type: "number", unit: "USD", decimals: 2 },
      },
      reference_date: "2026-10-30",
    })).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/alpha/extractions", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer test-openrouter-key", "Content-Type": "application/json" },
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      model: "cloudflare/clairic",
      state: "Invoice INV-2291 total $1080",
      fields: {
        invoice_number: { type: "text" },
        total: { type: "number", unit: "USD", decimals: 2 },
      },
      reference_date: "2026-10-30",
    });
  });

  it("rejects empty fields, failed API calls, and responses without answers", async () => {
    await expect(extractTypedFieldsTool.invoke({
      state: "Text",
      fields: {},
    })).rejects.toThrow("at least one field");

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(extractTypedFieldsTool.invoke({
      state: "Text",
      fields: { value: { type: "text" } },
    })).rejects.toThrow("HTTP 401");

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ model: "cloudflare/clairic" }) });
    await expect(extractTypedFieldsTool.invoke({
      state: "Text",
      fields: { value: { type: "text" } },
    })).rejects.toThrow("answers object");
  });
});
