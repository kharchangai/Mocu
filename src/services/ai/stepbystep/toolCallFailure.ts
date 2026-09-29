export const STEP_TOOL_CALL_FAILURE_MARKER =
  "MOCU_STEP_TOOL_CALL_FAILURE_V1";

export interface StepToolCallFailure {
  stepNumber: number;
}

export function createStepToolCallFailureMessage(
  stepNumber: number,
): string {
  return [
    `${STEP_TOOL_CALL_FAILURE_MARKER} ${JSON.stringify({ stepNumber })}`,
    `The step-by-step workflow paused at step ${stepNumber} because the model returned tool-call markup as text twice. Those calls were not executed. Switch to a model/provider with native tool-calling support and send “continue” to resume.`,
  ].join("\n");
}

export function parseStepToolCallFailureMessage(
  content: string,
): StepToolCallFailure | undefined {
  if (!content.startsWith(STEP_TOOL_CALL_FAILURE_MARKER)) {
    return undefined;
  }

  const payload = content
    .slice(STEP_TOOL_CALL_FAILURE_MARKER.length)
    .trim()
    .split(/\r?\n/, 1)[0];

  try {
    const parsed: unknown = JSON.parse(payload);

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "stepNumber" in parsed &&
      typeof parsed.stepNumber === "number" &&
      Number.isInteger(parsed.stepNumber) &&
      parsed.stepNumber > 0
    ) {
      return { stepNumber: parsed.stepNumber };
    }
  } catch {
    // Ignore malformed markers and render them as ordinary assistant text.
  }

  return undefined;
}
