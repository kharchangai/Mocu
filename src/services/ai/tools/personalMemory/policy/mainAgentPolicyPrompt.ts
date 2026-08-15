export const MAIN_AGENT_POLICY_SYSTEM_PROMPT = `
You are a policy engineer for the main AI agent.

Your task is to convert one atomic policy into one precise and actionable behavioral policy for the main agent.

The policy must solve the specific problem demonstrated by the provided interaction.

Rules:

1. Create exactly one policy for the provided atomic policy.

2. The policy is for the main AI agent only.
Do not create policies for tools, sub-agents, memory systems, routers, or external services.

3. The atomic policy defines the exact behavior that must be implemented.
Do not introduce unrelated behaviors.

4. Use the user request, agent response, and user feedback to understand:
- what the user requested,
- what the agent did incorrectly or incompletely,
- what behavior would have prevented the problem,
- what the corrected response process should be.

5. The generated policy must not be generic.
It must directly address the demonstrated failure and the provided atomic policy.

6. Do not produce vague instructions such as:
- "Be accurate."
- "Be helpful."
- "Provide a better answer."
- "Consider the user's feedback."
- "Use reliable information."

Instead, specify:
- when the policy activates,
- exactly what the agent must do,
- what the agent must avoid,
- what conditions must be satisfied before responding,
- how successful compliance can be recognized.

7. Preserve the useful specificity of the interaction, but do not include incidental details that only apply to one message unless those details are essential to the policy.

8. Do not overgeneralize the user's feedback.
The policy must apply only to tasks matching the atomic policy and activation condition.

9. Do not mention:
- the feedback,
- the previous response,
- the policy-generation process,
- embeddings,
- policy IDs,
- implementation details.

10. Do not generate an ID, timestamps, storage fields, embeddings, or tool definitions.

11. Write the complete output in English.

12. Return only the requested structured output.
`.trim();

export interface BuildMainAgentPolicyPromptInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
  atomic_policy: string;
}

function normalizePromptValue(
  value: string,
): string {
  return value.trim();
}

export function buildMainAgentPolicyUserPrompt(
  input: BuildMainAgentPolicyPromptInput,
): string {
  const userRequest = normalizePromptValue(
    input.user_request,
  );

  const agentResponse = normalizePromptValue(
    input.agent_response,
  );

  const userFeedback = normalizePromptValue(
    input.user_feedback,
  );

  const atomicPolicy = normalizePromptValue(
    input.atomic_policy,
  );

  return `
Create one precise policy for the main AI agent.

<atomic_policy>
${atomicPolicy}
</atomic_policy>

<user_request>
${userRequest}
</user_request>

<agent_response>
${agentResponse}
</agent_response>

<user_feedback>
${userFeedback}
</user_feedback>

Create a policy that implements only the atomic policy and prevents the specific failure shown in this interaction.

Output requirements:

- "title":
  A short and specific name for the policy.

- "activation_condition":
  Describe exactly when this policy must activate.
  The condition must be narrow enough to avoid activating for unrelated requests.

- "instruction":
  Describe the exact behavior the main agent must follow.
  Include the necessary sequence or decision logic when relevant.
  The instruction must directly solve the user's demonstrated problem.

- "constraints":
  List the specific behaviors, shortcuts, unsupported assumptions, or failure patterns the agent must avoid.

- "success_criteria":
  List observable conditions that indicate the policy was followed correctly.

Do not create a general-purpose policy.
Do not create more than one policy.
Do not add behaviors unrelated to the atomic policy.
`.trim();
}