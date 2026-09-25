/** Detect explicit natural-language commands that switch into Focus mode. */
export function parseFocusStartGoal(message: string): string | null {
  const text = message.trim();
  const patterns = [
    /^(?:please\s+)?(?:i\s+(?:want|would\s+like)\s+to\s+)?(?:start|begin|enter)\s+focus(?:\s+mode)?(?:\s+on)?\s*[:,-]?\s*/i,
    /^(?:please\s+)?(?:let(?:'|’)s|let\s+us)\s+focus(?:\s+on)?\s*[:,-]?\s*/i,
    /^(?:please\s+)?(?:i\s+(?:want|would\s+like)(?:\s+to)?|can\s+we|could\s+we|we\s+should)\s+focus(?:\s+on)?\s+/i,
    /^(?:please\s+)?focus\s+on\s+/i,
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      const goal = text.replace(pattern, "").trim();
      return goal || text;
    }
  }
  return null;
}
