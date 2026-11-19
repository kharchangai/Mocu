// Run-scoped buffer for world-model episodes.
//
// handActionToWorldModel only sees isolated request/response pairs; it has
// no idea which agent run they belong to. This module adds that missing
// context: an agent run calls startEpisodeRun() once, every COMPLETED tool
// step (request + matching response joined by callId) is buffered as one
// episode, and after the whole agent run finishes, flushEpisodeRun()
// persists every buffered episode to the global SQLite database in one
// batch (episodeStore.saveEpisodeRecords).
//
// Buffering instead of writing per-call keeps the agent loop untouched and
// matches the agreed unit: one full agent run = one flush, one row per
// tool step. All methods swallow their own errors so evolution logging can
// never break or slow down the agent, mirroring GraphRecorder.

import { saveEpisodeRecords, type SaveEpisodesResult } from "./episodeStore";

export type BufferedEpisode = {
  step: number;
  callId: string;
  tool: string;
  args?: Record<string, unknown>;
  ok: boolean;
  result?: string;
  error?: string;
};

export type EpisodeGuidanceUse = {
  step: number;
  callId: string;
  lessonIds: number[];
};

export type EpisodeRunRecorder = {
  readonly runId: string;
  /** Add one completed request/response pair (a finished tool step). */
  addEpisode: (episode: BufferedEpisode) => void;
  /** Persist every buffered episode of this run; idempotent per callId. */
  flush: () => Promise<SaveEpisodesResult>;
  /** Immutable snapshot for post-run analysis before flush. */
  getEpisodes: () => BufferedEpisode[];
  /** Record which persisted lessons were shown to the agent for a call. */
  recordGuidanceUse: (use: EpisodeGuidanceUse) => void;
  /** Post-run analysis inputs. */
  getGuidanceUses: () => EpisodeGuidanceUse[];
  /** Number of episodes currently buffered (flushed ones are dropped). */
  size: () => number;
};

let runCounter = 0;

export const createEpisodeRunRecorder = (options: { projectPath?: string; runId?: string } = {}): EpisodeRunRecorder => {
  const runId =
    options.runId ??
    `evorun-${Date.now().toString(36)}-${(runCounter += 1)}`;
  const buffered = new Map<string, BufferedEpisode>();
  const guidanceUses = new Map<string, EpisodeGuidanceUse>();

  return {
    runId,
    addEpisode(episode: BufferedEpisode): void {
      if (!episode.callId) return;
      buffered.set(episode.callId, episode);
    },
    async flush(): Promise<SaveEpisodesResult> {
      if (buffered.size === 0) return { saved: 0, skipped: 0 };
      const episodes = [...buffered.values()].map((episode) => ({
        runId,
        ...(options.projectPath ? { project: options.projectPath } : {}),
        step: episode.step,
        callId: episode.callId,
        tool: episode.tool,
        ...(episode.args !== undefined ? { args: episode.args } : {}),
        ok: episode.ok,
        ...(episode.result !== undefined ? { result: episode.result } : {}),
        ...(episode.error !== undefined ? { error: episode.error } : {}),
      }));
      try {
        const result = await saveEpisodeRecords(episodes);
        if (!result.error) buffered.clear();
        return result;
      } catch (error) {
        console.warn("[Episode Recorder] Flushing episodes failed:", error);
        return { saved: 0, skipped: 0, error: error instanceof Error ? error.message : String(error) };
      }
    },
    getEpisodes(): BufferedEpisode[] {
      return [...buffered.values()].map((episode) => ({ ...episode }));
    },
    recordGuidanceUse(use: EpisodeGuidanceUse): void {
      if (!use.callId || use.lessonIds.length === 0) return;
      guidanceUses.set(use.callId, { ...use, lessonIds: [...new Set(use.lessonIds)] });
    },
    getGuidanceUses(): EpisodeGuidanceUse[] {
      return [...guidanceUses.values()].map((use) => ({ ...use, lessonIds: [...use.lessonIds] }));
    },
    size(): number {
      return buffered.size;
    },
  };
};



