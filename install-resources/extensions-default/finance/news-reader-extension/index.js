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
    async entities(input) {
      const title = input && typeof input === "object" && typeof input.title === "string"
        ? input.title.trim()
        : "";
      const articleText = input && typeof input === "object" && typeof input.text === "string"
        ? input.text.trim()
        : "";

      if (!articleText) throw new Error("The news story has no text to analyze.");
      const text = `${title ? `Title: ${title}\n\n` : ""}News story:\n${articleText}`;
      if (text.length > 100_000) {
        throw new Error("This story is too long to analyze (maximum 100,000 characters).");
      }

      const result = await extension.extract.entities({
        text,
        entities: {
          company: "Company, corporation, business, or publicly traded organization mentioned in the news.",
          precious_metal: "A precious metal mentioned in the news, such as gold, silver, platinum, or palladium.",
          country: "A country or nation mentioned in the news.",
          currency: "A currency unit mentioned in the news by its name, common symbol, or ISO code, such as the US dollar,USD, euro,EUR, British pound,GBP, yen,JPY, yuan/CNY, or Swiss franc/CHF. Extract the currency itself only; never extract an amount, number, percentage, price, or other numeric value as a currency."
        },
        threshold: 0.65,
        top_n: 200,
      });
      return { entities: result.entities };
    },
    async summarize(input) {
      const title = input && typeof input === "object" && typeof input.title === "string"
        ? input.title.trim()
        : "";
      const articleText = input && typeof input === "object" && typeof input.text === "string"
        ? input.text.trim()
        : "";

      if (!articleText) throw new Error("The news story has no text to summarize.");
      const text = `${title ? `Title: ${title}\n\n` : ""}News story:\n${articleText}`;
      if (text.length > 100_000) {
        throw new Error("This story is too long to summarize (maximum 100,000 characters).");
      }

      const result = await extension.summarize.text({
        text,
        instructions: "Summarize the key points of this news story and the most important financial information. Highlight material figures, market or company impact, and relevant risks. Write the summary in clear English, using concise bullet points when helpful. Do not add facts that are not in the story.",
      });
      return { summary: result.summary };
    },
  },
});

extension.start();