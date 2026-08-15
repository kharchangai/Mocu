import {
  BaseDirectory,
  readDir,
  readTextFile,
  type DirEntry,
} from "@tauri-apps/plugin-fs";

import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import {
  getAsyncLLM,
  type LlmTier,
} from "../../llm";

import {
  textSimilarity,
  type EmbeddingListItem,
} from "../textSimilarity";

import {
  MAIN_AGENT_POLICY_SYSTEM_PROMPT,
  createMainAgentPolicyUserPrompt,
} from "./mainAgentPolicyPrompt";

const CONDITION_DIRECTORY =
  "feedback-memories/condition";

const POLICY_DIRECTORY =
  "feedback-memories/policy";

const DEFAULT_SIMILARITY_THRESHOLD = 0.5;
const DEFAULT_MAX_MATCHED_CONDITIONS = 3;
const DEFAULT_LLM_TIER: LlmTier = "medium";

type UnknownRecord = Record<string, unknown>;

export type AtomicPolicyReference = {
  policy_id: string;
};

export type ConditionDocument = {
  id: string;
  condition_embedding: number[];
  atomic_policies: AtomicPolicyReference[];
  state?: string;
};

export type PolicyDocument = {
  id: string;
  atomic_policy: string;
  title: string;
  activation_condition: string;
  instruction: string[];
  constraints: string[];
  success_criteria: string[];
  embedding: number[];
};

export type MatchedCondition = {
  condition_id: string;
  file_name: string;
  similarity_score: number;
  policy_ids: string[];
};

export type RetrievedPolicy = {
  policy_id: string;
  file_name: string;
  atomic_policy: string;
  title: string;
  activation_condition: string;
  instruction: string[];
  constraints: string[];
  success_criteria: string[];
  embedding: number[];
  source_condition_ids: string[];
};

export type GenerateMainAgentPolicyPromptOptions = {
  similarityThreshold?: number;
  maxMatchedConditions?: number;
  llmTier?: LlmTier;
  baseDirectory?: BaseDirectory;
  includeInactiveConditions?: boolean;
  abortSignal?: AbortSignal;
};

export type GenerateMainAgentPolicyPromptResult = {
  user_request: string;
  user_embedding: number[];
  matched_conditions: MatchedCondition[];
  retrieved_policies: RetrievedPolicy[];
  main_agent_prompt: string | null;
  should_create_condition: boolean;
  used_language_model: boolean;
};

type ConditionFile = {
  fileName: string;
  document: ConditionDocument;
};

type PolicyFile = {
  fileName: string;
  document: PolicyDocument;
};

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (signal?.aborted) {
    throw new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
  }
}

function isRecord(
  value: unknown,
): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function getOptionalString(
  value: unknown,
): string {
  return isNonEmptyString(value)
    ? value.trim()
    : "";
}

function isValidEmbedding(
  value: unknown,
): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isFinite(item),
    )
  );
}

function normalizeStringArray(
  value: unknown,
): string[] {
  if (isNonEmptyString(value)) {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter(isNonEmptyString)
        .map((item) => item.trim()),
    ),
  ];
}

function normalizePolicyReferences(
  value: unknown,
): AtomicPolicyReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const policyIds = new Set<string>();

  for (const item of value) {
    if (isNonEmptyString(item)) {
      policyIds.add(item.trim());
      continue;
    }

    if (!isRecord(item)) {
      continue;
    }

    if (isNonEmptyString(item.policy_id)) {
      policyIds.add(item.policy_id.trim());
      continue;
    }

    if (isNonEmptyString(item.policyId)) {
      policyIds.add(item.policyId.trim());
    }
  }

  return [...policyIds].map((policyId) => ({
    policy_id: policyId,
  }));
}

function parseConditionDocument(
  value: unknown,
  fileName: string,
): ConditionDocument {
  if (!isRecord(value)) {
    throw new Error(
      `Condition file "${fileName}" must contain a JSON object.`,
    );
  }

  if (!isNonEmptyString(value.id)) {
    throw new Error(
      `Condition file "${fileName}" does not contain a valid id.`,
    );
  }

  const embedding =
    value.condition_embedding ??
    value.conditionEmbedding ??
    value.embedding;

  if (!isValidEmbedding(embedding)) {
    throw new Error(
      `Condition file "${fileName}" does not contain a valid embedding.`,
    );
  }

  return {
    id: value.id.trim(),
    condition_embedding: [...embedding],
    atomic_policies: normalizePolicyReferences(
      value.atomic_policies ??
        value.atomicPolicies ??
        value.policy_ids ??
        value.policyIds,
    ),
    state: isNonEmptyString(value.state)
      ? value.state.trim().toLowerCase()
      : undefined,
  };
}

