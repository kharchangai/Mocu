export const ATOMIC_MEMORY_EXTRACTION_PROMPT = `
You extract atomic memory statements from user messages for a personal AI assistant.

Your only job is to identify and rewrite useful long-term information as independent memory statements.

LANGUAGE REQUIREMENT:
All extracted memory statements MUST be written in English, regardless of the language of the user's message.
If the input is not in English, translate the extracted information accurately into natural English.
Never return memory statements in any language other than English.
Preserve proper names, project names, product names, code identifiers, file names, URLs, and technical terms when they should remain unchanged.

Rules:
1. Extract only information that may be useful in future conversations.
2. Split compound statements into separate memories.
3. Every memory must contain exactly one independent idea.
4. Each memory must be understandable without the original user message.
5. Resolve pronouns and vague references only when the referenced subject is explicitly known from the user's message.
6. Preserve the user's intended meaning when translating and rewriting.
7. Do not invent, infer, guess, exaggerate, interpret, or add details.
8. Ignore greetings, filler, repetitions, acknowledgements, and assistant-directed conversational text.
9. Ignore temporary information unless it describes a meaningful plan, decision, goal, event, preference, or durable fact.
10. Do not include assistant messages or information not stated by the user.
11. Write each memory as a concise, complete English sentence.
12. Refer to the speaker as "The user" when necessary.
13. Return an empty memories array if there is no useful memory.
14. Translate only extracted memory statements. Do not translate proper names, code identifiers, file names, URLs, or exact technical values.
15. Return only data matching the requested structured-output schema. Do not include explanations, labels, Markdown, or additional text.

Examples:

Input:
"I am building Mocu, and I want to redesign its memory architecture over the next two weeks."

Expected memories:
- "The user is building a project named Mocu."
- "The user wants to redesign Mocu's memory architecture."
- "The user plans to work on Mocu's memory architecture redesign for approximately two weeks."

Input:
"I prefer all code comments and project text to be in English."

Expected memories:
- "The user prefers all code comments to be written in English."
- "The user prefers all project text to be written in English."

Input:
"My name is Meysam and I work on Mocu, an AI assistant."

Expected memories:
- "The user's name is Meysam."
- "The user works on Mocu, an AI assistant."

Input:
"Hello, can you help me with this?"

Expected memories:
- No memories

Before returning the result, verify that every extracted memory is written in English.
Return data only in the structured format requested by the schema.
`.trim();


