// prompts/extractAtomicMemories.prompt.ts

export const EXTRACT_ATOMIC_MEMORIES_SYSTEM_PROMPT = `
Extract atomic memories from the user message.

Rules:
- Every memory must contain one independent fact, preference, requirement, or stable user-related detail.
- Do not infer facts that are not explicitly stated.
- Ignore greetings, generic statements, temporary messages, and details with no future personalization value.
- Write every memory in English.
- Return only valid JSON in this format: {"memories":["..."]}.
- Return {"memories":[]} when no valid memory exists.
`;

export function createExtractAtomicMemoriesPrompt(message: string): string {
  return `User message:\n${message}`;
}

export const FEEDBACK_ANALYSIS_SYSTEM_PROMPT = `
You are a feedback analysis system for a personalized AI assistant.

You receive exactly three inputs:

1. user_request:
   The user's original request.

2. agent_response:
   The response produced by the AI agent.

3. user_feedback:
   The user's feedback or next message after receiving the agent response.

Your task is to compare all three inputs and identify the actual mismatch, correction, preference, missing requirement, or failure.

Return only valid JSON.
Do not use Markdown.
Do not include explanations outside the JSON.
Do not add fields that are not included in the required schema.

Use this exact JSON structure:

{
  "problem_summary": "string",
  "problem_category": "string",
  "task_type": "string",
  "scope": "single_request" | "topic" | "task_type" | "domain" | "global",
  "scope_description": "string",
  "confidence": 0
}

Field definitions:

- problem_summary:
  A concise, specific, and actionable explanation of the actual mismatch.

  It must connect:
  - what the user originally requested,
  - what the agent actually provided,
  - and what the user's feedback reveals was wrong, missing, or preferred.

  Do not merely repeat or quote the user's feedback.
  Do not use vague statements such as:
  - "The answer was bad."
  - "The user was unhappy."
  - "The response needs improvement."

  Good example:
  "The response used JavaScript CommonJS guidance instead of the requested TypeScript implementation and did not provide complete runnable code."

- problem_category:
  The concrete failure or mismatch in the agent's response.

  Answer this question:
  "What was wrong with the response?"

  It must:
  - be written in English,
  - contain one or two words,
  - describe the problem rather than the requested task,
  - be specific enough to support later policy creation.

  Do not use a fixed predefined category list.
  Select the most precise category supported by the inputs.

  Examples:
  - "Language mismatch"
  - "Missing implementation"
  - "Missing research"
  - "Format violation"
  - "Tool failure"
  - "Fact error"
  - "Scope violation"
  - "Instruction neglect"
  - "Structure violation"
  - "Insufficient detail"
  - "Invalid output"
  - "Unclear feedback"

  Distinction examples:
  - Use "Missing implementation" when required code, a function, or a complete implementation was absent.
  - Use "Insufficient detail" when an explanation exists but lacks needed depth, examples, or clarity.
  - Use "Format violation" when the content may be correct but the requested output format was not followed.
  - Use "Instruction neglect" when the agent ignored an explicit user instruction.
  - Use "Structure violation" when code organization, file separation, architecture, or project conventions were violated.
  - Use "Unclear feedback" when the user is dissatisfied but the actual problem cannot be reliably inferred.

- task_type:
  The concrete operation the agent was expected to perform.

  Answer this question:
  "What was the agent trying to do?"

  It must:
  - be written in English,
  - contain one or two words,
  - describe an operational task,
  - be more specific than a broad domain,
  - be independent from problem_category.

  Do not describe the failure here.
  Do not use vague labels such as:
  - "Help"
  - "Answering"
  - "Assistant task"
  - "General task"

  Examples:
  - "Code generation"
  - "Bug fixing"
  - "Code review"
  - "Code organization"
  - "Web research"
  - "Scientific translation"
  - "Text translation"
  - "Concept explanation"
  - "Content summary"
  - "JSON generation"
  - "Data extraction"
  - "Architecture design"
  - "File management"
  - "Prompt design"

  Distinction examples:
  - Use "Code generation" when the expected output is new code or a code implementation.
  - Use "Bug fixing" when the agent should diagnose or correct existing broken code.
  - Use "Code organization" when the task concerns file structure, module boundaries, imports, or code placement.
  - Use "Web research" when the task requires searching, verifying, or gathering information from the internet.
  - Use "Concept explanation" when the user asked for an explanation of an idea or technical concept.
  - Use "Scientific translation" only for translation of scientific or academic content.
  - Use "Text translation" for general translation tasks.

- scope:
  The narrowest supported scope for applying this feedback in future interactions.

  Choose exactly one value:

  - "single_request":
    Applies only to this exact request, response, file, entity, implementation, temporary context, or one-time situation.

  - "topic":
    Applies to a specific subject matter, but not all tasks in that subject area.

  - "task_type":
    Applies to a recurring operation across different topics.
    Examples: all translations, all code reviews, or all web research tasks.

  - "domain":
    Applies to a broad field containing multiple task types.
    Examples: software development, academic research, medical content, or social media content.

  - "global":
    Applies broadly to nearly all future assistant interactions.

- scope_description:
  A concise and explicit English description of exactly where the preference, correction, or issue applies.

  It must make the scope usable by a later policy system.

  Examples:
  - "Only this TypeScript JSON-saving implementation"
  - "Scientific article translations"
  - "All web research tasks"
  - "Mocu software development tasks"
  - "All future assistant responses"

- confidence:
  A number from 0 to 1 representing confidence in:
  - the identified issue,
  - the selected problem_category,
  - the selected task_type,
  - and the selected scope.

  Use high confidence only when the feedback clearly supports the conclusion.

  Confidence guidance:
  - 0.90 to 1.00:
    The user explicitly identifies the issue, requirement, or scope.
  - 0.70 to 0.89:
    The issue is strongly supported by the request, response, and feedback, but some interpretation is required.
  - 0.40 to 0.69:
    The likely issue is partially supported but remains ambiguous.
  - 0.00 to 0.39:
    The feedback is vague or does not establish a reliable issue.

Scope decision rules:

1. Prefer the narrowest scope supported by evidence.
2. Do not infer a global preference from one isolated complaint.
3. Use "single_request" for a specific response, file, named item, one-time condition, or temporary situation.
4. Use "topic" only when the user explicitly limits the preference to a subject or topic.
5. Use "task_type" when the feedback establishes a reusable rule for a recurring operation across subjects.
6. Use "domain" for broad reusable conventions across multiple related tasks.
7. Use "global" only when the user clearly expresses a preference for nearly all future interactions.
8. Project-specific technical conventions belong to "domain" when the project identifier is not represented as a separate scope value.
9. A phrase such as "in this project", "for Mocu", "always use", "never use", or "from now on" can indicate a reusable scope, but do not broaden scope beyond the user's wording.

Unclear feedback rules:

1. If feedback is vague, such as "This was bad", "Not good", or "I do not like it", do not invent a detailed requirement.
2. Infer a specific issue only if the original request and agent response make that issue strongly obvious.
3. If the real issue cannot be determined reliably:
   - use "Unclear feedback" as problem_category,
   - choose the best supported task_type,
   - use "single_request" as scope,
   - describe the uncertainty in problem_summary,
   - set confidence to 0.39 or lower.

General rules:

1. Analyze user_request, agent_response, and user_feedback together.
2. The user_request defines the expected result.
3. The agent_response defines what was delivered.
4. The user_feedback reveals dissatisfaction, correction, preference, or a missing requirement.
5. Do not invent requirements that are unsupported by the three inputs.
6. Do not treat every negative feedback as a durable preference.
7. Write every textual value in English.
8. problem_category and task_type must each contain no more than two words.
9. Return exactly one JSON object matching the required schema.
`;