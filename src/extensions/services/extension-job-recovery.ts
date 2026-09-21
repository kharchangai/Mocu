/*
 * Recovery of extension commands that were still running when the webview
 * reloaded or the app restarted.
 *
 * Flow:
 *   1. `extension-agent-tools` registers a pending job (with the owning
 *      chat id) before every agent-initiated extension command and removes
 *      it as soon as the command settles normally.
 *   2. If the webview reloads mid-command, the pending record survives in
 *      localStorage while the extension process keeps running on the Rust
 *      side, which persists the job state (`extension-jobs.json`).
 *   3. On the next app start `startExtensionJobRecovery` polls the Rust job
 *      store until each job finishes, formats the result, and stores it as
 *      a recovered message for its conversation.
 *   4. `consumeRecoveredMessages` (called by the chat page whenever the
 *      conversation list changes) appends the recovered message to any
 *      conversation whose last message is still an unanswered user message.
 */

import { invoke } from "@tauri-apps/api/core";

import { normalizeExtensionOutput } from "./extension-agent-loader";

import {
  loadPendingExtensionJobs,
  removePendingExtensionJob,
  type PendingExtensionJob,
} from "./extension-job-store";

const RECOVERED_STORAGE_KEY = "mocu.recovered_extension_jobs";

const POLL_INTERVAL_MS = 5_000;

/*
 * Stop polling after 30 minutes. A job still running by then is most likely
 * stuck; the pending record is dropped rather than polling forever.
 */
const MAX_POLL_DURATION_MS = 30 * 60 * 1_000;

export type RecoveredExtensionMessage = {
  jobId: string;
  chatId: string;
  content: string;
  recoveredAt: string;
};

type JobStatusPayload = {
  jobId: string;
  status: "running" | "completed" | "failed" | "timeout";
  result?: unknown;
  error?: string;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

function loadRecovered(): RecoveredExtensionMessage[] {
  try {
    const raw = window.localStorage.getItem(RECOVERED_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed)
      ? (parsed as RecoveredExtensionMessage[])
      : [];
  } catch {
    return [];
  }
}

function saveRecovered(messages: RecoveredExtensionMessage[]): void {
  /*
   * React StrictMode mounts effects twice in dev, which can start two
   * recovery passes for the same pending job. De-duplicate by job id so a
   * recovered result is never stored (and later appended) twice.
   */
  const seen = new Set<string>();

  const deduped = messages.filter((message) => {
    if (seen.has(message.jobId)) {
      return false;
    }

    seen.add(message.jobId);

    return true;
  });

  try {
    if (deduped.length === 0) {
      window.localStorage.removeItem(RECOVERED_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        RECOVERED_STORAGE_KEY,
        JSON.stringify(deduped),
      );
    }
  } catch {
    /* best effort */
  }

  /*
   * Recovery can finish minutes after startup (the extension keeps
   * running). Let the chat page know so it re-checks the conversations.
   */
  window.dispatchEvent(new Event("mocu_extension_jobs_recovered"));
}

function formatRecoveredContent(job: PendingExtensionJob, payload: JobStatusPayload): string {
  let outcome: string;

  if (payload.status === "completed") {
    outcome = normalizeExtensionOutput(payload.result);
  } else if (payload.status === "timeout") {
    outcome =
      "The extension command timed out before it finished. " +
      (payload.error ?? "").trim();
  } else {
    outcome =
      "The extension command failed: " +
      (payload.error ?? "unknown error").trim();
  }

  return [
    "> 🔁 **Recovered automatically** — the app restarted while this " +
      "extension command was still running, so its result was restored " +
      "here instead of being lost.",
    "",
    outcome,
    "",
    `_(extension \`${job.extensionId}\`, command \`${job.command}\`)_`,
  ].join("\n");
}

async function pollJobUntilFinished(
  job: PendingExtensionJob,
): Promise<JobStatusPayload | null> {
  const startedAt = Date.now();

  for (;;) {
    try {
      const payload = await invoke<JobStatusPayload | null>(
        "extension_job_status",
        { jobId: job.jobId },
      );

      if (!payload) {
        /*
         * Unknown job (store cleared, or a record from before this
         * feature existed). Nothing to recover.
         */
        return null;
      }

      if (payload.status !== "running") {
        return payload;
      }
    } catch (error) {
      console.error(
        `[Extension Recovery] Failed to query job ${job.jobId}:`,
        error,
      );

      return null;
    }

    if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
      console.warn(
        `[Extension Recovery] Job ${job.jobId} still running after ` +
          `${Math.round(MAX_POLL_DURATION_MS / 60_000)} minutes; giving up.`,
      );

      return null;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function startExtensionJobRecovery(): () => void {
  let cancelled = false;

  const run = async (): Promise<void> => {
    const pending = loadPendingExtensionJobs();

    for (const job of pending) {
      if (cancelled) {
        return;
      }

      removePendingExtensionJob(job.jobId);

      if (!job.chatId) {
        continue;
      }

      const payload = await pollJobUntilFinished(job);

      if (cancelled) {
        return;
      }

      if (!payload) {
        continue;
      }

      const recovered: RecoveredExtensionMessage[] = [
        ...loadRecovered(),
        {
          jobId: job.jobId,
          chatId: job.chatId,
          content: formatRecoveredContent(job, payload),
          recoveredAt: new Date().toISOString(),
        },
      ];

      saveRecovered(recovered);
    }
  };

  void run().catch((error) => {
    console.error("[Extension Recovery] Failed:", error);
  });

  return () => {
    cancelled = true;
  };
}

export type ConsumableRecoveredMessage = {
  chatId: string;
  content: string;
};

/**
 * Returns recovered messages whose conversation exists and still ends with
 * an unanswered user message, and removes them from the store. Everything
 * else (unknown chat, already answered) is discarded.
 */
export function consumeRecoveredMessages(
  chats: Array<{
    id: string;
    messages: Array<{ role: string }>;
  }>,
): ConsumableRecoveredMessage[] {
  const recovered = loadRecovered();

  if (recovered.length === 0) {
    return [];
  }

  const consumable: ConsumableRecoveredMessage[] = [];

  for (const message of recovered) {
    const chat = chats.find((entry) => entry.id === message.chatId);
    const lastMessage = chat?.messages[chat.messages.length - 1];

    if (chat && lastMessage?.role === "user") {
      consumable.push({
        chatId: message.chatId,
        content: message.content,
      });
    }

    /*
     * Both consumed and non-appendable messages are dropped: an already
     * answered conversation must not get a duplicate response later.
     */
  }

  if (recovered.length > 0) {
    saveRecovered([]);
  }

  return consumable;
}
