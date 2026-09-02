// window/llmResponse.ts

/**
 * Shared helpers for extracting text and JSON from LLM responses.
 */

export type MessageContentBlock = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

export function removeMarkdownCodeFence(
  value: string,
): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractJSONObject(
  value: string,
): string {
  const cleanedValue =
    removeMarkdownCodeFence(value);

  const firstBrace =
    cleanedValue.indexOf("{");

  const lastBrace =
    cleanedValue.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1 ||
    lastBrace <= firstBrace
  ) {
    throw new Error(
      "The LLM response does not contain a JSON object.",
    );
  }

  return cleanedValue.slice(
    firstBrace,
    lastBrace + 1,
  );
}

export function convertMessageContentToText(
  content: unknown,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }

      if (
        !block ||
        typeof block !== "object"
      ) {
        return "";
      }

      const contentBlock =
        block as MessageContentBlock;

      if (
        typeof contentBlock.text === "string"
      ) {
        return contentBlock.text;
      }

      if (
        typeof contentBlock.content ===
        "string"
      ) {
        return contentBlock.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function getLLMResponseText(
  llmResponse: unknown,
): string {
  if (typeof llmResponse === "string") {
    return llmResponse;
  }

  if (
    !llmResponse ||
    typeof llmResponse !== "object"
  ) {
    return "";
  }

  if ("content" in llmResponse) {
    const contentText =
      convertMessageContentToText(
        llmResponse.content,
      );

    if (contentText) {
      return contentText;
    }
  }

  if (
    "text" in llmResponse &&
    typeof llmResponse.text === "string"
  ) {
    return llmResponse.text;
  }

  return "";
}
