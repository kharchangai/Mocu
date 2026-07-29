import { getAsyncLLM } from "../../../llm";
import {
  EXTRACT_ATOMIC_MEMORIES_SYSTEM_PROMPT,
  createExtractAtomicMemoriesPrompt,
} from "./prompts";

type AtomicMemoriesResponse = {
  memories?: unknown;
};

function parseAtomicMemories(content: unknown): string[] {
  if (typeof content !== "string") {
    return [];
  }

  try {
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");

    const parsed: unknown = JSON.parse(cleanedContent);

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as AtomicMemoriesResponse).memories)
    ) {
      return [];
    }

    return (parsed as AtomicMemoriesResponse).memories.filter(
      (memory): memory is string =>
        typeof memory === "string" && memory.trim().length > 0,
    );
  } catch {
    return [];
  }
}

export async function extractAtomicMemories(
  message: string,
): Promise<string[]> {
  const userMessage = message.trim();

  if (!userMessage) {
    return [];
  }

  try {
    const llm = await getAsyncLLM("medium");

    const response = await llm.invoke([
      {
        role: "system",
        content: EXTRACT_ATOMIC_MEMORIES_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: createExtractAtomicMemoriesPrompt(userMessage),
      },
    ]);

    return parseAtomicMemories(response.content);
  } catch (error) {
    console.error("Failed to extract atomic memories:", error);

    return [];
  }
}