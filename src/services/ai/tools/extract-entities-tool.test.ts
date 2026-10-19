import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSettings } = vi.hoisted(() => ({ readSettings: vi.fn() }));
vi.mock("../../../store", () => ({ readSettings }));

import { extractEntitiesTool } from "./extract-entities-tool";

const settings = {
  apiKey: "test-openrouter-key",
  gatewayBaseUrl: "https://openrouter.ai/api/v1/",
  extractModel: "scaledown/extract",
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  readSettings.mockResolvedValue(settings);
  vi.stubGlobal("fetch", fetchMock);
});

describe("extractEntitiesTool", () => {
  it("passes entity definitions and optional parameters through OpenRouter's provider options", async () => {
    const result = { entities: [{ type: "vendor", text: "Northwind", confidence: 0.98, start: 0, end: 9, context: "Northwind invoice" }] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(result) } }] }) });

    await expect(extractEntitiesTool.invoke({
      text: "Northwind invoice",
      entities: { vendor: "Company issuing the invoice" },
      threshold: 0.7,
      top_n: 5,
    })).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer test-openrouter-key", "Content-Type": "application/json" },
    }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("scaledown/extract");
    expect(body.messages).toEqual([{ role: "user", content: "Northwind invoice" }]);
    expect(body.provider.options.scaledown).toEqual({
      entities: { vendor: "Company issuing the invoice" },
      threshold: 0.7,
      top_n: 5,
    });
  });

  it("rejects invalid JSON and unsuccessful responses", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "not json" } }] }) });
    await expect(extractEntitiesTool.invoke({ text: "Text", entities: { person: "A person" } })).rejects.toThrow("invalid JSON");

    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(extractEntitiesTool.invoke({ text: "Text", entities: { person: "A person" } })).rejects.toThrow("status 401");
  });
});
