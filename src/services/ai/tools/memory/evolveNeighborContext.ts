import {
  BaseDirectory,
  exists,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";

import type { MemoryNode } from "./enrichMemory";

const MEMORY_DIRECTORY = "memory";

export type MemoryRelationship =
  | "COMPLEMENTS"
  | "CONTRADICTS"
  | "RELATED"
  | "DUPLICATE";

export type MemoryLink = {
  targetId: string;
  targetFileName: string;
  relationship: MemoryRelationship;
  similarity: number;
  confidence: number;
  reason: string;
  createdAt: string;
};

export type MemoryNodeWithLinks = MemoryNode & {
  links?: MemoryLink[];
  lastSeenAt?: string;
  repetitionCount?: number;
};

export type EvolveNeighborContextResult =
  | {
      action: "SAVE_NEW";
      shouldSaveNewMemory: true;
      memory: MemoryNodeWithLinks;
      links: MemoryLink[];
      duplicateMemoryId: null;
      duplicateFileName: null;
    }
  | {
      action: "REUSE_EXISTING";
      shouldSaveNewMemory: false;
      memory: MemoryNodeWithLinks;
      links: MemoryLink[];
      duplicateMemoryId: string;
      duplicateFileName: string;
    };

type DuplicateCandidate = {
  link: MemoryLink;
  memory: MemoryNodeWithLinks;
  fileName: string;
};

function throwIfAborted(
  signal?: AbortSignal,
): void {
  if (signal?.aborted) {
    throw new DOMException(
      "The operation was cancelled.",
      "AbortError",
    );
  }
}

function isAbortError(
  error: unknown,
): boolean {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

/**
 * Prepares the memory graph for a new memory.
 *
 * If no readable duplicate exists, the caller must save the new memory.
 *
 * If a readable duplicate exists:
 * - The existing memory remains the canonical memory.
 * - The new memory must not be saved.
 * - No existing memory file is deleted.
 * - No references are redirected.
 * - The existing memory metadata is updated.
 * - Useful non-duplicate links are transferred to the existing memory.
 *
 * The caller must always inspect shouldSaveNewMemory before saving the
 * originally prepared memory.
 */
export async function evolveNeighborContext(
  memoryToSave: MemoryNodeWithLinks,
  signal?: AbortSignal,
): Promise<EvolveNeighborContextResult> {
  throwIfAborted(signal);
  validateMemoryId(memoryToSave.id);

  const originalLinks = Array.isArray(
    memoryToSave.links,
  )
    ? memoryToSave.links
    : [];

  const duplicateLinks = originalLinks.filter(
    (link) =>
      link.relationship === "DUPLICATE" &&
      isValidMemoryLink(link),
  );

  const nonDuplicateLinks =
    originalLinks.filter(
      (link) =>
        link.relationship !== "DUPLICATE" &&
        isValidMemoryLink(link),
    );

  if (duplicateLinks.length === 0) {
    return prepareNewMemoryResult(
      memoryToSave,
      nonDuplicateLinks,
    );
  }

  const duplicateCandidates =
    await readDuplicateCandidates(
      duplicateLinks,
      signal,
    );

  throwIfAborted(signal);

  if (duplicateCandidates.length === 0) {
    console.warn(
      "[Memory] Duplicate relationships were found, but no readable duplicate memory file was available. The new memory will be saved.",
    );

    return prepareNewMemoryResult(
      memoryToSave,
      nonDuplicateLinks,
    );
  }

  const canonicalCandidate =
    selectCanonicalDuplicate(
      duplicateCandidates,
    );

  const canonicalMemory =
    canonicalCandidate.memory;

  const canonicalFileName =
    canonicalCandidate.fileName;

  assertMemoryMatchesFileName(
    canonicalMemory,
    canonicalFileName,
  );

  const duplicateIds =
    collectDuplicateIds(
      duplicateCandidates,
    );

  const duplicateFileNames =
    collectDuplicateFileNames(
      duplicateCandidates,
    );

  const transferredLinks =
    collectTransferableLinks(
      memoryToSave,
      duplicateCandidates,
      canonicalMemory,
      canonicalFileName,
      duplicateIds,
      duplicateFileNames,
    );

  canonicalMemory.links =
    sanitizeLinksForMemory(
      [
        ...(canonicalMemory.links ?? []),
        ...transferredLinks,
      ],
      canonicalMemory.id,
      canonicalFileName,
    );

  updateDuplicateMetadata(
    canonicalMemory,
  );

  throwIfAborted(signal);

  await writeMemoryFile(
    canonicalFileName,
    canonicalMemory,
    signal,
  );

  throwIfAborted(signal);

  console.log(
    "[Memory] Existing duplicate memory reused.",
    {
      existingMemoryId: canonicalMemory.id,
      existingFileName:
        canonicalFileName,
      ignoredNewMemoryId:
        memoryToSave.id,
      repetitionCount:
        canonicalMemory.repetitionCount,
      lastSeenAt:
        canonicalMemory.lastSeenAt,
    },
  );

  return {
    action: "REUSE_EXISTING",
    shouldSaveNewMemory: false,
    memory: canonicalMemory,
    links: canonicalMemory.links ?? [],
    duplicateMemoryId:
      canonicalMemory.id,
    duplicateFileName:
      canonicalFileName,
  };
}

function prepareNewMemoryResult(
  memoryToSave: MemoryNodeWithLinks,
  links: MemoryLink[],
): EvolveNeighborContextResult {
  const fileName = createMemoryFileName(
    memoryToSave.id,
  );

  const finalLinks =
    sanitizeLinksForMemory(
      links,
      memoryToSave.id,
      fileName,
    );

  memoryToSave.links = finalLinks;

  return {
    action: "SAVE_NEW",
    shouldSaveNewMemory: true,
    memory: memoryToSave,
    links: finalLinks,
    duplicateMemoryId: null,
    duplicateFileName: null,
  };
}

async function readDuplicateCandidates(
  duplicateLinks: MemoryLink[],
  signal?: AbortSignal,
): Promise<DuplicateCandidate[]> {
  throwIfAborted(signal);

  const strongestLinkByFileName =
    new Map<string, MemoryLink>();

  for (const link of duplicateLinks) {
    throwIfAborted(signal);

    const safeFileName =
      getSafeMemoryFileName(
        link.targetFileName,
      );

    if (!safeFileName) {
      console.warn(
        "[Memory] A duplicate link with an invalid file name was ignored.",
        {
          targetId: link.targetId,
          targetFileName:
            link.targetFileName,
        },
      );

      continue;
    }

    const existingLink =
      strongestLinkByFileName.get(
        safeFileName,
      );

    if (
      !existingLink ||
      isLinkStronger(
        link,
        existingLink,
      )
    ) {
      strongestLinkByFileName.set(
        safeFileName,
        {
          ...link,
          targetFileName:
            safeFileName,
        },
      );
    }
  }

  const candidates: DuplicateCandidate[] =
    [];

  for (
    const [fileName, link] of
    strongestLinkByFileName.entries()
  ) {
    throwIfAborted(signal);

    try {
      const memory =
        await readMemoryFile(
          fileName,
          signal,
        );

      throwIfAborted(signal);

      if (
        link.targetId !== memory.id
      ) {
        console.error(
          "[Memory] The duplicate link ID does not match the memory ID stored in the target file.",
          {
            fileName,
            linkTargetId:
              link.targetId,
            storedMemoryId:
              memory.id,
          },
        );

        continue;
      }

      candidates.push({
        link,
        memory,
        fileName,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      console.error(
        `[Memory] Failed to read duplicate memory file "${fileName}".`,
        error,
      );
    }
  }

  return candidates;
}

function selectCanonicalDuplicate(
  candidates: DuplicateCandidate[],
): DuplicateCandidate {
  if (candidates.length === 0) {
    throw new Error(
      "No duplicate candidate was provided.",
    );
  }

  const sortedCandidates = [
    ...candidates,
  ].sort((first, second) => {
    const similarityDifference =
      normalizeNumber(
        second.link.similarity,
      ) -
      normalizeNumber(
        first.link.similarity,
      );

    if (
      similarityDifference !== 0
    ) {
      return similarityDifference;
    }

    const confidenceDifference =
      normalizeNumber(
        second.link.confidence,
      ) -
      normalizeNumber(
        first.link.confidence,
      );

    if (
      confidenceDifference !== 0
    ) {
      return confidenceDifference;
    }

    return first.fileName.localeCompare(
      second.fileName,
    );
  });

  return sortedCandidates[0];
}

function collectDuplicateIds(
  candidates: DuplicateCandidate[],
): Set<string> {
  const ids = new Set<string>();

  for (const candidate of candidates) {
    if (candidate.memory.id) {
      ids.add(candidate.memory.id);
    }

    if (candidate.link.targetId) {
      ids.add(
        candidate.link.targetId,
      );
    }
  }

  return ids;
}

function collectDuplicateFileNames(
  candidates: DuplicateCandidate[],
): Set<string> {
  const fileNames = new Set<string>();

  for (const candidate of candidates) {
    fileNames.add(candidate.fileName);

    const safeTargetFileName =
      getSafeMemoryFileName(
        candidate.link.targetFileName,
      );

    if (safeTargetFileName) {
      fileNames.add(
        safeTargetFileName,
      );
    }
  }

  return fileNames;
}

function collectTransferableLinks(
  newMemory: MemoryNodeWithLinks,
  duplicateCandidates: DuplicateCandidate[],
  canonicalMemory: MemoryNodeWithLinks,
  canonicalFileName: string,
  duplicateIds: Set<string>,
  duplicateFileNames: Set<string>,
): MemoryLink[] {
  const transferredLinks: MemoryLink[] =
    [];

  const newMemoryFileName =
    createMemoryFileName(
      newMemory.id,
    );

  for (
    const link of
    newMemory.links ?? []
  ) {
    if (
      shouldTransferLink(
        link,
        canonicalMemory.id,
        canonicalFileName,
        newMemory.id,
        newMemoryFileName,
        duplicateIds,
        duplicateFileNames,
      )
    ) {
      transferredLinks.push(link);
    }
  }

  for (
    const candidate of
    duplicateCandidates
  ) {
    const isCanonicalCandidate =
      candidate.memory.id ===
        canonicalMemory.id &&
      candidate.fileName ===
        canonicalFileName;

    if (isCanonicalCandidate) {
      continue;
    }

    for (
      const link of
      candidate.memory.links ?? []
    ) {
      if (
        shouldTransferLink(
          link,
          canonicalMemory.id,
          canonicalFileName,
          candidate.memory.id,
          candidate.fileName,
          duplicateIds,
          duplicateFileNames,
        )
      ) {
        transferredLinks.push(link);
      }
    }
  }

  return transferredLinks;
}

function shouldTransferLink(
  link: MemoryLink,
  canonicalMemoryId: string,
  canonicalFileName: string,
  sourceMemoryId: string,
  sourceFileName: string,
  duplicateIds: Set<string>,
  duplicateFileNames: Set<string>,
): boolean {
  if (!isValidMemoryLink(link)) {
    return false;
  }

  if (
    link.relationship === "DUPLICATE"
  ) {
    return false;
  }

  const safeTargetFileName =
    getSafeMemoryFileName(
      link.targetFileName,
    );

  if (!safeTargetFileName) {
    return false;
  }

  const pointsToCanonicalMemory =
    link.targetId ===
      canonicalMemoryId ||
    safeTargetFileName ===
      canonicalFileName;

  const pointsToSourceMemory =
    link.targetId === sourceMemoryId ||
    safeTargetFileName ===
      sourceFileName;

  const pointsToDuplicateMemory =
    duplicateIds.has(link.targetId) ||
    duplicateFileNames.has(
      safeTargetFileName,
    );

  return (
    !pointsToCanonicalMemory &&
    !pointsToSourceMemory &&
    !pointsToDuplicateMemory
  );
}

function updateDuplicateMetadata(
  memory: MemoryNodeWithLinks,
): void {
  const currentRepetitionCount =
    getCurrentRepetitionCount(
      memory.repetitionCount,
    );

  memory.repetitionCount =
    currentRepetitionCount + 1;

  memory.lastSeenAt =
    new Date().toISOString();
}

function getCurrentRepetitionCount(
  value: number | undefined,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1
  ) {
    return 1;
  }

  return Math.floor(value);
}

function sanitizeLinksForMemory(
  links: MemoryLink[],
  memoryId: string,
  memoryFileName: string,
): MemoryLink[] {
  const sanitizedLinks =
    links.filter((link) => {
      if (!isValidMemoryLink(link)) {
        return false;
      }

      if (
        link.relationship ===
        "DUPLICATE"
      ) {
        return false;
      }

      const safeTargetFileName =
        getSafeMemoryFileName(
          link.targetFileName,
        );

      if (!safeTargetFileName) {
        return false;
      }

      const pointsToItself =
        link.targetId === memoryId ||
        safeTargetFileName ===
          memoryFileName;

      return !pointsToItself;
    });

  return mergeMemoryLinks(
    sanitizedLinks,
  );
}

function mergeMemoryLinks(
  links: MemoryLink[],
): MemoryLink[] {
  const linksByTarget =
    new Map<string, MemoryLink>();

  for (const link of links) {
    if (!isValidMemoryLink(link)) {
      continue;
    }

    const safeTargetFileName =
      getSafeMemoryFileName(
        link.targetFileName,
      );

    if (!safeTargetFileName) {
      continue;
    }

    const normalizedLink: MemoryLink =
      {
        ...link,
        targetId:
          link.targetId.trim(),
        targetFileName:
          safeTargetFileName,
        similarity:
          normalizeNumber(
            link.similarity,
          ),
        confidence:
          normalizeNumber(
            link.confidence,
          ),
      };

    const targetKey =
      `${normalizedLink.targetId}::` +
      normalizedLink.targetFileName;

    const existingLink =
      linksByTarget.get(targetKey);

    if (
      !existingLink ||
      isLinkStronger(
        normalizedLink,
        existingLink,
      )
    ) {
      linksByTarget.set(
        targetKey,
        normalizedLink,
      );
    }
  }

  return [
    ...linksByTarget.values(),
  ].sort(compareMemoryLinks);
}

function isLinkStronger(
  candidate: MemoryLink,
  existing: MemoryLink,
): boolean {
  const candidateSimilarity =
    normalizeNumber(
      candidate.similarity,
    );

  const existingSimilarity =
    normalizeNumber(
      existing.similarity,
    );

  if (
    candidateSimilarity !==
    existingSimilarity
  ) {
    return (
      candidateSimilarity >
      existingSimilarity
    );
  }

  const candidateConfidence =
    normalizeNumber(
      candidate.confidence,
    );

  const existingConfidence =
    normalizeNumber(
      existing.confidence,
    );

  if (
    candidateConfidence !==
    existingConfidence
  ) {
    return (
      candidateConfidence >
      existingConfidence
    );
  }

  return (
    toTimestamp(
      candidate.createdAt,
    ) >
    toTimestamp(
      existing.createdAt,
    )
  );
}

function compareMemoryLinks(
  first: MemoryLink,
  second: MemoryLink,
): number {
  const idComparison =
    first.targetId.localeCompare(
      second.targetId,
    );

  if (idComparison !== 0) {
    return idComparison;
  }

  const fileNameComparison =
    first.targetFileName.localeCompare(
      second.targetFileName,
    );

  if (fileNameComparison !== 0) {
    return fileNameComparison;
  }

  return first.relationship.localeCompare(
    second.relationship,
  );
}

function isValidMemoryLink(
  link: MemoryLink,
): boolean {
  if (!link) {
    return false;
  }

  if (
    typeof link.targetId !==
      "string" ||
    !link.targetId.trim()
  ) {
    return false;
  }

  if (
    typeof link.targetFileName !==
      "string" ||
    !getSafeMemoryFileName(
      link.targetFileName,
    )
  ) {
    return false;
  }

  return isMemoryRelationship(
    link.relationship,
  );
}

function isMemoryRelationship(
  value: unknown,
): value is MemoryRelationship {
  return (
    value === "COMPLEMENTS" ||
    value === "CONTRADICTS" ||
    value === "RELATED" ||
    value === "DUPLICATE"
  );
}

function normalizeNumber(
  value: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return value;
}

function toTimestamp(
  value: string,
): number {
  if (typeof value !== "string") {
    return 0;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

async function readMemoryFile(
  fileName: string,
  signal?: AbortSignal,
): Promise<MemoryNodeWithLinks> {
  throwIfAborted(signal);

  const filePath =
    createMemoryFilePath(fileName);

  const fileExists = await exists(
    filePath,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  throwIfAborted(signal);

  if (!fileExists) {
    throw new Error(
      `Memory file does not exist: ${fileName}`,
    );
  }

  const fileContent =
    await readTextFile(filePath, {
      baseDir:
        BaseDirectory.AppData,
    });

  throwIfAborted(signal);

  let parsedValue: unknown;

  try {
    parsedValue =
      JSON.parse(fileContent);
  } catch {
    throw new Error(
      `Memory file contains invalid JSON: ${fileName}`,
    );
  }

  if (
    !parsedValue ||
    typeof parsedValue !== "object" ||
    Array.isArray(parsedValue)
  ) {
    throw new Error(
      `Memory file contains an invalid memory object: ${fileName}`,
    );
  }

  const memory =
    parsedValue as MemoryNodeWithLinks;

  if (
    typeof memory.id !== "string" ||
    !memory.id.trim()
  ) {
    throw new Error(
      `Memory file contains an invalid memory ID: ${fileName}`,
    );
  }

  validateMemoryId(memory.id);

  if (
    memory.links !== undefined &&
    !Array.isArray(memory.links)
  ) {
    console.warn(
      `[Memory] Invalid links were removed from memory file "${fileName}".`,
    );

    memory.links = [];
  }

  return memory;
}

async function writeMemoryFile(
  fileName: string,
  memory: MemoryNodeWithLinks,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  const filePath =
    createMemoryFilePath(fileName);

  const serializedMemory =
    JSON.stringify(
      memory,
      null,
      2,
    );

  await writeTextFile(
    filePath,
    serializedMemory,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  throwIfAborted(signal);
}

function assertMemoryMatchesFileName(
  memory: MemoryNodeWithLinks,
  fileName: string,
): void {
  const expectedFileName =
    createMemoryFileName(
      memory.id,
    );

  if (
    expectedFileName !== fileName
  ) {
    throw new Error(
      `Memory ID and file name do not match. Expected "${expectedFileName}", received "${fileName}".`,
    );
  }
}

function validateMemoryId(
  memoryId: string,
): void {
  if (
    typeof memoryId !== "string" ||
    !memoryId.trim()
  ) {
    throw new Error(
      "Memory ID is invalid.",
    );
  }

  const normalizedMemoryId =
    memoryId.trim();

  if (
    normalizedMemoryId.includes("/") ||
    normalizedMemoryId.includes("\\") ||
    normalizedMemoryId === "." ||
    normalizedMemoryId === ".."
  ) {
    throw new Error(
      "Memory ID contains invalid characters.",
    );
  }
}

function createMemoryFileName(
  memoryId: string,
): string {
  validateMemoryId(memoryId);

  return `${memoryId.trim()}.json`;
}

function getSafeMemoryFileName(
  fileName: string,
): string | null {
  if (
    typeof fileName !== "string" ||
    !fileName.trim()
  ) {
    return null;
  }

  const trimmedFileName =
    fileName.trim();

  const extractedFileName =
    trimmedFileName
      .split(/[\\/]/)
      .pop();

  if (
    !extractedFileName ||
    extractedFileName !==
      trimmedFileName ||
    !extractedFileName.endsWith(
      ".json",
    ) ||
    extractedFileName === ".json"
  ) {
    return null;
  }

  return extractedFileName;
}

function createMemoryFilePath(
  fileName: string,
): string {
  const safeFileName =
    getSafeMemoryFileName(
      fileName,
    );

  if (!safeFileName) {
    throw new Error(
      "Memory file name is invalid.",
    );
  }

  return `${MEMORY_DIRECTORY}/${safeFileName}`;
}