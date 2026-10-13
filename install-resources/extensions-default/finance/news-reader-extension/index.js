import { createExtension } from "@mocu/extension-sdk";

const extension = createExtension({
  commands: {
    async translate(input) {
      const selectedText =
        input && typeof input === "object" && typeof input.text === "string"
          ? input.text.trim()
          : "";

      if (!selectedText) throw new Error("Select some text to translate.");
      if (selectedText.length > 20_000) {
        throw new Error("Selected text is too long to translate (maximum 20,000 characters).");
      }

      const result = await extension.llm.generate({
        prompt: selectedText,
        model: "openai/gpt-6-luna",
        systemPrompt: "Translate the provided text into natural, accurate Persian (Farsi). Preserve its meaning, names, numbers, and tone. Return only the Persian translation, with no explanation or quotation marks.",
        temperature: 0.2,
        maxTokens: 4_000,
      });
      return result.text;
    },
  },
});

extension.start();