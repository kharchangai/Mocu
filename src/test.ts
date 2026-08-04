import { analyzeFeedback } from "./services/ai/tools/personalMemory/memory/analyzeMemoryContext";

export async function runTest(): Promise<void> {
  const userMessage =
    "Please translate this scientific article for me.";

  const agentResponse =
    "I translated the article into Persian using general language knowledge.";

  const userFeedback =
    "The translation is not reliable enough. When translating scientific articles, you should search credible scientific sources when necessary to verify specialized terminology, concepts, abbreviations, and referenced information so the translation remains scientifically accurate.";

  const testInput = {
    user_request: userMessage,
    agent_response: agentResponse,
    user_feedback: userFeedback,
  };

  const testStartedAt = performance.now();

  try {
    console.log(
      "\n--- Feedback Memory Test Started ---\n",
    );

    console.log("--- Test Input ---\n");

    console.log(
      JSON.stringify(testInput, null, 2),
    );

    console.log(
      "\n--- Running analyzeFeedback ---\n",
    );

    const analyzeFeedbackStartedAt =
      performance.now();

    const analyzeFeedbackResult =
      await analyzeFeedback(testInput);

    const analyzeFeedbackDuration =
      performance.now() -
      analyzeFeedbackStartedAt;

    if (
      typeof analyzeFeedbackResult !== "object" ||
      analyzeFeedbackResult === null ||
      Array.isArray(analyzeFeedbackResult)
    ) {
      throw new Error(
        "analyzeFeedback did not return a valid object.",
      );
    }

    console.log(
      "--- analyzeFeedback Result ---\n",
    );

    console.log(
      JSON.stringify(
        analyzeFeedbackResult,
        null,
        2,
      ),
    );

    console.log(
      `\nanalyzeFeedback duration: ${analyzeFeedbackDuration.toFixed(2)} ms`,
    );

    const totalDuration =
      performance.now() - testStartedAt;

    console.log(
      `\nTotal test duration: ${totalDuration.toFixed(2)} ms`,
    );

    console.log(
      "\n--- Test Completed Successfully ---\n",
    );
  } catch (error: unknown) {
    const totalDuration =
      performance.now() - testStartedAt;

    console.error(
      "\n--- Test Failed ---\n",
    );

    if (error instanceof Error) {
      console.error(
        `Error name: ${error.name}`,
      );

      console.error(
        `Error message: ${error.message}`,
      );

      if (error.stack) {
        console.error(
          `Error stack:\n${error.stack}`,
        );
      }
    } else {
      console.error(
        "Unknown error:",
        error,
      );
    }

    console.error(
      `\nTest duration before failure: ${totalDuration.toFixed(2)} ms`,
    );

    throw error;
  }
}