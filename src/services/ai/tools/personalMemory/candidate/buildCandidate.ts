import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { conditionCandidateSystemPrompt } from "./prompts";

const NonEmptyStringSchema = z
  .string()
  .trim()
  .min(1, {
    error: "Value cannot be empty.",
  });

const OptionalNullableStringSchema = z
  .string()
  .nullable()
  .optional();

const AnalyzeFeedbackSchema = z.looseObject({
  user_request: NonEmptyStringSchema,
  agent_response: NonEmptyStringSchema,
  user_feedback: NonEmptyStringSchema,

  problem_summary:
    OptionalNullableStringSchema,

  problem_category:
    OptionalNullableStringSchema,

  task_type:
    OptionalNullableStringSchema,

  scope:
    OptionalNullableStringSchema,

  scope_description:
    OptionalNullableStringSchema,

  domain:
    OptionalNullableStringSchema,

  topic:
    OptionalNullableStringSchema,

  content_type:
    OptionalNullableStringSchema,

  project_id:
    OptionalNullableStringSchema,
});

const LlmOutputSchema = z.object({
  activationDescription:
    NonEmptyStringSchema,
});

export type AnalyzeFeedback = z.infer<
  typeof AnalyzeFeedbackSchema
>;

export type ConditionCandidateScope = {
  problemCategory?: string;
  taskType?: string;
  scope?: string;
  scopeDescription?: string;
  domain?: string;
  topic?: string;
  contentType?: string;
  projectId?: string;
};

export type ConditionCandidate = z.infer<
  typeof LlmOutputSchema
>;

function normalizeOptionalString(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue || undefined;
}

function extractJsonObject(
  content: string,
): string {
  const trimmedContent = content.trim();

  if (
    trimmedContent.startsWith("{") &&
    trimmedContent.endsWith("}")
  ) {
    return trimmedContent;
  }

  const fencedJsonMatch =
    trimmedContent.match(
      /```(?:json)?\s*([\s\S]*?)\s*```/i,
    );

  if (fencedJsonMatch?.[1]) {
    const fencedContent =
      fencedJsonMatch[1].trim();

    if (
      fencedContent.startsWith("{") &&
      fencedContent.endsWith("}")
    ) {
      return fencedContent;
    }
  }

  const firstBraceIndex =
    trimmedContent.indexOf("{");

  const lastBraceIndex =
    trimmedContent.lastIndexOf("}");

  if (
    firstBraceIndex >= 0 &&
    lastBraceIndex >
      firstBraceIndex
  ) {
    return trimmedContent.slice(
      firstBraceIndex,
      lastBraceIndex + 1,
    );
  }

  throw new Error(
    "The condition candidate LLM response does not contain a JSON object.",
  );
}

function getMessageContent(
  content: unknown,
): string {
  if (typeof content === "string") {
    const normalizedContent =
      content.trim();

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
          typeof part.text ===
            "string"
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
    "The condition candidate LLM returned an unsupported or empty message content format.",
  );
}

function normalizeScope(
  analyzeFeedback: AnalyzeFeedback,
): ConditionCandidateScope {
  const scope: ConditionCandidateScope =
    {};

  const problemCategory =
    normalizeOptionalString(
      analyzeFeedback.problem_category,
    );

  const taskType =
    normalizeOptionalString(
      analyzeFeedback.task_type,
    );

  const normalizedScope =
    normalizeOptionalString(
      analyzeFeedback.scope,
    );

  const scopeDescription =
    normalizeOptionalString(
      analyzeFeedback.scope_description,
    );

  const domain =
    normalizeOptionalString(
      analyzeFeedback.domain,
    );

  const topic =
    normalizeOptionalString(
      analyzeFeedback.topic,
    );

  const contentType =
    normalizeOptionalString(
      analyzeFeedback.content_type,
    );

  const projectId =
    normalizeOptionalString(
      analyzeFeedback.project_id,
    );

  if (problemCategory) {
    scope.problemCategory =
      problemCategory;
  }

  if (taskType) {
    scope.taskType = taskType;
  }

  if (normalizedScope) {
    scope.scope = normalizedScope;
  }

  if (scopeDescription) {
    scope.scopeDescription =
      scopeDescription;
  }

  if (domain) {
    scope.domain = domain;
  }

  if (topic) {
    scope.topic = topic;
  }

  if (contentType) {
    scope.contentType = contentType;
  }

  if (projectId) {
    scope.projectId = projectId;
  }

  return scope;
}

function createPromptInput(
  analyzeFeedback: AnalyzeFeedback,
  scope: ConditionCandidateScope,
): Record<string, unknown> {
  const problemSummary =
    normalizeOptionalString(
      analyzeFeedback.problem_summary,
    );

  return {
    interaction: {
      userRequest:
        analyzeFeedback.user_request,

      agentResponse:
        analyzeFeedback.agent_response,

      userFeedback:
        analyzeFeedback.user_feedback,
    },

    analyzeFeedback: {
      ...(problemSummary
        ? {
            problemSummary,
          }
        : {}),

      ...scope,
    },
  };
}

/**
 * Builds a condition candidate by generating only its activation
 * description. Scope data is used as prompt context but is not
 * returned as part of the candidate.
 */
export async function buildConditionCandidate(
  analyzeFeedbackInput: AnalyzeFeedback,
): Promise<ConditionCandidate> {
  const validationResult =
    AnalyzeFeedbackSchema.safeParse(
      analyzeFeedbackInput,
    );

  if (!validationResult.success) {
    throw new Error(
      `Invalid analyzeFeedback input: ${validationResult.error.message}`,
    );
  }

  const analyzeFeedback =
    validationResult.data;

  const scope = normalizeScope(
    analyzeFeedback,
  );

  const promptInput = createPromptInput(
    analyzeFeedback,
    scope,
  );

  const userPrompt = `
${conditionCandidateSystemPrompt}

Create an activation description from the provided interaction and feedback analysis.

Return only valid JSON in exactly this format:
{
  "activationDescription": "..."
}

Input:
${JSON.stringify(promptInput, null, 2)}
`.trim();

  const llm =
    await getAsyncLLM("medium");

  const response =
    await llm.invoke(userPrompt);

  const content = getMessageContent(
    response.content,
  );

  const jsonContent =
    extractJsonObject(content);

  let parsedOutput: unknown;

  try {
    parsedOutput =
      JSON.parse(jsonContent);
  } catch (error) {
    throw new Error(
      "The condition candidate LLM returned invalid JSON.",
      {
        cause: error,
      },
    );
  }

  const outputValidationResult =
    LlmOutputSchema.safeParse(
      parsedOutput,
    );

  if (
    !outputValidationResult.success
  ) {
    throw new Error(
      `The condition candidate LLM returned an invalid output: ${outputValidationResult.error.message}`,
    );
  }

  return outputValidationResult.data;
}