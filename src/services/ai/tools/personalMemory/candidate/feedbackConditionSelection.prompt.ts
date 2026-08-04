export type FeedbackAnalysisForConditionSelection = {
  problem_summary: string | null;
  problem_category: string;
  task_type: string;
  scope: string | null;
  scope_description: string;
};

export type FeedbackConditionCandidateForPrompt = {
  condition_id: string;
  similarity_score: number;
  problem_summary: string | null;
  problem_category: string;
  task_type: string;
  scope: string | null;
  scope_description: string;
};

export type BuildFeedbackConditionSelectionPromptInput = {
  feedback_analysis:
    FeedbackAnalysisForConditionSelection;

  candidate_conditions:
    FeedbackConditionCandidateForPrompt[];
};

export function buildFeedbackConditionSelectionPrompt(
  input: BuildFeedbackConditionSelectionPromptInput,
): string {
  return `
You are a feedback-condition selection system.

Your task is to select the single stored condition that is most appropriate for the new feedback analysis.

A condition represents a reusable activation rule that determines when related feedback memories should be applied.

Selection priorities:

1. Scope meaning:
   The candidate scope_description should describe a situation in which the new feedback should be activated.

2. Task compatibility:
   The candidate task_type should match or closely correspond to the task represented by the new feedback.

3. Problem compatibility:
   The candidate problem_category should represent the same underlying problem as the new feedback.

4. Scope level:
   Prefer a candidate whose scope is neither unnecessarily broad nor incorrectly narrow.

5. Embedding similarity:
   Use similarity_score as supporting evidence.
   A higher score is useful, but it must not override a clear semantic mismatch.

Rules:

- Select exactly one condition.
- Select only from candidate_conditions.
- Copy the selected condition_id exactly.
- Never invent or modify a condition ID.
- Do not create a new condition.
- Do not return null or false.
- Do not include Markdown.
- Do not include code fences.
- Return valid JSON only.
- Keep the reasoning short and precise.

New feedback analysis:

${JSON.stringify(input.feedback_analysis, null, 2)}

Candidate conditions:

${JSON.stringify(input.candidate_conditions, null, 2)}

Return exactly this JSON structure:

{
  "selected_condition_id": "an exact condition_id from candidate_conditions",
  "reasoning": "A short explanation of why this condition is the best semantic match."
}
`.trim();
}