function parsePolicyDocument(
  value: unknown,
  fileName: string,
): PolicyDocument {
  if (!isRecord(value)) {
    throw new Error(
      `Policy file "${fileName}" must contain a JSON object.`,
    );
  }

  if (!isNonEmptyString(value.id)) {
    throw new Error(
      `Policy file "${fileName}" does not contain a valid id.`,
    );
  }

  if (!isRecord(value.policy)) {
    throw new Error(
      `Policy file "${fileName}" does not contain a valid "policy" object.`,
    );
  }

  const policy = value.policy;

  const instruction = normalizeStringArray(
    policy.instruction ??
      policy.instructions,
  );

  const constraints = normalizeStringArray(
    policy.constraints,
  );

  const successCriteria = normalizeStringArray(
    policy.success_criteria ??
      policy.successCriteria,
  );

  if (
    instruction.length === 0 &&
    constraints.length === 0 &&
    successCriteria.length === 0
  ) {
    throw new Error(
      `Policy file "${fileName}" does not contain policy requirements inside "policy".`,
    );
  }

  const embedding = isValidEmbedding(
    value.embedding,
  )
    ? [...value.embedding]
    : [];

  return {
    id: value.id.trim(),
    atomic_policy: getOptionalString(
      value.atomic_policy ??
        value.atomicPolicy,
    ),
    title: getOptionalString(policy.title),
    activation_condition: getOptionalString(
      policy.activation_condition ??
        policy.activationCondition,
    ),
    instruction,
    constraints,
    success_criteria: successCriteria,
    embedding,
  };
}

function isJsonFile(
  entry: DirEntry,
): boolean {
  return (
    entry.isFile === true &&
    entry.name.toLowerCase().endsWith(".json")
  );
}

/**
 * Reads directory entries, treating a missing directory as an empty
 * result instead of throwing. On a fresh install the feedback-memory
 * directories do not exist yet, so this lets the caller behave as if
 * there are simply no conditions or policies stored.
 */
