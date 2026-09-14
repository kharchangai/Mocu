// memory-retrieval/memoryContextPipeline.ts

/**
 * Comprehensive memory context pipeline.
 *
 * The project has two different memory systems:
 *
 * 1. RELEVANT (TEMPORAL) MEMORY  — memoryRetrievalPipeline.ts
 *    Continuity gate + hierarchical Episode/Window/Turn retrieval
 *    from the project SQLite database (memory.db). Good for recent
 *    turns, previous messages, and conversation continuity.
 *
 * 2. GRAPH MEMORY  — memoryPipeline.ts (memory-retrieval)
 *    Entity extraction + entity graph search (memory-graph.db).
 *    Good for older facts, decisions, preferences, and entities.
 *
 * This pipeline lets an LLM gate choose which memory system the
 * current user message needs, runs only the selected systems
 * (in parallel when both are needed), and merges the results into
 * one comprehensive memory context for the agent system prompt:
 *
 *   user message + project path
 *     -> LLM gate (getAsyncLLM) selects the route:
 *          NONE     -> no memory
 *          TEMPORAL -> relevant memory    (memoryRetrievalPipeline)
 *          GRAPH    -> graph memory       (memoryPipeline)
 *          BOTH     -> both systems in parallel
 *     -> comprehensive memory context
 *     -> LLM relevance filter (getAsyncLLM) keeps only the memory
 *        sentences relevant to the current user message
 *     -> final memory context
 *
 * The pipeline is executed by the project agent on every user
 * message. A failure inside the pipeline never blocks the agent
 * (the caller catches it).
 */

import { getAsyncLLM } from "../../../../services/ai/llm";

import { runMemoryPipeline } from "./memoryPipeline";

import {
  extractJSONObject,
  getLLMResponseText,
} from "../window/llmResponse";

import {
  getProjectDatabasePath,
  retrieveRelatedMemory,
  type RelatedMemory,
} from "./memoryRetrievalPipeline";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Routes the gate LLM can select:
 *
 * - none:     the message is self-contained.
 * - temporal: only the relevant (temporal) memory system is needed.
 * - graph:    only the entity graph memory system is needed.
 * - both:     both memory systems are needed.
 */
export type MemoryRoute =
  | "none"
  | "temporal"
  | "graph"
  | "both";

export interface MemoryGateDecision {
  route: MemoryRoute;

  confidence: number;

  /**
   * Short English explanation of the routing decision.
   */
  reason: string;
}

/**
 * Final output of the comprehensive memory pipeline.
 */
export interface ComprehensiveMemoryContext {
  route: MemoryRoute;

  gateConfidence: number;
  gateReason: string;

  /**
   * Relevant (temporal) memory from memoryRetrievalPipeline,
   * or null when nothing was found or the route excluded it.
   */
  temporalMemory: RelatedMemory | null;

  /**
   * Ready-to-inject graph memory text from memoryPipeline.
   * Empty string when nothing was found or the route excluded it.
   */
  graphMemoryContext: string;

  /**
   * The raw merged memory context text (before the relevance
   * filter LLM). Empty string when no memory was found. Kept for
   * logging/debugging.
   */
  unfilteredContext: string;

  /**
   * The final, comprehensive memory context text: the merged memory
   * filtered by the relevance filter LLM so that only the sentences
   * relevant to the current user message remain. Empty string when
   * no memory was found or nothing was relevant.
   */
  comprehensiveContext: string;

  estimatedTokens: number;
}

/**
 * Options for the comprehensive memory pipeline.
 */
export interface MemoryContextPipelineOptions {
  /**
   * When the gate confidence is lower than this value, both memory
   * systems are run for safety (the primary route is still visible
   * in the result).
   */
  lowConfidenceThreshold?: number;
}

/* -------------------------------------------------------------------------- */
/* Gate Prompt                                                                */
/* -------------------------------------------------------------------------- */

