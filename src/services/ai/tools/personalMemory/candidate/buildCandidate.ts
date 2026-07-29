import { z } from "zod";
import { getAsyncLLM } from "../../../llm";
import { conditionCandidateSystemPrompt } from "./prompts";

const llmOutputSchema = z.object({
  activationDescription: z.string().trim().min(1),
});

export type AnalyzeFeedback = {
  problem_category?: string | null;
  task_type?: string | null;
  scope_description?: string | null;
  domain?: string | null;
  topic?: string | null;
  content_type?: string | null;
  project_id?: string | null;
};

export type ConditionCandidateScope = {
  problemCategory?: string;
  taskType?: string;
  scopeDescription?: string;
  domain?: string;
  topic?: string;
  contentType?: string;
  projectId?: string;
};

export type ConditionCandidate = {
  activationDescription: string;
  scope: ConditionCandidateScope;
};

export type BuildConditionCandidateInput = {
  userMessage: string;
  agentResponse: string;
  userFeedback: string;
  analyzeFeedback: AnalyzeFeedback;
};

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : undefined;
}

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
    "The condition candidate LLM response does not contain a JSON object.",
  );
}

function getMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
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
  const scope: ConditionCandidateScope = {};

  const problemCategory = normalizeOptionalString(
    analyzeFeedback.problem_category,
  );
  const taskType = normalizeOptionalString(analyzeFeedback.task_type);
  const scopeDescription = normalizeOptionalString(
    analyzeFeedback.scope_description,
  );
  const domain = normalizeOptionalString(analyzeFeedback.domain);
  const topic = normalizeOptionalString(analyzeFeedback.topic);
  const contentType = normalizeOptionalString(analyzeFeedback.content_type);
  const projectId = normalizeOptionalString(analyzeFeedback.project_id);

  if (problemCategory) {
    scope.problemCategory = problemCategory;
  }

  if (taskType) {
    scope.taskType = taskType;
  }

  if (scopeDescription) {
    scope.scopeDescription = scopeDescription;
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

export async function buildConditionCandidate(
  input: BuildConditionCandidateInput,
): Promise<ConditionCandidate> {
  const llm = await getAsyncLLM("medium");
  const scope = normalizeScope(input.analyzeFeedback);

  const userPrompt = `
${conditionCandidateSystemPrompt}

Create an activation description from the following input.

Return only valid JSON in this exact format:
{
  "activationDescription": "..."
}

${JSON.stringify(
  {
    interaction: {
      userMessage: input.userMessage,
      agentResponse: input.agentResponse,
      userFeedback: input.userFeedback,
    },
    analyzeFeedback: scope,
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
    throw new Error("The condition candidate LLM returned invalid JSON.");
  }

  const validationResult = llmOutputSchema.safeParse(parsedOutput);

  if (!validationResult.success) {
    throw new Error(
      `The condition candidate LLM returned an invalid output: ${validationResult.error.message}`,
    );
  }

  return {
    activationDescription: validationResult.data.activationDescription,
    scope,
  };
}