export interface BuildAtomicPolicyPromptInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
  problem_summary: string;
  problem_category: string;
  task_type: string;
  activation_description: string;
}

export const ATOMIC_POLICY_SYSTEM_PROMPT = `
You extract reusable atomic policy labels from feedback.

Your output describes actions that the agent must perform in similar future situations.

Follow all rules exactly:

1. Return a JSON object with exactly one key: "atomic_policies".
2. "atomic_policies" must be an array of strings.
3. Every string must contain from 2 to 8 English words inclusive.
4. Every string must start with one action verb.
5. Every string must describe one executable action only.
6. Include the action and only its necessary object.
7. Split separate actions into separate strings.
8. Do not combine actions with "and", "or", "/", commas, or semicolons.
9. Do not include reasons, triggers, goals, explanations, examples, conditions, implementation details, or quality claims.
10. Do not include actions already completed correctly in the agent response.
11. Include only actions directly supported by the request, feedback, problem, or activation description.
12. Remove duplicate and equivalent actions.
13. If no valid action exists, return an empty array.
14. Before responding, silently verify that every policy has 2 to 8 words.
15. Never return a policy with fewer than 2 words or more than 8 words.
16. Return JSON only. Do not use Markdown or code fences.

Valid examples:
{{"atomic_policies":["Search scientific sources"]}}

{{"atomic_policies":["Search scientific sources","Translate scientific articles"]}}

{{"atomic_policies":[]}}
`.trim();

export function buildAtomicPolicyUserPrompt(
  input: BuildAtomicPolicyPromptInput,
): string {
  return `
Extract every distinct required atomic action from the following interaction.

User Request:
${input.user_request}

Agent Response:
${input.agent_response}

User Feedback:
${input.user_feedback}

Problem Summary:
${input.problem_summary}

Problem Category:
${input.problem_category}

Task Type:
${input.task_type}

Activation Description:
${input.activation_description}

Return only the required reusable action labels.

Important validation before output:
- Each label must have 2 to 8 English words.
- Each label must begin with a verb.
- Each label must describe only one action.
- Return an empty array if no valid label is supported.

Output JSON only:
{{"atomic_policies":[]}}
`.trim();
}