const MEMORY_ROUTE_GATE_PROMPT = `
You are a memory-routing gate for an AI assistant that works on a
user project.

Your job is to decide which memory system is necessary to answer the
user's CURRENT message correctly.

AVAILABLE MEMORY SYSTEMS

1. TEMPORAL MEMORY (relevant memory)
Contains recent conversation turns of this project in chronological
order, retrieved by a hierarchical episode/window/turn search.

Use temporal memory when the user refers to:
- the previous message or the latest answer
- something said just now
- "this", "that", "it", "the previous one", or another unresolved
  reference to a recent message
- continuation, correction, clarification, or follow-up of a recent
  exchange
- what happened before or after a recent event
- the current conversation or current window

2. GRAPH MEMORY (entity memory)
Contains older conversation turns of this project connected by
normalized entities, topics, project concepts, decisions,
preferences, and relationships.

Use graph memory when the user asks about:
- older facts, preferences, decisions, constraints, or project
  details from previous conversations
- relations between multiple entities of the project
- comparisons or aggregations across conversations
- historical recall of what was discussed or decided earlier
- information that is spread across different turns or sessions

VALID ROUTES

NONE:
The message is self-contained and can be answered correctly without
any project memory.

TEMPORAL:
Only recent chronological context is necessary.

GRAPH:
Only older entity-based long-term memory is necessary.

BOTH:
Both recent context and long-term graph memory are genuinely
necessary.

STRICT ROUTING RULES

- Prefer the smallest sufficient route.
- Do not select BOTH merely because both systems could contain
  something useful.
- Select BOTH only when removing either memory system would
  materially reduce answer quality.
- Do not answer the user's question.
- Return valid JSON only, no markdown.

OUTPUT SCHEMA

{
  "route": "none" | "temporal" | "graph" | "both",
  "confidence": number between 0 and 1,
  "reason": "short explanation in English"
}
`.trim();

/* -------------------------------------------------------------------------- */
/* Gate Decision                                                              */
/* -------------------------------------------------------------------------- */

const VALID_ROUTES: MemoryRoute[] = [
  "none",
  "temporal",
  "graph",
  "both",
];

/**
 * Parses and validates the gate LLM JSON response.
 */
function parseGateDecision(
  llmResponseText: string,
): MemoryGateDecision {
  const jsonString =
    extractJSONObject(llmResponseText);

  const parsed = JSON.parse(
    jsonString,
  ) as {
    route?: unknown;
    confidence?: unknown;
    reason?: unknown;
  };

  const route = String(parsed.route ?? "")
    .trim()
    .toLowerCase() as MemoryRoute;

  if (!VALID_ROUTES.includes(route)) {
    throw new Error(
      `The memory gate returned an invalid route: "${parsed.route}".`,
    );
  }

  const rawConfidence = Number(
    parsed.confidence,
  );

  const confidence = Number.isFinite(
    rawConfidence,
  )
    ? Math.max(
        0,
        Math.min(1, rawConfidence),
      )
    : 0.5;

  return {
    route,
    confidence,
    reason: String(parsed.reason ?? "").trim(),
  };
}

/**
 * Runs the gate LLM (getAsyncLLM) that selects the memory route
 * for the current user message.
 */
async function routeMemory(
  userMessage: string,
): Promise<MemoryGateDecision> {
  const llm = await getAsyncLLM("cheap", {
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: MEMORY_ROUTE_GATE_PROMPT,
    },
    {
      role: "user",
      content: [
        "CURRENT USER MESSAGE:",
        userMessage,
      ].join("\n"),
    },
  ]);

  const responseText =
    getLLMResponseText(response);

  return parseGateDecision(responseText);
}

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Runs the relevant (temporal) memory system:
 * memoryRetrievalPipeline (continuity gate + episode/window/turn
 * retrieval from the project memory.db).
 *
 * Returns null when no related memory exists.
 */
async function retrieveTemporalMemory(
  userMessage: string,
  projectPath: string,
): Promise<RelatedMemory | null> {
  return retrieveRelatedMemory(
    userMessage,
    getProjectDatabasePath(projectPath),
  );
}

/**
 * Runs the graph memory system:
 * memoryPipeline (entity extraction + entity graph search in
 * memory-graph.db) and returns the ready-to-inject memory text.
 *
 * Returns an empty string when no related memory exists.
 */
async function retrieveGraphMemory(
  userMessage: string,
  projectPath: string,
): Promise<string> {
  const state = await runMemoryPipeline(
    userMessage,
    projectPath,
  );

  return state.memoryContext;
}

/* -------------------------------------------------------------------------- */
/* Comprehensive Context Building                                             */
/* -------------------------------------------------------------------------- */

/**
 * The graph memory text (formatGraphResultAsMemory) starts with its
 * own "RELATED MEMORY" instruction header wrapped in "---" lines.
 * When merging both memory systems into one comprehensive context,
 * only the data section of the graph memory is used, because the
 * wrapper below already provides the instructions.
 */
function extractGraphMemoryDataSection(
  graphMemoryContext: string,
): string {
  const trimmed =
    graphMemoryContext.trim();

  if (!trimmed) {
    return "";
  }

  const separatorPattern =
    /(^|\n)---\s*(\n|$)/;

  const firstSeparator =
    separatorPattern.exec(trimmed);

  if (!firstSeparator) {
    return trimmed;
  }

  const dataStart =
    firstSeparator.index +
    firstSeparator[0].length;

  const dataSection =
    trimmed.slice(dataStart);

  const lastSeparatorMatch =
    /(\n|^)---\s*(\n|$)/.exec(dataSection);

  if (lastSeparatorMatch) {
    return dataSection
      .slice(
        0,
        lastSeparatorMatch.index,
      )
      .trim();
  }

  return dataSection.trim();
}

