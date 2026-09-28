import { getJevDecision } from "../services/ai/tools/decision/Jev_model";

/**
 * Decides whether a user request needs the full system path (examining file
 * structure, searching, or using various tools) rather than a simple path
 * (such as a greeting or using one simple tool like scheduling).
 *
 * JEV only makes this yes/no routing decision; it does not select tools or
 * generate the response shown to the user.
 */
export async function shouldRouteToGraphSystem(
  userMessage: string,
): Promise<boolean> {
  const message = userMessage.trim();

  if (!message) {
    return false;
  }

  const result: unknown = await getJevDecision({
    state: { userMessage: message },
    questions: {
      useGraphSystem: {
        type: "noul",
        instructions:
          "Does the user's request require complex work such as examining file structure, searching, or using various tools? Answer yes if so. Answer no if the request is simple, such as a greeting or using a single simple tool like scheduling.",
        criteria: {
          true: "The request requires examining file structure, searching, or using various tools.",
          false: "The request is simple, such as a greeting or using a single simple tool like scheduling.",
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

  return probability >= 0.5;
}