async function readDirectoryEntries(
  directory: string,
  baseDirectory: BaseDirectory,
  signal?: AbortSignal,
): Promise<DirEntry[]> {
  throwIfAborted(signal);

  try {
    return await readDir(directory, {
      baseDir: baseDirectory,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const isMissingDirectory =
      message.includes(
        "system cannot find the path",
      ) ||
      message.includes("os error 3") ||
      message.includes("ENOENT") ||
      message.includes("No such file") ||
      message.includes("no such file");

    if (isMissingDirectory) {
      console.warn(
        `[Memory retrieval] Directory not found: ${directory}. Treating as empty.`,
      );

      return [];
    }

    throw error;
  }
}


async function readJsonFile(
  path: string,
  baseDirectory: BaseDirectory,
): Promise<unknown> {
  const content = await readTextFile(path, {
    baseDir: baseDirectory,
  });

  try {
    return JSON.parse(content) as unknown;
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Could not parse JSON file "${path}": ${message}`,
    );
  }
}

async function readConditionFiles(
  baseDirectory: BaseDirectory,
  includeInactiveConditions: boolean,
  signal?: AbortSignal,
): Promise<ConditionFile[]> {
  throwIfAborted(signal);

  const entries = await readDirectoryEntries(
    CONDITION_DIRECTORY,
    baseDirectory,
    signal,
  );

  const files: ConditionFile[] = [];

  for (const entry of entries) {
    throwIfAborted(signal);

    if (!isJsonFile(entry)) {
      continue;
    }

    const path =
      `${CONDITION_DIRECTORY}/${entry.name}`;

    try {
      const value = await readJsonFile(
        path,
        baseDirectory,
      );

      throwIfAborted(signal);

      const document = parseConditionDocument(
        value,
        entry.name,
      );

      const isActive =
        document.state === undefined ||
        document.state === "active";

      if (
        !includeInactiveConditions &&
        !isActive
      ) {
        continue;
      }

      files.push({
        fileName: entry.name,
        document,
      });
    } catch (error: unknown) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw error;
      }

      console.warn(
        `[Condition retrieval] Skipped "${entry.name}".`,
        error,
      );
    }
  }

  return files;
}

async function readPolicyFiles(
  baseDirectory: BaseDirectory,
  signal?: AbortSignal,
): Promise<PolicyFile[]> {
  throwIfAborted(signal);

  const entries = await readDirectoryEntries(
    POLICY_DIRECTORY,
    baseDirectory,
    signal,
  );

  const files: PolicyFile[] = [];

  for (const entry of entries) {
    throwIfAborted(signal);

    if (!isJsonFile(entry)) {
      continue;
    }

    const path =
      `${POLICY_DIRECTORY}/${entry.name}`;

    try {
      const value = await readJsonFile(
        path,
        baseDirectory,
      );

      throwIfAborted(signal);

      const document = parsePolicyDocument(
        value,
        entry.name,
      );

      files.push({
        fileName: entry.name,
        document,
      });
    } catch (error: unknown) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        throw error;
      }

      console.warn(
        `[Policy retrieval] Skipped "${entry.name}".`,
        error,
      );
    }
  }

  return files;
}

function validateOptions(
  threshold: number,
  maxConditions: number,
): void {
  if (
    !Number.isFinite(threshold) ||
    threshold < -1 ||
    threshold > 1
  ) {
    throw new Error(
      "similarityThreshold must be between -1 and 1.",
    );
  }

  if (
    !Number.isInteger(maxConditions) ||
    maxConditions < 1
  ) {
    throw new Error(
      "maxMatchedConditions must be a positive integer.",
    );
  }
}

function findMatchingConditions(
  userEmbedding: number[],
  conditionFiles: ConditionFile[],
  threshold: number,
  maxConditions: number,
): MatchedCondition[] {
  const embeddingItems: EmbeddingListItem[] = [];

  const conditionById =
    new Map<string, ConditionFile>();

  for (const conditionFile of conditionFiles) {
    const condition =
      conditionFile.document;

    if (conditionById.has(condition.id)) {
      console.warn(
        `[Condition retrieval] Duplicate condition ID ignored: ${condition.id}`,
      );

      continue;
    }

    if (
      condition.condition_embedding.length !==
      userEmbedding.length
    ) {
      console.warn(
        `[Condition retrieval] Incompatible embedding dimension: ${condition.id}`,
      );

      continue;
    }

    conditionById.set(
      condition.id,
      conditionFile,
    );

    embeddingItems.push({
      id: condition.id,
      embedding:
        condition.condition_embedding,
    });
  }

  if (embeddingItems.length === 0) {
    return [];
  }

  const comparison =
    textSimilarity.compareEmbeddingToList(
      userEmbedding,
      embeddingItems,
    );

  return comparison.matches
    .filter(
      (match) =>
        match.score >= threshold,
    )
    .sort(
      (left, right) =>
        right.score - left.score,
    )
    .slice(0, maxConditions)
    .map((match) => {
      const conditionFile =
        conditionById.get(match.id);

      if (!conditionFile) {
        throw new Error(
          `Condition "${match.id}" was not found.`,
        );
      }

      return {
        condition_id:
          conditionFile.document.id,
        file_name:
          conditionFile.fileName,
        similarity_score: match.score,
        policy_ids:
          conditionFile.document
            .atomic_policies
            .map(
              (policy) =>
                policy.policy_id,
            ),
      };
    });
}

function retrieveReferencedPolicies(
  matchedConditions: MatchedCondition[],
  policyFiles: PolicyFile[],
): RetrievedPolicy[] {
  const policyById =
    new Map<string, PolicyFile>();

  for (const file of policyFiles) {
    if (policyById.has(file.document.id)) {
      console.warn(
        `[Policy retrieval] Duplicate policy ID ignored: ${file.document.id}`,
      );

      continue;
    }

    policyById.set(
      file.document.id,
      file,
    );
  }

  const sourceConditionsByPolicyId =
    new Map<string, Set<string>>();

  for (const condition of matchedConditions) {
    for (const policyId of condition.policy_ids) {
      const conditionIds =
        sourceConditionsByPolicyId.get(
          policyId,
        ) ?? new Set<string>();

      conditionIds.add(
        condition.condition_id,
      );

      sourceConditionsByPolicyId.set(
        policyId,
        conditionIds,
      );
    }
  }

  const results: RetrievedPolicy[] = [];

  for (
    const [policyId, sourceConditionIds]
    of sourceConditionsByPolicyId
  ) {
    const policyFile =
      policyById.get(policyId);

    if (!policyFile) {
      console.warn(
        `[Policy retrieval] Policy not found: ${policyId}`,
      );

      continue;
    }

    const document =
      policyFile.document;

    results.push({
      policy_id: document.id,
      file_name: policyFile.fileName,
      atomic_policy:
        document.atomic_policy,
      title: document.title,
      activation_condition:
        document.activation_condition,
      instruction:
        document.instruction,
      constraints:
        document.constraints,
      success_criteria:
        document.success_criteria,
      embedding:
        document.embedding,
      source_condition_ids: [
        ...sourceConditionIds,
      ],
    });
  }

  return results;
}

function modelContentToString(
  content: unknown,
): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content ?? "");
  }

  return content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (
        isRecord(item) &&
        typeof item.text === "string"
      ) {
        return item.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function generatePromptWithLLM(
  userRequest: string,
  policies: RetrievedPolicy[],
  tier: LlmTier,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);

  const llm = await getAsyncLLM(tier);

  throwIfAborted(signal);

  const userPrompt =
    createMainAgentPolicyUserPrompt({
      userRequest,
      policies: policies.map(
        (policy) => ({
          instruction:
            policy.instruction,
          constraints:
            policy.constraints,
          successCriteria:
            policy.success_criteria,
        }),
      ),
    });

  const response = await llm.invoke(
    [
      new SystemMessage(
        MAIN_AGENT_POLICY_SYSTEM_PROMPT,
      ),
      new HumanMessage(userPrompt),
    ],
    {
      signal,
    },
  );

  throwIfAborted(signal);

  const generatedPrompt =
    modelContentToString(
      response.content,
    ).trim();

  if (!generatedPrompt) {
    throw new Error(
      "The language model returned an empty prompt.",
    );
  }

  return generatedPrompt;
}

export async function generateMainAgentPolicyPrompt(
  userRequest: string,
  options: GenerateMainAgentPolicyPromptOptions = {},
): Promise<GenerateMainAgentPolicyPromptResult> {
  const normalizedUserRequest =
    userRequest.trim();

  if (!normalizedUserRequest) {
    throw new Error(
      "userRequest cannot be empty.",
    );
  }

  const threshold =
    options.similarityThreshold ??
    DEFAULT_SIMILARITY_THRESHOLD;

  const maxConditions =
    options.maxMatchedConditions ??
    DEFAULT_MAX_MATCHED_CONDITIONS;

  const tier =
    options.llmTier ??
    DEFAULT_LLM_TIER;

  const baseDirectory =
    options.baseDirectory ??
    BaseDirectory.AppData;

  validateOptions(
    threshold,
    maxConditions,
  );

  throwIfAborted(
    options.abortSignal,
  );

  const userEmbedding =
    await textSimilarity.embedText(
      normalizedUserRequest,
    );

  throwIfAborted(
    options.abortSignal,
  );

  const conditionFiles =
    await readConditionFiles(
      baseDirectory,
      options.includeInactiveConditions ??
        false,
      options.abortSignal,
    );

  const matchedConditions =
    findMatchingConditions(
      userEmbedding,
      conditionFiles,
      threshold,
      maxConditions,
    );

  console.log(
    "[Main agent policy] Matched conditions:",
    matchedConditions,
  );

  if (matchedConditions.length === 0) {
    return {
      user_request:
        normalizedUserRequest,
      user_embedding:
        userEmbedding,
      matched_conditions: [],
      retrieved_policies: [],
      main_agent_prompt: null,
      should_create_condition: true,
      used_language_model: false,
    };
  }

  throwIfAborted(
    options.abortSignal,
  );

  const policyFiles =
    await readPolicyFiles(
      baseDirectory,
      options.abortSignal,
    );

  const retrievedPolicies =
    retrieveReferencedPolicies(
      matchedConditions,
      policyFiles,
    );

  console.log(
    "[Main agent policy] Retrieved policies:",
    retrievedPolicies,
  );

  if (retrievedPolicies.length === 0) {
    return {
      user_request:
        normalizedUserRequest,
      user_embedding:
        userEmbedding,
      matched_conditions:
        matchedConditions,
      retrieved_policies: [],
      main_agent_prompt: null,
      should_create_condition: false,
      used_language_model: false,
    };
  }

  throwIfAborted(
    options.abortSignal,
  );

  const mainAgentPrompt =
    await generatePromptWithLLM(
      normalizedUserRequest,
      retrievedPolicies,
      tier,
      options.abortSignal,
    );

  console.log(
    "[Main agent policy] Generated prompt:",
    mainAgentPrompt,
  );

  return {
    user_request:
      normalizedUserRequest,
    user_embedding:
      userEmbedding,
    matched_conditions:
      matchedConditions,
    retrieved_policies:
      retrievedPolicies,
    main_agent_prompt:
      mainAgentPrompt,
    should_create_condition: false,
    used_language_model: true,
  };
}