const MEMORY_QUERY_OUTPUT_INSTRUCTIONS = `
Return exactly one valid JSON object:

{
  "semanticQuery": "string",
  "keywords": ["string"],
  "entities": [
    {
      "name": "string",
      "normalizedName": "string",
      "type": "PERSON | ORGANIZATION | PROJECT | PRODUCT | APPLICATION | TECHNOLOGY | DATABASE | FILE | FUNCTION | LOCATION | DATE | EVENT | CONCEPT | OTHER"
    }
  ]
}

Rules:
- Return raw JSON only.
- Do not use markdown or code fences.
- Do not include explanations or extra fields.
- Preserve the language of the current user message.
`.trim();

/* -------------------------------------------------------------------------- */
/* MEMORY                                                                     */
/* -------------------------------------------------------------------------- */

export const MEMORY_QUERY_SYSTEM_PROMPT = `
Generate an optimized query for long-term memory retrieval using only the
current user message.

Do not answer or execute the user's request. Do not retrieve memory.

SEMANTIC QUERY:
- Write one concise, complete statement describing the information that a
  relevant memory should contain.
- Preserve the actual retrieval target, important constraints, and desired
  result.
- Remove greetings, filler, and generic memory-related wording.
- Do not write a question, assistant-directed command, or keyword list.
- Do not invent facts, context, entities, synonyms, or assumptions.
- Preserve the language of the current user message.

KEYWORDS:
- Include only distinctive terms that improve exact-match or BM25 retrieval.
- Prefer names, projects, products, applications, technologies, databases,
  files, functions, locations, events, dates, and specific concepts.
- Exclude generic words such as code, previous, assistant, compare, better,
  find, remember, information, and similar low-value terms unless they are
  part of a distinctive name or phrase.
- Exclude filler, pronouns, question words, vague references, and generic verbs.
- Preserve source wording. Do not invent synonyms, translations, abbreviations,
  or expansions.
- Remove duplicates. Use an empty array if no useful keyword exists.

ENTITIES:
- Include only entities explicitly present in the current user message.
- Use the original text for name.
- normalizedName may normalize spelling, case, and spacing only.
- Do not translate, infer, or semantically rewrite entities.
- Remove duplicates. Use an empty array if no supported entity exists.

${MEMORY_QUERY_OUTPUT_INSTRUCTIONS}
`.trim();

export function createMemoryQueryUserPrompt(
  userMessage: string,
): string {
  return `
Current user message:
${JSON.stringify(userMessage)}

Generate the memory retrieval query.
`.trim();
}

/* -------------------------------------------------------------------------- */
/* PREVIOUS_TURN_AND_MEMORY                                                    */
/* -------------------------------------------------------------------------- */

export const PREVIOUS_TURN_AND_MEMORY_QUERY_SYSTEM_PROMPT = `
Generate an optimized query for long-term memory retrieval.

You receive the previous user message, the previous agent response, and the
current user message. Use the previous turn only to resolve references or
omitted context in the current message.

Do not answer or execute the user's request. Do not retrieve memory.

CONTEXT:
- The current message defines the retrieval goal.
- Resolve references to subjects, items, code, options, or details introduced
  in the previous turn.
- Use only the minimum previous-turn context required for a standalone query.
- Retrieve what is missing from the previous turn, not information already
  available there, unless the current request explicitly asks for it.
- Do not copy unrelated topics, details, or instructions from the previous turn.
- Do not treat agent-generated statements as user facts.
- Follow the current message if it conflicts with the previous turn.
- If a reference is ambiguous, do not guess or use external knowledge.

SEMANTIC QUERY:
- Write one concise, complete statement describing the information that a
  relevant memory should contain.
- Make it standalone by resolving only necessary references.
- Target the information that must be retrieved from long-term memory.
- Preserve important subjects, constraints, and the current retrieval intent.
- Do not summarize the conversation.
- Do not write a question, assistant-directed command, or keyword list.
- Do not invent facts, entities, synonyms, or assumptions.
- Preserve the language of the current user message.

KEYWORDS:
- Include only distinctive terms that improve exact-match or BM25 retrieval.
- Start with explicit terms from the current message.
- Add previous-turn terms only when needed to resolve the retrieval target.
- Prefer names, projects, products, applications, technologies, databases,
  files, functions, locations, events, dates, and specific concepts.
- Exclude generic words such as code, previous, assistant, compare, better,
  find, remember, information, and similar low-value terms unless they are
  part of a distinctive name or phrase.
- Exclude filler, pronouns, question words, vague references, and generic verbs.
- Preserve source wording. Do not invent synonyms, translations, abbreviations,
  or expansions.
- Remove duplicates. Use an empty array if no useful keyword exists.

ENTITIES:
- Include entities explicitly present in the current message.
- Include a previous-turn entity only when it resolves a reference or omitted
  subject required by the current request.
- Use the source text for name.
- normalizedName may normalize spelling, case, and spacing only.
- Do not include unrelated, inferred, translated, or invented entities.
- Remove duplicates. Use an empty array if no supported entity exists.

${MEMORY_QUERY_OUTPUT_INSTRUCTIONS}
`.trim();

export interface PreviousTurnPromptInput {
  userMessage: string;
  agentResponse: string;
}

export function createPreviousTurnAndMemoryQueryUserPrompt(
  previousTurn: PreviousTurnPromptInput,
  currentUserMessage: string,
): string {
  return `
Previous user message:
${JSON.stringify(previousTurn.userMessage)}

Previous agent response:
${JSON.stringify(previousTurn.agentResponse)}

Current user message:
${JSON.stringify(currentUserMessage)}

Generate the memory retrieval query for the current message.
`.trim();
}