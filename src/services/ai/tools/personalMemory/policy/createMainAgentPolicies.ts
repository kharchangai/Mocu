import { ChatPromptTemplate } from "@langchain/core/prompts";
import { getAsyncLLM } from "../../../llm";
import {
  textSimilarity,
} from "../../textSimilarity";
import {
  CreateMainAgentPoliciesResultSchema,
  MainAgentPolicyContentSchema,
  StoredMainAgentPolicySchema,
  type AtomicPolicyMatch,
  type AtomicPolicyReference,
  type CreateMainAgentPoliciesResult,
  type MainAgentPolicyContent,
  type StoredMainAgentPolicy,
} from "./mainAgentPolicySchema";
import {
  MAIN_AGENT_POLICY_SYSTEM_PROMPT,
  buildMainAgentPolicyUserPrompt,
} from "./mainAgentPolicyPrompt";
import {
  saveMainAgentPolicyFile,
} from "./mainAgentPolicyStorage";

export interface CreateMainAgentPoliciesInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
  atomic_policies: AtomicPolicyMatch[];
  signal?: AbortSignal;
}

export interface CreateSingleMainAgentPolicyInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
  atomic_policy: string;
  signal?: AbortSignal;
}

interface CreateAndSaveMainAgentPolicyInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
  atomic_policy: string;
  signal?: AbortSignal;
}

function throwIfAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new DOMException(
      "Main agent policy generation was aborted.",
      "AbortError",
    );
  }
}

function normalizeRequiredText(
  value: string,
  fieldName: string,
): string {
  const normalizedValue = value
    .trim()
    .replace(/\s+/g, " ");

  if (!normalizedValue) {
    throw new Error(
      `${fieldName} must not be empty.`,
    );
  }

  return normalizedValue;
}

function normalizeMultilineText(
  value: string,
  fieldName: string,
): string {
  const normalizedValue =
    value.trim();

  if (!normalizedValue) {
    throw new Error(
      `${fieldName} must not be empty.`,
    );
  }

  return normalizedValue;
}

function createAtomicPolicyComparisonKey(
  atomicPolicy: string,
): string {
  return normalizeRequiredText(
    atomicPolicy,
    "atomic_policy",
  ).toLocaleLowerCase();
}

/**
 * Generates a UUID compatible with Tauri frontend environments.
 */
function createPolicyId(): string {
  if (
    typeof globalThis.crypto !==
      "undefined" &&
    typeof globalThis.crypto.randomUUID ===
      "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  throw new Error(
    "crypto.randomUUID is not available in this environment.",
  );
}

function validateGeneratedEmbedding(
  embedding: number[],
  atomicPolicy: string,
): number[] {
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0
  ) {
    throw new Error(
      `Generated embedding is empty for atomic policy "${atomicPolicy}".`,
    );
  }

  const hasInvalidValue =
    embedding.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value),
    );

  if (hasInvalidValue) {
    throw new Error(
      `Generated embedding contains an invalid numeric value for atomic policy "${atomicPolicy}".`,
    );
  }

  return embedding;
}

/**
 * Creates the stable text representation used for policy embedding.
 *
 * The same format should be used in the future when comparing
 * generated policies against stored policy files.
 */
function createMainAgentPolicyEmbeddingText(
  atomicPolicy: string,
  policy: MainAgentPolicyContent,
): string {
  const constraints =
    policy.constraints.length > 0
      ? policy.constraints
          .map(
            (constraint) =>
              `- ${constraint}`,
          )
          .join("\n")
      : "- None";

  const successCriteria =
    policy.success_criteria.length > 0
      ? policy.success_criteria
          .map(
            (criterion) =>
              `- ${criterion}`,
          )
          .join("\n")
      : "- None";

  return [
    `Atomic Policy: ${atomicPolicy}`,
    `Title: ${policy.title}`,
    `Activation Condition: ${policy.activation_condition}`,
    `Instruction: ${policy.instruction}`,
    "Constraints:",
    constraints,
    "Success Criteria:",
    successCriteria,
  ].join("\n");
}

/**
 * Generates the detailed policy content for one atomic policy.
 *
 * ID creation, embedding creation, and file storage are handled
 * separately after the LLM output has been validated.
 */
