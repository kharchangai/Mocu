import { ChatPromptTemplate } from "@langchain/core/prompts";
import {
  BaseDirectory,
  exists,
  readDir,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { getAsyncLLM } from "../../../llm";
import {
  textSimilarity,
  type EmbeddingListItem,
} from "../../textSimilarity";
import {
  AtomicPolicyModelResultSchema,
  type AtomicPolicyModelResult,
} from "./atomicPolicySchema";
import {
  ATOMIC_POLICY_SYSTEM_PROMPT,
  buildAtomicPolicyUserPrompt,
  type BuildAtomicPolicyPromptInput,
} from "./atomicPolicyPrompt";

const POLICY_DIRECTORY_PATH =
  "feedback-memories/policy";

const POLICY_SIMILARITY_THRESHOLD = 0.8;

export interface GenerateAtomicPolicyInput
  extends BuildAtomicPolicyPromptInput {
  signal?: AbortSignal;
}

export type AtomicPolicyMatch = {
  policy: string;
  policy_id: string | false;
};

export type GenerateAtomicPolicyResult = {
  atomic_policies: AtomicPolicyMatch[];
};

type StoredPolicyEmbedding = {
  id: string;
  embedding: number[];
};

type UnknownRecord = Record<string, unknown>;

function throwIfAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new DOMException(
      "Atomic policy generation was aborted.",
      "AbortError",
    );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function normalizeAtomicPolicies(
  atomicPolicies: string[],
): string[] {
  const uniquePolicies = new Map<string, string>();

  for (const atomicPolicy of atomicPolicies) {
    const normalizedPolicy = atomicPolicy
      .trim()
      .replace(/\s+/g, " ");

    if (!normalizedPolicy) {
      continue;
    }

    const comparisonKey =
      normalizedPolicy.toLocaleLowerCase();

    if (!uniquePolicies.has(comparisonKey)) {
      uniquePolicies.set(
        comparisonKey,
        normalizedPolicy,
      );
    }
  }

  return Array.from(uniquePolicies.values());
}

function isJsonFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".json");
}

function joinRelativePath(
  parentPath: string,
  childName: string,
): string {
  const normalizedParentPath = parentPath.replace(
    /\/+$/,
    "",
  );

  const normalizedChildName = childName.replace(
    /^\/+/,
    "",
  );

  return `${normalizedParentPath}/${normalizedChildName}`;
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

function getStringValue(
  record: UnknownRecord,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === "string" &&
      value.trim().length > 0
    ) {
      return value.trim();
    }
  }

  return null;
}

function getEmbeddingValue(
  record: UnknownRecord,
): number[] | null {
  const directCandidates = [
    record.embedding,
    record.policyEmbedding,
    record.policy_embedding,
    record.combined_embedding,
  ];

  for (const candidate of directCandidates) {
    if (isValidEmbedding(candidate)) {
      return candidate;
    }
  }

  const nestedCandidates = [
    record.policy,
    record.data,
    record.memory,
  ];

  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const nestedEmbedding =
      getEmbeddingValue(candidate);

    if (nestedEmbedding) {
      return nestedEmbedding;
    }
  }

  return null;
}

function parseStoredPolicyEmbedding(
  value: unknown,
): StoredPolicyEmbedding | null {
  if (!isRecord(value)) {
    return null;
  }

  const directId = getStringValue(value, [
    "id",
    "policyId",
    "policy_id",
  ]);

  const directEmbedding =
    getEmbeddingValue(value);

  if (directId && directEmbedding) {
    return {
      id: directId,
      embedding: directEmbedding,
    };
  }

  const nestedCandidates = [
    value.policy,
    value.data,
    value.memory,
  ];

  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const nestedPolicy =
      parseStoredPolicyEmbedding(candidate);

    if (nestedPolicy) {
      return nestedPolicy;
    }
  }

  return null;
}