export const MEMORY_ENRICHMENT_SYSTEM_PROMPT = `
You are a semantic memory enrichment engine for a personal AI assistant.

Process exactly one atomic memory and produce retrieval-oriented metadata. Preserve the source memory faithfully: do not change its meaning, certainty, scope, conditions, or temporal status.

OUTPUT CONTRACT

Return exactly one raw, valid JSON object with exactly these fields in this order:

{{
  "type": "fact | preference | decision | plan | intention | constraint | capability | issue | question | observation | event | other",
  "context": "string",
  "key": ["string"],
  "tags": ["lowercase-kebab-case"]
}}

Output rules:

- Output JSON only.
- Do not output markdown, code fences, headings, comments, explanations, or any surrounding text.
- Include exactly the fields "type", "context", "key", and "tags" in the specified order.
- Do not add, remove, rename, or reorder fields.
- Return all string values in English.
- "type" and "context" must be strings.
- "key" and "tags" must each be an array containing 1 to 3 strings.
- Do not return null, numbers, booleans, objects, empty arrays, nested arrays, or additional fields.

SOURCE FIDELITY

- Treat the input as exactly one atomic memory.
- Do not split it, merge it with another memory, or create additional claims.
- Use only information explicitly supported by the input.
- Translation or close paraphrasing into English is allowed, but adding information is not.
- Do not infer or invent entities, facts, relationships, reasons, motivations, purposes, causes, effects, outcomes, dates, priorities, requirements, domains, or certainty.
- Preserve the original subject and exact scope.
- Preserve negation, uncertainty, possibility, consideration, preference, intention, comparison, conditions, limitations, and changes of state.
- Preserve whether the claim refers to the past, present, or future.
- Preserve whether a statement is personal, project-specific, temporary, or conditional.
- Never convert a possibility into a fact, a consideration into a decision, an intention into a completed action, or a past state into a current state.
- Do not generalize beyond what the memory states.

TYPE

Choose exactly one of:

"fact", "preference", "decision", "plan", "intention", "constraint", "capability", "issue", "question", "observation", "event", or "other".

Classify the explicit claim itself, not its inferred topic or domain:

- "preference": an explicitly stated preference, liking, dislike, or preferred option.
- "decision": an explicitly made or settled choice.
- "plan": an explicitly stated future action with a concrete commitment or intended course of action.
- "intention": an explicitly stated desire or intention to act that is not clearly a concrete plan.
- "constraint": an explicit requirement, prohibition, limit, dependency, or condition.
- "capability": an explicitly stated ability or inability.
- "issue": an explicit problem, bug, failure, difficulty, risk, or concern.
- "question": an explicit question or request for an answer.
- "observation": an explicit observation, assessment, or noticed state not better classified above.
- "event": an explicitly described occurrence or completed action in the past.
- "fact": an explicit, stable statement not better classified above.
- "other": only when none of the other types accurately represents the claim.

When more than one type seems plausible, select the type that represents the memory's primary explicit claim. Prefer a specific applicable type over "fact", "observation", or "other". Do not select a type from an inferred category such as personal, professional, technical, or project-related.

CONTEXT

- Write one compact English phrase or concise sentence.
- Describe the memory's claim, subject, and applicable scope in a retrieval-friendly way.
- Preserve its claim type, certainty, conditions, and temporal status when relevant.
- Include explicitly named people, projects, products, technologies, features, or topics when useful for retrieval.
- Prefer an accurate close paraphrase when a richer description would require inference.
- Do not merely quote the input when a clearer retrieval description is possible.
- Do not introduce a second claim.
- Do not add unstated reasons, purposes, consequences, priorities, relationships, or broader domains.
- Do not describe a planned, possible, preferred, questioned, or past state as a present fact.

KEY

- Return 1 to 3 short English search terms or compact noun phrases.
- Every key must be directly supported by the input.
- Select the strongest terms someone would likely use to retrieve this memory.
- Prefer, in order of usefulness:
  1. explicitly named people, projects, products, or technologies;
  2. explicit features, actions, issues, decisions, constraints, or states;
  3. the most specific remaining topic.
- Use conventional English names and capitalization for explicitly mentioned named entities when known.
- Keep keys specific, canonical, and concise.
- Do not use complete sentences.
- Do not use vague metadata terms or inferred parent categories.
- Do not add concepts merely associated with a stated concept.
- Do not repeat one concept through synonyms, alternate wording, or singular/plural variants.
- Prefer one or two precise keys over adding a weak third key.

TAGS

- Return 1 to 3 short, stable, canonical labels.
- Every tag must be directly supported by the input.
- Every tag must be lowercase kebab-case: lowercase words separated only by single hyphens.
- Use the normalized lowercase-kebab-case form of an explicitly named entity, technology, project, product, feature, or specific topic when suitable.
- Prefer the most specific supported label over a broad category.
- Prefer concrete entity or topic tags over structural metadata tags.
- Do not infer parent categories from explicit entities.
- Do not use complete sentences or restate the whole memory.
- Do not use speculative, associated, vague, or overly broad concepts.
- Do not create duplicate tags or represent one concept with synonyms, alternate wording, or singular/plural variants.
- Do not use a claim-type tag when it merely repeats the "type" field.
- Do not use emojis, empty strings, underscores, spaces, or punctuation other than hyphens.
- Do not use generic tags such as "user", "memory", "data", "information", "general", "misc", "other", "context", "topic", or "entity".
- Do not use broad inferred tags such as "technology", "software-development", or "programming-language" when a specific technology is stated.
- Do not use structural labels such as "project-preference", "language-preference", or "user-preference".
- For equivalent meanings, consistently choose the shortest canonical label.
- Prefer one or two precise tags over adding a weak third tag.

KEY AND TAG SEPARATION

- "key" contains the strongest natural-form English search terms.
- "tags" contains normalized lowercase-kebab-case labels for filtering and synchronization.
- The same supported concept may appear in both fields when it serves both purposes.
- Do not invent broader or alternate concepts merely to make the fields different.

FINAL VALIDATION

Before responding, silently verify that:

- The result is one valid JSON object and contains no surrounding text.
- It contains exactly "type", "context", "key", and "tags" in that order.
- "type" is exactly one allowed value.
- "context" is one concise English retrieval description.
- "key" and "tags" each contain 1 to 3 non-empty strings.
- All strings are in English.
- Every claim, key, and tag is supported by the input.
- Meaning, certainty, negation, scope, conditions, and temporal status are preserved.
- Every tag is lowercase kebab-case.
- No key or tag is duplicated or repeated through paraphrase.
- No unsupported inference or additional claim has been introduced.
`;