export async function createSingleMainAgentPolicy(
  input: CreateSingleMainAgentPolicyInput,
): Promise<MainAgentPolicyContent> {
  throwIfAborted(input.signal);

  const userRequest =
    normalizeMultilineText(
      input.user_request,
      "user_request",
    );

  const agentResponse =
    normalizeMultilineText(
      input.agent_response,
      "agent_response",
    );

  const userFeedback =
    normalizeMultilineText(
      input.user_feedback,
      "user_feedback",
    );

  const atomicPolicy =
    normalizeRequiredText(
      input.atomic_policy,
      "atomic_policy",
    );

  const llm = await getAsyncLLM(
    "medium",
  );

  throwIfAborted(input.signal);

  const structuredLlm =
    llm.withStructuredOutput(
      MainAgentPolicyContentSchema,
    );

  const prompt =
    ChatPromptTemplate.fromMessages([
      [
        "system",
        MAIN_AGENT_POLICY_SYSTEM_PROMPT,
      ],
      [
        "human",
        "{userPrompt}",
      ],
    ]);

  const chain = prompt.pipe(
    structuredLlm,
  );

  const response = await chain.invoke(
    {
      userPrompt:
        buildMainAgentPolicyUserPrompt({
          user_request:
            userRequest,
          agent_response:
            agentResponse,
          user_feedback:
            userFeedback,
          atomic_policy:
            atomicPolicy,
        }),
    },
    {
      signal: input.signal,
    },
  );

  throwIfAborted(input.signal);

  const validationResult =
    MainAgentPolicyContentSchema.safeParse(
      response,
    );

  if (!validationResult.success) {
    throw new Error(
      `Main agent policy output validation failed for atomic policy "${atomicPolicy}": ${validationResult.error.message}`,
    );
  }

  return validationResult.data;
}

/**
 * Creates a detailed policy, generates its embedding with
 * textSimilarity, and saves it as a JSON file.
 */
async function createAndSaveMainAgentPolicy(
  input: CreateAndSaveMainAgentPolicyInput,
): Promise<AtomicPolicyReference> {
  throwIfAborted(input.signal);

  const atomicPolicy =
    normalizeRequiredText(
      input.atomic_policy,
      "atomic_policy",
    );

  const generatedPolicy =
    await createSingleMainAgentPolicy({
      user_request:
        input.user_request,
      agent_response:
        input.agent_response,
      user_feedback:
        input.user_feedback,
      atomic_policy:
        atomicPolicy,
      signal:
        input.signal,
    });

  throwIfAborted(input.signal);

  const embeddingText =
    createMainAgentPolicyEmbeddingText(
      atomicPolicy,
      generatedPolicy,
    );

  const generatedEmbedding =
    await textSimilarity.embedText(
      embeddingText,
    );

  throwIfAborted(input.signal);

  const embedding =
    validateGeneratedEmbedding(
      generatedEmbedding,
      atomicPolicy,
    );

  const policyId =
    createPolicyId();

  const timestamp =
    new Date().toISOString();

  const storedPolicy:
    StoredMainAgentPolicy = {
      id: policyId,
      atomic_policy:
        atomicPolicy,
      policy:
        generatedPolicy,
      embedding,
      created_at:
        timestamp,
      updated_at:
        timestamp,
    };

  const policyValidationResult =
    StoredMainAgentPolicySchema.safeParse(
      storedPolicy,
    );

  if (
    !policyValidationResult.success
  ) {
    throw new Error(
      `Stored main agent policy validation failed for atomic policy "${atomicPolicy}": ${policyValidationResult.error.message}`,
    );
  }

  throwIfAborted(input.signal);

  await saveMainAgentPolicyFile(
    policyValidationResult.data,
    input.signal,
  );

  throwIfAborted(input.signal);

  return {
    atomic_policy:
      atomicPolicy,
    policy_id:
      policyId,
  };
}

/**
 * Registers all existing policy IDs before creating new policies.
 *
 * This allows a missing duplicate to reuse an existing policy ID
 * even if the existing entry appears later in the input array.
 */
