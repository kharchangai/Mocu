/*
 * Normalizes extension command output so it can be safely returned to the
 * LLM as a tool result (string coercion + length truncation).
 */

const MAX_EXTENSION_OUTPUT_LENGTH = 30_000;

export const normalizeExtensionOutput = (
  output: unknown,
): string => {
  let rawText: string;

  if (typeof output === "string") {
    rawText = output;
  } else if (output === undefined || output === null) {
    rawText = "";
  } else if (typeof output === "object") {
    /*
     * Extension commands may return nested shapes such as
     * { ok: true, output: "..." }. Prefer the `output` field when
     * present, otherwise stringify the whole result.
     */
    const record = output as Record<string, unknown>;

    if (
      "output" in record &&
      typeof record.output === "string"
    ) {
      rawText = record.output;
    } else {
      try {
        rawText = JSON.stringify(record, null, 2);
      } catch {
        rawText = "";
      }
    }
  } else {
    rawText = String(output);
  }

  const trimmed = rawText.trim();

  if (trimmed.length <= MAX_EXTENSION_OUTPUT_LENGTH) {
    return trimmed;
  }

  return [
    trimmed.slice(0, MAX_EXTENSION_OUTPUT_LENGTH),
    "",
    "[The remaining extension output was truncated.]",
  ].join("\n");
};


