import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { generateAtomicPolicy } from "./generateAtomicPolicy";
import { conditionCandidateSystemPrompt } from "./prompts";
import {
  createMainAgentPolicies,
} from "../policy/createMainAgentPolicies";
import type {
  CreateMainAgentPoliciesResult,
} from "../policy/mainAgentPolicySchema";

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

/**
 * The final output contains both the generated activation
 * description and all resolved main-agent policy references.
 */
export type ConditionCandidate = z.infer<
  typeof LlmOutputSchema
> & {
  mainAgentPolicies:
    CreateMainAgentPoliciesResult;
};

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
    lastBraceIndex > firstBraceIndex
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
    scope.taskType =
      taskType;
  }

  if (normalizedScope) {
    scope.scope =
      normalizedScope;
  }

  if (scopeDescription) {
    scope.scopeDescription =
      scopeDescription;
  }

  if (domain) {
    scope.domain =
      domain;
  }

  if (topic) {
    scope.topic =
      topic;
  }

  if (contentType) {
    scope.contentType =
      contentType;
  }

  if (projectId) {
    scope.projectId =
      projectId;
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
 * Builds a complete condition candidate.
 *
 * This function:
 * 1. Generates the activation description.
 * 2. Generates atomic policies.
 * 3. Resolves existing policy IDs.
 * 4. Creates, embeds, and stores missing policies.
 * 5. Returns the activation description together with all
 *    resolved atomic-policy references.
 *
 * Policy generation errors are propagated to prevent storing
 * an incomplete condition.
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

  const llm = await getAsyncLLM(
    "medium",
  );

  const response = await llm.invoke(
    userPrompt,
  );

  const content = getMessageContent(
    response.content,
  );

  const jsonContent =
    extractJsonObject(content);

  let parsedOutput: unknown;

  try {
    parsedOutput =
      JSON.parse(jsonContent);
  } catch {
    throw new Error(
      "The condition candidate LLM returned invalid JSON.",
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

  const activationResult =
    outputValidationResult.data;

  console.log(
    "Generated activation description:",
    JSON.stringify(
      activationResult,
      null,
      2,
    ),
  );

  /*
   * Generate atomic policies and detect whether each policy
   * already has a stored policy file.
   */
  const atomicPolicyResult =
    await generateAtomicPolicy({
      user_request:
        analyzeFeedback.user_request,

      agent_response:
        analyzeFeedback.agent_response,

      user_feedback:
        analyzeFeedback.user_feedback,

      problem_summary:
        normalizeOptionalString(
          analyzeFeedback.problem_summary,
        ) ?? "",

      problem_category:
        normalizeOptionalString(
          analyzeFeedback.problem_category,
        ) ?? "",

      task_type:
        normalizeOptionalString(
          analyzeFeedback.task_type,
        ) ?? "",

      activation_description:
        activationResult.activationDescription,
    });

  console.log(
    "Generated atomic policies:",
    JSON.stringify(
      atomicPolicyResult,
      null,
      2,
    ),
  );

  /*
   * Existing policy IDs are preserved. Missing policies are
   * generated, embedded with textSimilarity, and stored.
   */
  const mainAgentPolicies =
    await createMainAgentPolicies({
      user_request:
        analyzeFeedback.user_request,

      agent_response:
        analyzeFeedback.agent_response,

      user_feedback:
        analyzeFeedback.user_feedback,

      atomic_policies:
        atomicPolicyResult.atomic_policies,
    });

  console.log(
    "Resolved main-agent policies:",
    JSON.stringify(
      mainAgentPolicies,
      null,
      2,
    ),
  );

  const conditionCandidate:
    ConditionCandidate = {
      activationDescription:
        activationResult.activationDescription,

      mainAgentPolicies,
    };

  console.log(
    "Final condition candidate:",
    JSON.stringify(
      conditionCandidate,
      null,
      2,
    ),
  );

  return conditionCandidate;
}