/**
 * Temporary world-model hook.
 * Logs the request, and logs the response when the caller hands it back.
 * Requests are held by callId so the matching response can be logged beside it.
 * No prediction, no validation, no memory - nothing else for now.
 *
 * Persistence: when the caller passes an episodeRecorder, every COMPLETED
 * step (response joined with its request by callId) is buffered as one
 * episode under that recorder's runId. The recorder's flush() is called by
 * the agent AFTER the whole run finishes, so each agent run lands in the
 * global database as one batch. Passing no recorder keeps the old
 * log-only behavior, and recorder failures never break the handoff.
 */

import type { EpisodeRunRecorder } from "./episodeRecorder";

export interface WorldModelHandoff {
  phase: "request" | "response";
  callId?: string;
  [key: string]: unknown;
}

const pendingRequests = new Map<string, WorldModelHandoff>();

export async function handActionToWorldModel(
  payload: WorldModelHandoff,
  episodeRecorder?: EpisodeRunRecorder,
): Promise<void> {
  if (payload.phase === "request") {
    if (payload.callId) pendingRequests.set(payload.callId, payload);
    console.log("[World Model] request", payload);
    return;
  }

  const request = payload.callId ? pendingRequests.get(payload.callId) : undefined;
  if (payload.callId) pendingRequests.delete(payload.callId);
  console.log("[World Model] response", { callId: payload.callId, request, response: payload });

  if (episodeRecorder && request) {
    try {
      episodeRecorder.addEpisode({
        step: typeof request.step === "number" ? request.step : 0,
        callId: payload.callId ?? "",
        tool: typeof request.tool === "string" ? request.tool : (typeof payload.tool === "string" ? payload.tool : "unknown"),
        ...(request.args !== undefined ? { args: request.args as Record<string, unknown> } : {}),
        ok: payload.ok === true,
        ...(payload.result !== undefined ? { result: typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result) } : {}),
        ...(payload.error !== undefined ? { error: typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error) } : {}),
      });
    } catch (error) {
      console.warn("[World Model] Buffering episode failed:", error);
    }
  }
}
