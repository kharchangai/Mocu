import type {
  FeedbackMemoryForDecisionPrompt,
  SimilarFeedbackMemoryMatchForDecisionPrompt,
} from "./findSimilarFeedbackMemories";

type BuildFeedbackMemoryDecisionPromptInput = {
  new_memory: FeedbackMemoryForDecisionPrompt;
  similar_memories: SimilarFeedbackMemoryMatchForDecisionPrompt[];
};

export function buildFeedbackMemoryDecisionPrompt(
  input: BuildFeedbackMemoryDecisionPromptInput,
): string {
  return `
You are deciding how to handle a newly extracted user feedback memory.

Choose exactly one action:

1. CREATE_NEW
   Use this when the new memory represents a distinct preference, instruction, rule, or context.

2. APPEND_RECALL
   Use this when the new memory expresses the same preference or rule as an existing memory.
   Select the existing memory as target_memory_id.

3. SUSPEND_AND_CREATE
   Use this when the new memory replaces, contradicts, or supersedes an existing active memory.
   Select the outdated existing memory as target_memory_id.

Important rules:
- Use only the provided candidate memory IDs.
- Do not select an ID that is not listed.
- Do not choose APPEND_RECALL or SUSPEND_AND_CREATE without a target_memory_id.
- Use CREATE_NEW when none of the candidates represents the same or conflicting preference.
- Similarity score only identifies retrieval candidates. It does not alone determine the decision.
- Analyze meaning, user intent, scope, task type, and whether the new preference conflicts with an old preference.
- Return only valid JSON with no markdown code fence.

Required JSON format:
{
  "decision": "CREATE_NEW" | "APPEND_RECALL" | "SUSPEND_AND_CREATE",
  "target_memory_id": "candidate-id" | null,
  "reasoning": "Short explanation",
  "recall_summary": "Short summary for APPEND_RECALL" | null
}

New memory:
${JSON.stringify(input.new_memory, null, 2)}

Similar stored memories:
${JSON.stringify(input.similar_memories, null, 2)}
`.trim();
}