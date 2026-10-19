import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSettings } = vi.hoisted(() => ({
  readSettings: vi.fn(),
}));

vi.mock("../../../store", () => ({ readSettings }));

import { summarizeTextTool } from "./summarize-text-tool";

const settings = {
  apiKey: "test-openrouter-key",
  gatewayBaseUrl: "https://openrouter.ai/api/v1/",
  summarizeModel: "scaledown/summarize",
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  readSettings.mockResolvedValue(settings);
  vi.stubGlobal("fetch", fetchMock);
});

describe("summarizeTextTool", () => {
  it("calls the configured Summarize LLM and returns its plain-text result", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "A concise summary." } }] }),
    });

    const result = await summarizeTextTool.invoke({
      text: "  The full source text.  ",
      instructions: "Use three bullet points.",
    });

    expect(result).toBe("A concise summary.");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-openrouter-key",
          "Content-Type": "application/json",
        },
      }),
    );
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request).toEqual({
      model: "scaledown/summarize",
      messages: [
        {
          role: "system",
          content: expect.stringContaining("Use three bullet points."),
        },
        { role: "user", content: "The full source text." },
      ],
    });
    expect(request.messages[0].content).toContain("Summarize the supplied text faithfully");
  });

  it("passes the agent run cancellation signal to fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Summary" } }] }),
    });
    const controller = new AbortController();

    await summarizeTextTool.invoke({ text: "Source" }, { signal: controller.signal });

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it("fails clearly when the shared API key is missing", async () => {
    readSettings.mockResolvedValue({ ...settings, apiKey: " " });

    await expect(summarizeTextTool.invoke({ text: "Source" })).rejects.toThrow(
      "shared OpenRouter API key",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports unsuccessful API responses and empty model replies", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(summarizeTextTool.invoke({ text: "Source" })).rejects.toThrow(
      "status 401",
    );

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "  " } }] }),
    });
    await expect(summarizeTextTool.invoke({ text: "Source" })).rejects.toThrow(
      "empty or invalid response",
    );
  });
});