function extractStoredPolicyEmbeddings(
  value: unknown,
): StoredPolicyEmbedding[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      extractStoredPolicyEmbeddings(item),
    );
  }

  if (!isRecord(value)) {
    return [];
  }

  const directPolicy =
    parseStoredPolicyEmbedding(value);

  if (directPolicy) {
    return [directPolicy];
  }

  const collectionKeys = [
    "policies",
    "atomic_policies",
    "items",
    "memories",
  ];

  for (const key of collectionKeys) {
    const collection = value[key];

    if (Array.isArray(collection)) {
      return collection.flatMap((item) =>
        extractStoredPolicyEmbeddings(item),
      );
    }
  }

  return [];
}

/**
 * Recursively collects JSON files from the policy directory.
 * Every path is relative to BaseDirectory.AppData.
 */
async function collectJsonFilePaths(
  directoryPath: string,
  signal?: AbortSignal,
): Promise<string[]> {
  throwIfAborted(signal);

  let directoryExists: boolean;

  try {
    directoryExists = await exists(
      directoryPath,
      {
        baseDir: BaseDirectory.AppData,
      },
    );
  } catch (error) {
    throw new Error(
      `Failed to check policy directory "${directoryPath}": ${getErrorMessage(error)}`,
    );
  }

  throwIfAborted(signal);

  if (!directoryExists) {
    return [];
  }

  let entries: Awaited<ReturnType<typeof readDir>>;

  try {
    entries = await readDir(directoryPath, {
      baseDir: BaseDirectory.AppData,
    });
  } catch (error) {
    throw new Error(
      `Failed to read policy directory "${directoryPath}": ${getErrorMessage(error)}`,
    );
  }

  const filePaths: string[] = [];

  for (const entry of entries) {
    throwIfAborted(signal);

    const entryPath = joinRelativePath(
      directoryPath,
      entry.name,
    );

    if (entry.isDirectory) {
      const nestedFilePaths =
        await collectJsonFilePaths(
          entryPath,
          signal,
        );

      filePaths.push(...nestedFilePaths);
      continue;
    }

    if (
      entry.isFile &&
      isJsonFile(entry.name)
    ) {
      filePaths.push(entryPath);
    }
  }

  return filePaths;
}

/**
 * Reads one policy file and extracts its policy embeddings.
 * Invalid files are skipped without interrupting other files.
 */
async function readStoredPoliciesFromFile(
  filePath: string,
  signal?: AbortSignal,
): Promise<StoredPolicyEmbedding[]> {
  throwIfAborted(signal);

  try {
    const fileContent = await readTextFile(
      filePath,
      {
        baseDir: BaseDirectory.AppData,
      },
    );

    throwIfAborted(signal);

    const parsedFile: unknown =
      JSON.parse(fileContent);

    const storedPolicies =
      extractStoredPolicyEmbeddings(parsedFile);

    if (storedPolicies.length === 0) {
      console.warn(
        `Skipping policy file without a valid policy ID and embedding: ${filePath}`,
      );
    }

    return storedPolicies;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    console.warn(
      `Failed to process policy file "${filePath}":`,
      error,
    );

    return [];
  }
}

/**
 * Loads all unique policy embeddings stored in AppData.
 */
async function readStoredPolicyEmbeddings(
  signal?: AbortSignal,
): Promise<EmbeddingListItem[]> {
  throwIfAborted(signal);

  const filePaths = await collectJsonFilePaths(
    POLICY_DIRECTORY_PATH,
    signal,
  );

  if (filePaths.length === 0) {
    return [];
  }

  const loadedPolicyGroups = await Promise.all(
    filePaths.map((filePath) =>
      readStoredPoliciesFromFile(
        filePath,
        signal,
      ),
    ),
  );

  throwIfAborted(signal);

  const policiesById = new Map<
    string,
    StoredPolicyEmbedding
  >();

  for (const storedPolicies of loadedPolicyGroups) {
    for (const storedPolicy of storedPolicies) {
      if (!policiesById.has(storedPolicy.id)) {
        policiesById.set(
          storedPolicy.id,
          storedPolicy,
        );
      }
    }
  }

  return Array.from(policiesById.values());
}

