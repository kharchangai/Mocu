import {
  BaseDirectory,
  exists,
  mkdir,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type {
  StoredMainAgentPolicy,
} from "./mainAgentPolicySchema";

const FEEDBACK_MEMORIES_DIRECTORY =
  "feedback-memories";

const POLICY_DIRECTORY =
  `${FEEDBACK_MEMORIES_DIRECTORY}/policy`;

function throwIfAborted(
  signal: AbortSignal | undefined,
): void {
  if (signal?.aborted) {
    throw new DOMException(
      "Policy storage operation was aborted.",
      "AbortError",
    );
  }
}

async function ensurePolicyDirectory(
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  const directoryExists = await exists(
    POLICY_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  throwIfAborted(signal);

  if (directoryExists) {
    return;
  }

  await mkdir(
    POLICY_DIRECTORY,
    {
      baseDir:
        BaseDirectory.AppData,
      recursive: true,
    },
  );

  throwIfAborted(signal);
}

/**
 * Saves one main-agent policy as a JSON file.
 *
 * The policy ID is also used as the file name.
 */
export async function saveMainAgentPolicyFile(
  policy: StoredMainAgentPolicy,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  await ensurePolicyDirectory(signal);

  throwIfAborted(signal);

  const filePath =
    `${POLICY_DIRECTORY}/${policy.id}.json`;

  const serializedPolicy =
    JSON.stringify(
      policy,
      null,
      2,
    );

  await writeTextFile(
    filePath,
    serializedPolicy,
    {
      baseDir:
        BaseDirectory.AppData,
    },
  );

  throwIfAborted(signal);
}