/**
 * Simple token estimate without an external tokenizer
 * (~3.2 characters per token for Persian and English).
 */
function estimateTokens(
  text: string,
): number {
  if (!text.trim()) {
    return 0;
  }

  return Math.ceil(text.length / 3.2);
}

/**
 * Merges the temporal and graph memory results into one
 * comprehensive memory context text.
 */
function buildComprehensiveContext(
  temporalMemory: RelatedMemory | null,
  graphMemoryContext: string,
): string {
  const temporalSection =
    temporalMemory?.contextText.trim() ?? "";

  const graphSection =
    extractGraphMemoryDataSection(
      graphMemoryContext,
    );

  if (temporalSection && graphSection) {
    return [
      "[RELEVANT CONVERSATION MEMORY (RECENT TURNS)]",
      temporalSection,
      "",
      "[ENTITY GRAPH MEMORY (LONG-TERM FACTS)]",
      graphSection,
    ].join("\n");
  }

  if (temporalSection) {
    return temporalSection;
  }

  if (graphSection) {
    return graphSection;
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* Relevance Filter                                                           */
/* -------------------------------------------------------------------------- */

const MEMORY_RELEVANCE_FILTER_PROMPT = `
You are a memory relevance filter for an AI assistant working on a
user project.

You receive:
1. The user's CURRENT message.
2. A MEMORY block retrieved from the stored memory of previous
   conversations in this project. It may contain metadata lines
   (scores, turn ids, headers in [BRACKETS]) mixed with real memory
   content.

Your job is to select ONLY the parts of the memory that are relevant
to answering the user's CURRENT message.

STRICT RULES

- Copy the relevant parts VERBATIM from the memory. Never rewrite,
  paraphrase, summarize, or complete them.
- Keep the section headers in [BRACKETS] only when you keep content
  from that section below them.
- Drop metadata-only lines (scores, turn ids, similarity numbers)
  UNLESS the memory content directly under them is kept.
- Drop every sentence or block that is NOT relevant to the current
  message, even if it is interesting in general.
- Never add new information, explanations, or comments.
- Return plain text only. No markdown fences, no JSON, no preamble.

If NOTHING in the memory is relevant to the current message, return
exactly:
NONE
`.trim();

/**
 * Marker the filter LLM must return when no memory content is
 * relevant to the current user message.
 */
const MEMORY_NOT_RELEVANT_MARKER = "NONE";

/**
 * Runs the relevance filter LLM (getAsyncLLM) over the merged memory
 * context and returns only the parts relevant to the current user
 * message, copied verbatim from the input.
 *
 * Returns an empty string when nothing is relevant or the filter
 * fails (the filter must never block the pipeline).
 */
async function filterMemoryRelevance(
  userMessage: string,
  memoryContext: string,
): Promise<string> {
  const llm = await getAsyncLLM("cheap", {
    temperature: 0,
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: MEMORY_RELEVANCE_FILTER_PROMPT,
    },
    {
      role: "user",
      content: [
        "CURRENT USER MESSAGE:",
        userMessage,
        "",
        "MEMORY:",
        memoryContext,
      ].join("\n"),
    },
  ]);

  const responseText =
    getLLMResponseText(response).trim();

  if (
    !responseText ||
    responseText.toUpperCase() ===
      MEMORY_NOT_RELEVANT_MARKER
  ) {
    return "";
  }

  return responseText;
}

/* -------------------------------------------------------------------------- */
/* Main Pipeline                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Runs the comprehensive memory pipeline for one user message.
 *
 * 1. The gate LLM (getAsyncLLM) selects the memory route
 *    (none / temporal / graph / both).
 * 2. Only the selected memory systems run. When both are needed,
 *    they run in parallel.
 * 3. The results are merged into one comprehensive memory context.
 * 4. A relevance filter LLM (getAsyncLLM) reads the merged context
 *    plus the user message and keeps only the memory sentences
 *    relevant to the current message (verbatim). The raw merged
 *    context is kept in `unfilteredContext` for debugging.
 *
 * When the gate confidence is below the low-confidence threshold,
 * both memory systems are run for safety.
 *
 * @param userMessage The current user message.
 * @param projectPath The active project ROOT folder (no
 *   .mocu/storage part).
 * @param options Optional pipeline options.
 */
export async function runMemoryContextPipeline(
  userMessage: string,
  projectPath: string,
  options: MemoryContextPipelineOptions = {},
): Promise<ComprehensiveMemoryContext> {
  const normalizedUserMessage =
    userMessage.trim();

  const normalizedProjectPath =
    projectPath.trim();

  if (!normalizedUserMessage) {
    throw new Error(
      "The current user message cannot be empty.",
    );
  }

  if (!normalizedProjectPath) {
    throw new Error(
      "The project folder path cannot be empty.",
    );
  }

  /*
   * Step 1: the gate LLM chooses the memory system.
   */
  let gateDecision =
    await routeMemory(
      normalizedUserMessage,
    );

  /*
   * Low gate confidence: run both memory systems for safety,
   * but keep the original primary route in the decision.
   */
  const lowConfidenceThreshold =
    options.lowConfidenceThreshold ?? 0.65;

  if (
    gateDecision.route !== "none" &&
    gateDecision.confidence <
      lowConfidenceThreshold
  ) {
    gateDecision = {
      ...gateDecision,
      route: "both",
    };
  }

  console.log(
    "[Memory Context Pipeline] Gate decision:",
    gateDecision,
  );

  /*
   * Step 2: run only the selected memory systems.
   */
  let temporalMemory:
    | RelatedMemory
    | null = null;

  let graphMemoryContext = "";

  switch (gateDecision.route) {
    case "none":
      break;

    case "temporal":
      temporalMemory =
        await retrieveTemporalMemory(
          normalizedUserMessage,
          normalizedProjectPath,
        );
      break;

    case "graph":
      graphMemoryContext =
        await retrieveGraphMemory(
          normalizedUserMessage,
          normalizedProjectPath,
        );
      break;

    case "both": {
      const [
        temporalResult,
        graphResult,
      ] = await Promise.all([
        retrieveTemporalMemory(
          normalizedUserMessage,
          normalizedProjectPath,
        ),

        retrieveGraphMemory(
          normalizedUserMessage,
          normalizedProjectPath,
        ),
      ]);

      temporalMemory = temporalResult;
      graphMemoryContext = graphResult;
      break;
    }
  }

  /*
   * Step 3: merge into one raw comprehensive memory context.
   */
  const unfilteredContext =
    buildComprehensiveContext(
      temporalMemory,
      graphMemoryContext,
    );

  /*
   * Step 4: the relevance filter LLM keeps only the memory
   * sentences relevant to the current user message. On any filter
   * failure the raw merged context is kept, so the filter can never
   * lose memory that was already retrieved.
   */
  let comprehensiveContext =
    unfilteredContext;

  if (comprehensiveContext) {
    try {
      comprehensiveContext =
        await filterMemoryRelevance(
          normalizedUserMessage,
          unfilteredContext,
        );

      console.log(
        "[Memory Context Pipeline] Relevance filter:",
        {
          unfilteredLength:
            unfilteredContext.length,
          filteredLength:
            comprehensiveContext.length,
        },
      );
    } catch (error) {
      console.error(
        "[Memory Context Pipeline] Relevance filter failed, keeping the raw merged memory:",
        error,
      );
    }
  }

  const result: ComprehensiveMemoryContext = {
    route: gateDecision.route,
    gateConfidence:
      gateDecision.confidence,
    gateReason: gateDecision.reason,
    temporalMemory,
    graphMemoryContext,
    unfilteredContext,
    comprehensiveContext,
    estimatedTokens: estimateTokens(
      comprehensiveContext,
    ),
  };

  console.log(
    "[Memory Context Pipeline] Result:",
    {
      route: result.route,
      hasTemporalMemory:
        result.temporalMemory !== null,
      graphMemoryLength:
        result.graphMemoryContext.length,
      estimatedTokens:
        result.estimatedTokens,
    },
  );

  if (result.comprehensiveContext) {
    console.log(
      "[Memory Context Pipeline] Comprehensive memory context:\n" +
        result.comprehensiveContext,
    );
  } else {
    console.log(
      "[Memory Context Pipeline] No memory found.",
    );
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Agent Context Formatting                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Formats the comprehensive memory as a prompt section for the
 * project agent system prompt.
 *
 * Returns an empty string when there is no memory or no context
 * text.
 */
export function buildComprehensiveMemoryPrompt(
  memory:
    | ComprehensiveMemoryContext
    | null,
): string {
  if (
    !memory ||
    !memory.comprehensiveContext.trim()
  ) {
    return "";
  }

  return [
    "RELATED MEMORY (PREVIOUS PROJECT CONVERSATIONS)",
    "",
    "The text below was retrieved from the stored memory of previous conversations in this project because it is related to the current request.",
    "It is real previous context from this project — use it when it is relevant, especially for questions about earlier messages, decisions, or code.",
    "It is not part of the current live conversation.",
    "Trust the current user request and the tool results over this memory when they conflict.",
    "Do not claim that this memory comes from the current conversation.",
    "",
    "---",
    memory.comprehensiveContext.trim(),
    "---",
  ].join("\n");
}