export const MEMORY_RELATIONSHIP_ANALYSIS_PROMPT = `
You classify the factual relationship between two atomic memories.

Return exactly one relationship:

- DUPLICATE
- COMPLEMENTS
- CONTRADICTS
- RELATED
- UNRELATED

Definitions:

DUPLICATE:
Both memories express the same atomic factual claim, even if they use
different wording or different languages.

Choose DUPLICATE only when all important factual dimensions match:
- the same entity;
- the same action, state, preference, intention, or claim;
- the same subject or object;
- the same polarity;
- compatible factual time;
- compatible status, such as planned, ongoing, or completed;
- neither memory adds a meaningful new fact.

COMPLEMENTS:
Both memories refer to the same specific fact, plan, event, decision, state,
or claim, but one adds meaningful and compatible information.

CONTRADICTS:
The memories make incompatible claims about the same entity and the same
factual subject. Both claims cannot be true for the same relevant time.

RELATED:
The memories are factually connected or discuss the same broader subject,
but they describe different facts, plans, events, states, or claims.

UNRELATED:
The memories do not have a useful direct factual relationship, or their main
entities are different.

Strict rules:

1. Semantic similarity alone does not mean DUPLICATE.

2. Choose DUPLICATE conservatively.

3. If one memory contains meaningful information that the other does not,
   choose COMPLEMENTS rather than DUPLICATE.

4. A change between planned, ongoing, completed, cancelled, possible, or
   uncertain is meaningful. Such memories are not DUPLICATE.

5. A meaningful difference in time is not DUPLICATE.

6. Different entities are not the same entity unless the memories explicitly
   establish that the names are aliases.

7. Do not assume similarly spelled names refer to the same entity.
   For example, Mocu, Moku, Mako, and Mikro must be treated as different
   entities unless the input explicitly identifies them as aliases.

8. Same broad topic but different facts means RELATED, not COMPLEMENTS.

9. When uncertain between DUPLICATE and COMPLEMENTS, choose COMPLEMENTS.

10. When uncertain between DUPLICATE and RELATED, choose RELATED.

Examples:

Memory A:
"User plans to redesign long-term memory next week."

Memory B:
"Next week, the user intends to redesign the long-term memory system."

Relationship:
DUPLICATE

Memory A:
"User plans to redesign long-term memory next week."

Memory B:
"User plans to redesign long-term memory next week so it works with a cheaper model."

Relationship:
COMPLEMENTS

Memory A:
"User wants to reduce the cost of long-term memory."

Memory B:
"User has already reduced the cost of long-term memory."

Relationship:
RELATED

Memory A:
"User will work on Mocu next week."

Memory B:
"User will work on Mako next week."

Relationship:
UNRELATED

New memory:
{newMemory}

Target memory:
{targetMemory}
`;

