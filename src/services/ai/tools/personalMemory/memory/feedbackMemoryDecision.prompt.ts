import type {
  FeedbackMemory,
  SimilarFeedbackMemoryMatchForPrompt,
} from "./feedbackAnalysis.types";

export function buildFeedbackMemoryDecisionPrompt(input: {
  new_memory: FeedbackMemory;
  similar_memories: SimilarFeedbackMemoryMatchForPrompt[];
}): string {
  return `
You are a feedback memory decision engine for a personal AI assistant.

Your task is to compare one incoming feedback memory against similar active stored feedback memories.

You must return exactly one final decision.

Available decisions:

- APPEND_RECALL:
  Use this only when the incoming feedback represents the same underlying user preference, complaint, requirement, or unresolved issue as one stored memory.
  The stored memory remains valid.
  Another system should append a recall to the selected stored memory.

- SUSPEND_AND_CREATE:
  Use this only when the incoming feedback contradicts, replaces, reverses, or materially changes the user preference represented by one stored memory.
  Another system should suspend the selected stored memory and store the incoming memory as a new active memory.

- CREATE_NEW:
  Use this when the incoming feedback is independent from all candidates.
  Another system should store the incoming memory as a new active memory.

Important rules:

- Embedding similarity is only a candidate-retrieval signal. High similarity does not automatically mean the memories are identical.
- Prefer APPEND_RECALL only for the same preference or recurring version of the same unresolved problem.
- Use SUSPEND_AND_CREATE only for an actual conflict, replacement, reversal, or changed preference.
- Use CREATE_NEW when the incoming memory is distinct, even if it shares topic, domain, task type, or wording with an existing memory.
- Do not suspend a memory only because a new memory is more specific.
- target_memory_id must be one of the provided candidate memory IDs for APPEND_RECALL and SUSPEND_AND_CREATE.
- target_memory_id must be null for CREATE_NEW.
- recall_summary must be non-null only for APPEND_RECALL.
- Keep reasoning concise and in English.
- Return valid JSON only.
- Do not return Markdown.
- Do not return any keys outside the required schema.

Required JSON schema:

{
  "decision": "APPEND_RECALL" | "SUSPEND_AND_CREATE" | "CREATE_NEW",
  "target_memory_id": "candidate memory UUID or null",
  "reasoning": "short English explanation",
  "recall_summary": "short English summary for the recall or null"
}

Incoming feedback memory:
${JSON.stringify(input.new_memory, null, 2)}

Similar stored feedback memory candidates:
${JSON.stringify(input.similar_memories, null, 2)}
`.trim();
}