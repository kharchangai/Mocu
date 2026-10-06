import { getJevDecision } from "../services/ai/tools/decision/Jev_model";

/** Decide whether a user request is substantive enough to keep as a reusable run graph. */
export async function shouldRouteToGraphSystem(userMessage: string): Promise<boolean> {
  const message = userMessage.trim();
  if (!message) return false;

  const result: unknown = await getJevDecision({
    state: { userMessage: message },
    questions: {
      useGraphSystem: {
        type: "noul",
        instructions:
          "Is this a substantive user request that could be useful to remember for a similar future task? Answer yes for research, project exploration, implementation, multi-step work, meaningful tool use, or a request likely to benefit from prior context. Answer no only for greetings, trivial one-off exchanges, or simple actions with no likely reuse.",
        criteria: {
          true: "The request is substantive or may benefit from a similar prior run, even when the actual work is short.",
          false: "The request is clearly trivial, such as a greeting or a simple isolated action with no reusable value.",
        },
      },
    },
  });

  if (!result || typeof result !== "object" || !("answers" in result)) {
    throw new Error("JEV returned an unexpected decision response.");
  }
  const answers = (result as { answers?: unknown }).answers;
  if (!answers || typeof answers !== "object" || !("useGraphSystem" in answers)) {
    throw new Error("JEV response is missing the graph-system decision.");
  }
  const answer = (answers as Record<string, unknown>).useGraphSystem;
  if (!answer || typeof answer !== "object" || !("noul" in answer)) {
    throw new Error("JEV returned an invalid yes/no graph-system decision.");
  }
  const probability = (answer as { noul?: unknown }).noul;
  if (typeof probability !== "number" || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("JEV returned an invalid yes probability.");
  }
  return probability >= 0.35;
}
