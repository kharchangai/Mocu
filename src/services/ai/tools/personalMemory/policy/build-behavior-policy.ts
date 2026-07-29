import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { behaviorPolicySystemPrompt } from "./prompts";
import type { ConditionCandidate } from "../candidate/buildCandidate";

const llmOutputSchema = z.object({
  policyDescription: z.string().trim().min(1),
  instructions: z.array(z.string().trim().min(1)).min(1),
});

export type BehaviorPolicy = {
  policyDescription: string;
  instructions: string[];
  activationDescription: string;
  scope: ConditionCandidate["scope"];
};

export type BuildBehaviorPolicyInput = {
  userMessage: string;
  agentResponse: string;
  userFeedback: string;
  conditionCandidate: ConditionCandidate;
};

function extractJsonObject(content: string): string {
  const trimmedContent = content.trim();

  if (trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) {
    return trimmedContent;
  }

  const fencedJsonMatch = trimmedContent.match(
    /```(?:json)?\s*([\s\S]*?)\s*```/i,
  );

  if (fencedJsonMatch?.[1]) {
    const fencedContent = fencedJsonMatch[1].trim();

    if (fencedContent.startsWith("{") && fencedContent.endsWith("}")) {
      return fencedContent;
    }
  }

  const firstBraceIndex = trimmedContent.indexOf("{");
  const lastBraceIndex = trimmedContent.lastIndexOf("}");

  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmedContent.slice(firstBraceIndex, lastBraceIndex + 1);
  }

  throw new Error(
    "The behavior policy LLM response does not contain a JSON object.",
  );
}

function getMessageContent(content: unknown): string {
  if (typeof content === "string") {
    const normalizedContent = content.trim();

    if (normalizedContent) {
      return normalizedContent;
    }
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (
          typeof part === "object" &&
          part !== null &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          return part.text;
        }

        return "";
      })
      .join("")
      .trim();

    if (text) {
      return text;
    }
  }

  throw new Error(
    "The behavior policy LLM returned an unsupported or empty message content format.",
  );
}

export async function buildBehaviorPolicy(
  input: BuildBehaviorPolicyInput,
): Promise<BehaviorPolicy> {
  const llm = await getAsyncLLM("medium");

  const userPrompt = `
${behaviorPolicySystemPrompt}

Create a behavior policy from this interaction and condition candidate.

Return only valid JSON in this exact format:
{
  "policyDescription": "...",
  "instructions": [
    "...",
    "..."
  ]
}

${JSON.stringify(
  {
    interaction: {
      userMessage: input.userMessage,
      agentResponse: input.agentResponse,
      userFeedback: input.userFeedback,
    },
    conditionCandidate: input.conditionCandidate,
  },
  null,
  2,
)}
`.trim();

  const response = await llm.invoke(userPrompt);
  const content = getMessageContent(response.content);
  const jsonContent = extractJsonObject(content);

  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(jsonContent);
  } catch {
    throw new Error("The behavior policy LLM returned invalid JSON.");
  }

  const validationResult = llmOutputSchema.safeParse(parsedOutput);

  if (!validationResult.success) {
    throw new Error(
      `The behavior policy LLM returned an invalid output: ${validationResult.error.message}`,
    );
  }

  return {
    policyDescription: validationResult.data.policyDescription,
    instructions: validationResult.data.instructions,
    activationDescription: input.conditionCandidate.activationDescription,
    scope: input.conditionCandidate.scope,
  };
}