/**
 * Keeps only stored embeddings with the same dimensions as
 * the generated policy embedding.
 */
function filterCompatibleEmbeddings(
  sourceEmbedding: number[],
  storedEmbeddings: EmbeddingListItem[],
): EmbeddingListItem[] {
  return storedEmbeddings.filter(
    (storedPolicy) =>
      storedPolicy.embedding.length ===
      sourceEmbedding.length,
  );
}

/**
 * Embeds each generated policy and returns either the best
 * matching stored policy ID or false.
 */
async function findPolicyMatches(
  atomicPolicies: string[],
  storedPolicyEmbeddings: EmbeddingListItem[],
  signal?: AbortSignal,
): Promise<AtomicPolicyMatch[]> {
  const matchedPolicies: AtomicPolicyMatch[] = [];

  for (const atomicPolicy of atomicPolicies) {
    throwIfAborted(signal);

    const generatedEmbedding =
      await textSimilarity.embedText(
        atomicPolicy,
      );

    throwIfAborted(signal);

    const compatibleStoredEmbeddings =
      filterCompatibleEmbeddings(
        generatedEmbedding,
        storedPolicyEmbeddings,
      );

    if (
      compatibleStoredEmbeddings.length === 0
    ) {
      matchedPolicies.push({
        policy: atomicPolicy,
        policy_id: false,
      });

      continue;
    }

    const comparison =
      textSimilarity.compareEmbeddingToList(
        generatedEmbedding,
        compatibleStoredEmbeddings,
      );

    const bestMatch = comparison.bestMatch;

    if (
      bestMatch !== null &&
      bestMatch.score >
        POLICY_SIMILARITY_THRESHOLD
    ) {
      matchedPolicies.push({
        policy: atomicPolicy,
        policy_id: bestMatch.id,
      });

      continue;
    }

    matchedPolicies.push({
      policy: atomicPolicy,
      policy_id: false,
    });
  }

  return matchedPolicies;
}

/**
 * Generates reusable atomic policies and matches each policy
 * against policy embeddings stored in AppData.
 */
export async function generateAtomicPolicy(
  input: GenerateAtomicPolicyInput,
): Promise<GenerateAtomicPolicyResult> {
  throwIfAborted(input.signal);

  const llm = await getAsyncLLM("medium");

  throwIfAborted(input.signal);

  const structuredLlm =
    llm.withStructuredOutput(
      AtomicPolicyModelResultSchema,
    );

  const prompt =
    ChatPromptTemplate.fromMessages([
      [
        "system",
        ATOMIC_POLICY_SYSTEM_PROMPT,
      ],
      [
        "human",
        "{userPrompt}",
      ],
    ]);

  const chain = prompt.pipe(structuredLlm);

  const response: AtomicPolicyModelResult =
    await chain.invoke(
      {
        userPrompt:
          buildAtomicPolicyUserPrompt(input),
      },
      {
        signal: input.signal,
      },
    );

  throwIfAborted(input.signal);

  const validationResult =
    AtomicPolicyModelResultSchema.safeParse(
      response,
    );

  if (!validationResult.success) {
    throw new Error(
      `Atomic policy output validation failed: ${validationResult.error.message}`,
    );
  }

  const normalizedPolicies =
    normalizeAtomicPolicies(
      validationResult.data.atomic_policies,
    );

  if (normalizedPolicies.length === 0) {
    return {
      atomic_policies: [],
    };
  }

  const storedPolicyEmbeddings =
    await readStoredPolicyEmbeddings(
      input.signal,
    );

  throwIfAborted(input.signal);

  const policyMatches =
    await findPolicyMatches(
      normalizedPolicies,
      storedPolicyEmbeddings,
      input.signal,
    );

  throwIfAborted(input.signal);

  return {
    atomic_policies: policyMatches,
  };
}