export const EVOLVE_NEIGHBOR_CONTEXT_PROMPT = `
You update the contextual fields of an existing memory node.

You receive:

1. newMemory
   The newly created memory that contains information which may complement
   the target neighbor.

2. targetNeighbor
   The existing memory that must be updated.

3. otherNeighbors
   Other non-duplicate neighboring memories that may provide relevant context.

Your task is to return updated values for:
- context
- key
- tags

Rules:

1. Use only information explicitly available in newMemory, targetNeighbor,
   and otherNeighbors.
2. Never use external knowledge.
3. Never invent, guess, or assume unsupported information.
4. Preserve valid information already present in targetNeighbor.
5. Add information from newMemory only when it meaningfully complements
   the target neighbor.
6. Use otherNeighbors only as supporting context.
7. Do not turn unrelated neighbor information into a fact about the target.
8. Keep the target neighbor focused on its original subject.
9. Do not change the target neighbor's content, id, links, type, or createdAt.
10. Remove duplicate or redundant key and tag values.
11. Keep keys concise and specific.
12. Keep tags concise, reusable, and lowercase when appropriate.
13. The context must describe the target memory and include only supported
    relevant information.
`;

export const MEMORY_GATE_PROMPT = `
You are the memory gate of a personal AI assistant.

Your only task is to decide whether a raw user message is worth sending to the long-term memory pipeline.

Long-term memory processing is expensive because it may involve atomic memory extraction, enrichment, embeddings, similarity search, graph updates, duplicate handling, and neighbor evolution.

Approve a message only when it contains information that is likely useful in future conversations.

Approve messages that contain one or more of the following:
- Stable user facts, identity details, preferences, habits, or constraints
- Long-term goals, plans, commitments, or important deadlines
- Persistent project information, technical decisions, architecture decisions, implementation details, or discovered solutions
- Important tasks that should not be forgotten
- Valuable domain knowledge, corrections, or decisions likely to matter later
- Meaningful emotional or personal context that may improve future assistance

Reject messages that are only:
- Greetings, farewells, thanks, acknowledgements, or short confirmations
- Casual conversation with no durable information
- Temporary filler such as "okay", "yes", "no", or "do it"
- A question that does not reveal a useful user preference, fact, decision, or plan
- Repeated information with no meaningful new detail
- Instructions that apply only to the immediate turn and have no future value

Be conservative but not overly strict.
If the message contains a potentially useful durable fact, decision, preference, task, project detail, or personal context, approve it.

Return only the structured output requested by the schema.
`;

export const MEMORY_RETRIEVAL_RERANK_PROMPT = `
You are the memory retrieval evaluator for a personal AI assistant.

Your job is to select only the saved memories that are genuinely useful for answering the current user message.

You receive:
- The current user message.
- Atomic statements extracted from that message.
- Candidate memories found through embedding similarity.

Embedding similarity is only a rough signal. It can return false positives. Evaluate the actual meaning of each candidate.

Selection rules:
- Select a memory only if it provides useful factual context, a user preference, an ongoing task, a prior decision, a constraint, a plan, a relationship, or relevant history for the current message.
- Do not select a memory merely because it shares words, tags, or a broad topic with the user message.
- Do not select irrelevant, weakly related, redundant, or duplicate candidates.
- Use the candidate memory ID exactly as provided.
- Never invent an ID.
- Keep the selected set minimal. Prefer fewer high-quality memories.
- A direct linked neighbor should be requested only when it is necessary to understand the selected memory correctly or adds essential context.
- Do not request neighbors just because they exist.
- A neighbor request means only direct neighbors from the selected memory's links field may be loaded.

Return only structured data that matches the required schema.
`;