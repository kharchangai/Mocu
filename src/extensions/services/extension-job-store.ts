/*
 * Frontend-side tracking of agent-initiated extension commands ("jobs").
 *
 * Long extension commands (e.g. the pi bridge `ask`) outlive individual
 * render cycles and can outlive the webview itself: a dev-server reload or
 * an app restart kills the running agent loop even though the extension
 * process keeps running on the Rust side.
 *
 * Before invoking such a command we store a small pending-job record here.
 * On the next app start the recovery service (`extension-job-recovery.ts`)
 * polls the Rust job store (`extension_job_status`) until the job finishes
 * and routes the result back into the conversation that started it.
 */

const STORAGE_KEY = "mocu.pending_extension_jobs";

export type PendingExtensionJob = {
  jobId: string;
  /** Conversation the recovered result should be appended to. */
  chatId: string | null;
  extensionId: string;
  command: string;
  startedAt: string;
};

export function createExtensionJobId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `job_${crypto.randomUUID()}`;
  }

  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function loadPendingExtensionJobs(): PendingExtensionJob[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? (parsed as PendingExtensionJob[]) : [];
  } catch {
    return [];
  }
}

export function savePendingExtensionJobs(
  jobs: PendingExtensionJob[],
): void {
  try {
    if (jobs.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    }
  } catch {
    /*
     * localStorage may be unavailable (quota, privacy mode). Recovery is a
     * best-effort safety net; never let it break a live tool call.
     */
  }
}

export function registerPendingExtensionJob(
  job: PendingExtensionJob,
): void {
  const jobs = loadPendingExtensionJobs().filter(
    (entry) => entry.jobId !== job.jobId,
  );

  jobs.push(job);
  savePendingExtensionJobs(jobs);
}

export function removePendingExtensionJob(jobId: string): void {
  savePendingExtensionJobs(
    loadPendingExtensionJobs().filter((entry) => entry.jobId !== jobId),
  );
}
