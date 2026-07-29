import {getAsyncLLM} from "../../llm"
import { z } from "zod";

import {
  PERSONAL_MEMORY_GATE_SYSTEM_PROMPT,
  createPersonalMemoryGateUserPrompt,
} from "./prompts";

const personalMemoryGateSchema = z.object({
  isPersonalMemory: z
    .boolean()
    .describe(
      "True only if the interaction contains a reusable personal preference, concrete correction, stable user fact, or durable project/workflow fact.",
    ),

  reason: z
    .string()
    .describe(
      "A short explanation of why the interaction should be stored or skipped.",
    ),
});

export type PersonalMemoryGateInput = {
  userMessage: string;
  assistantMessage: string;
  nextUserMessage: string;
};

export type PersonalMemoryGatePassedResult = {
  status: "PASSED";
  messages: PersonalMemoryGateInput;
  reason: string;
};

export type PersonalMemoryGateSkippedResult = {
  status: "SKIP";
  output: "SKIP";
  reason: string;
};

export type PersonalMemoryGateResult =
  | PersonalMemoryGatePassedResult
  | PersonalMemoryGateSkippedResult;

const model = await getAsyncLLM("medium")

const structuredModel = model.withStructuredOutput(personalMemoryGateSchema, {
  name: "personal_memory_gate_result",
});

/**
 * Checks whether a three-message interaction is suitable for personal memory.
 *
 * If it passes, the original three messages are returned.
 * If it does not pass, { status: "SKIP", output: "SKIP" } is returned.
 */
export async function runPersonalMemoryGate(
  input: PersonalMemoryGateInput,
): Promise<PersonalMemoryGateResult> {
  validateInput(input);

  try {
    const decision = await structuredModel.invoke([
      {
        role: "system",
        content: PERSONAL_MEMORY_GATE_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: createPersonalMemoryGateUserPrompt(input),
      },
    ]);

    if (!decision.isPersonalMemory) {
      return {
        status: "SKIP",
        output: "SKIP",
        reason: decision.reason,
      };
    }

    return {
      status: "PASSED",
      messages: input,
      reason: decision.reason,
    };
  } catch (error) {
    console.error("Personal memory gate failed:", error);

    // If the gate fails, do not store anything.
    // This prevents accidental memory creation on errors.
    return {
      status: "SKIP",
      output: "SKIP",
      reason: "Memory gate failed, so the interaction was skipped safely.",
    };
  }
}

function validateInput(input: PersonalMemoryGateInput): void {
  if (!input.userMessage.trim()) {
    throw new Error("userMessage must not be empty.");
  }

  if (!input.assistantMessage.trim()) {
    throw new Error("assistantMessage must not be empty.");
  }

  if (!input.nextUserMessage.trim()) {
    throw new Error("nextUserMessage must not be empty.");
  }
}