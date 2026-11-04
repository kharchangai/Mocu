import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";
import type { CancelledRunData } from "./cancelledRun";

export type CancelledRunRoute = "continue_cancelled_task" | "start_new_task";

type JevAnswer = {
  noul?: unknown;
  probabilities?: Record<string, unknown>;
};

function readContinueProbability(answer: JevAnswer | undefined): number | null {
  if (!answer || typeof answer !== "object") return null;
  const direct = Number(answer.noul);
  if (Number.isFinite(direct) && direct >= 0 && direct <= 1) return direct;
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== "object") return null;
  for (const key of ["true", "yes", "continue_cancelled_task"]) {
    const value = Number(probabilities[key]);
    if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
  }
  return null;
}

/** Ask Jev whether a fresh user message extends the cancelled task or starts another one. */
export async function routeMessageAfterCancelledRun(input: {
  cancelledRun: CancelledRunData;
  newUserMessage: string;
}): Promise<CancelledRunRoute> {
  const snapshot = input.cancelledRun.resumeSnapshot;
  const response = await getJevDecision({
    state: {
      cancelled_task: {
        original_request: snapshot?.originalUserPrompt ?? input.cancelledRun.userPrompt,
        latest_request: input.cancelledRun.userPrompt,
        partial_answer: input.cancelledRun.partialAnswer.slice(0, 4_000),
        completed_or_interrupted_tools: input.cancelledRun.tools.slice(0, 20),
      },
      new_user_message: input.newUserMessage.slice(0, 8_000),
    },
    questions: {
      continue_cancelled_task: {
        type: "noul",
        instructions:
          "Decide whether the user's new message is asking to continue, clarify, or add requirements to the cancelled task, rather than asking for a different independent task. Consider both the cancelled task and the new message. A different subject or a new standalone objective means start a new task.",
        criteria: {
          true: "The user wants the cancelled task to continue, and the new message adds context or requirements to that same task.",
          false: "The user has moved to a different or independent task and does not want the cancelled task continued.",
        },
      },
    },
  }) as { answers?: Record<string, JevAnswer> };

  const probability = readContinueProbability(response?.answers?.continue_cancelled_task);
  // Ambiguous/malformed decisions fail safe: do not unexpectedly carry the
  // cancelled task's prompt and tool context into a new request.
  return probability !== null && probability >= 0.65
    ? "continue_cancelled_task"
    : "start_new_task";
}