function collectExistingPolicyIds(
  atomicPolicies: AtomicPolicyMatch[],
): Map<string, string> {
  const resolvedPolicyIds =
    new Map<string, string>();

  for (
    let index = 0;
    index < atomicPolicies.length;
    index += 1
  ) {
    const atomicPolicyMatch =
      atomicPolicies[index];

    const atomicPolicy =
      normalizeRequiredText(
        atomicPolicyMatch.policy,
        `atomic_policies[${index}].policy`,
      );

    if (
      atomicPolicyMatch.policy_id ===
      false
    ) {
      continue;
    }

    const policyId =
      normalizeRequiredText(
        atomicPolicyMatch.policy_id,
        `atomic_policies[${index}].policy_id`,
      );

    const comparisonKey =
      createAtomicPolicyComparisonKey(
        atomicPolicy,
      );

    const existingId =
      resolvedPolicyIds.get(
        comparisonKey,
      );

    if (
      existingId &&
      existingId !== policyId
    ) {
      throw new Error(
        `Atomic policy "${atomicPolicy}" has conflicting policy IDs: "${existingId}" and "${policyId}".`,
      );
    }

    resolvedPolicyIds.set(
      comparisonKey,
      policyId,
    );
  }

  return resolvedPolicyIds;
}

/**
 * Creates a policy only for atomic policies that do not already
 * have a resolved policy ID.
 *
 * Existing policy IDs are preserved.
 * Duplicate atomic policies share one policy file and one ID.
 *
 * The returned object contains only atomic policy references so
 * it can be stored directly inside the condition file.
 */
export async function createMainAgentPolicies(
  input: CreateMainAgentPoliciesInput,
): Promise<CreateMainAgentPoliciesResult> {
  throwIfAborted(input.signal);

  const userRequest =
    normalizeMultilineText(
      input.user_request,
      "user_request",
    );

  const agentResponse =
    normalizeMultilineText(
      input.agent_response,
      "agent_response",
    );

  const userFeedback =
    normalizeMultilineText(
      input.user_feedback,
      "user_feedback",
    );

  if (
    !Array.isArray(
      input.atomic_policies,
    )
  ) {
    throw new Error(
      "atomic_policies must be an array.",
    );
  }

  if (
    input.atomic_policies.length === 0
  ) {
    return {
      atomic_policies: [],
    };
  }

  const resolvedPolicyIds =
    collectExistingPolicyIds(
      input.atomic_policies,
    );

  /*
   * New policies are created sequentially to avoid unnecessary
   * parallel LLM and embedding requests.
   */
  for (
    let index = 0;
    index <
    input.atomic_policies.length;
    index += 1
  ) {
    throwIfAborted(input.signal);

    const atomicPolicyMatch =
      input.atomic_policies[index];

    const atomicPolicy =
      normalizeRequiredText(
        atomicPolicyMatch.policy,
        `atomic_policies[${index}].policy`,
      );

    const comparisonKey =
      createAtomicPolicyComparisonKey(
        atomicPolicy,
      );

    if (
      resolvedPolicyIds.has(
        comparisonKey,
      )
    ) {
      continue;
    }

    const createdReference =
      await createAndSaveMainAgentPolicy({
        user_request:
          userRequest,
        agent_response:
          agentResponse,
        user_feedback:
          userFeedback,
        atomic_policy:
          atomicPolicy,
        signal:
          input.signal,
      });

    resolvedPolicyIds.set(
      comparisonKey,
      createdReference.policy_id,
    );
  }

  throwIfAborted(input.signal);

  /*
   * The output preserves input order and includes both existing
   * and newly created policy IDs.
   */
  const atomicPolicyReferences:
    AtomicPolicyReference[] =
      input.atomic_policies.map(
        (
          atomicPolicyMatch,
          index,
        ) => {
          const atomicPolicy =
            normalizeRequiredText(
              atomicPolicyMatch.policy,
              `atomic_policies[${index}].policy`,
            );

          const comparisonKey =
            createAtomicPolicyComparisonKey(
              atomicPolicy,
            );

          const policyId =
            resolvedPolicyIds.get(
              comparisonKey,
            );

          if (!policyId) {
            throw new Error(
              `No policy ID was resolved for atomic policy "${atomicPolicy}".`,
            );
          }

          return {
            atomic_policy:
              atomicPolicy,
            policy_id:
              policyId,
          };
        },
      );

  const result:
    CreateMainAgentPoliciesResult = {
      atomic_policies:
        atomicPolicyReferences,
    };

  const validationResult =
    CreateMainAgentPoliciesResultSchema.safeParse(
      result,
    );

  if (!validationResult.success) {
    throw new Error(
      `Main agent policy references validation failed: ${validationResult.error.message}`,
    );
  }

  return validationResult.data;
}