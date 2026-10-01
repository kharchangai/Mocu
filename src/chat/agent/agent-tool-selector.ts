import { AGENT_TOOL_CATALOG, type AgentToolName } from "./agent-tool-catalog";
import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";

export const DEFAULT_AGENT_TOOL_RELEVANCE_THRESHOLD = 0.6;

type JevAnswer = {
  noul?: unknown;
  probabilities?: Record<string, unknown>;
  value?: unknown;
  answer?: unknown;
};

type JevResponse = {
  answers?: Record<string, JevAnswer>;
};

export type AgentToolSelection = {
  name: AgentToolName;
  relevance: number;
};

const EXPLICIT_TOOL_MENTIONS: Record<AgentToolName, RegExp> = {
  terminal_executor: /\b(?:terminal|shell|command[- ]line)\b|ترمینال|خط\s*فرمان/iu,
  filesystem: /\b(?:file\s*system|filesystem|files?)\b|فایل[\s‌_-]*سیستم|سیستم[\s‌_-]*فایل|فایل(?:‌|\s)*(?:ها|های)/iu,
  documents: /\b(?:documents?|knowledge\s+docs?|docs?)\b|داک|مستند|سند/iu,
  notes: /\bnotes?\b|یادداشت|نوت/iu,
  perplexity_search: /\b(?:web\s+search|perplexity|live\s+web)\b|جستجوی?\s+وب/iu,
  load_skill: /\bskills?\b|مهارت/iu,
  schedule_action: /\b(?:schedule|reminder|calendar|alarm)\b|یادآور|زمان‌بندی/iu,
};

function isExplicitlyRequested(name: AgentToolName, request: string): boolean {
  const match = EXPLICIT_TOOL_MENTIONS[name].exec(request);
  if (!match || match.index === undefined) return false;

  const prefix = request.slice(Math.max(0, match.index - 36), match.index);
  return !(
    /\b(?:do not|don't|without|avoid|exclude|never|no)\b[^,;.!?]{0,24}$/i.test(prefix) ||
    /(?:بدون|نمی‌خواهم|نمیخوام|استفاده نکن)[^،؛.!؟]{0,24}$/u.test(prefix)
  );
}

export function probabilityOfToolRelevance(answer: JevAnswer | undefined): number {
  if (!answer || typeof answer !== "object") return 0;

  const noul = Number(answer.noul);
  if (Number.isFinite(noul)) return Math.max(0, Math.min(1, noul));

  const probabilities = answer.probabilities;
  if (probabilities && typeof probabilities === "object") {
    for (const key of ["true", "yes", "relevant", "related"]) {
      const value = Number(probabilities[key]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(1, value));
    }
  }

  const value = answer.value ?? answer.answer;
  if (typeof value === "boolean") return value ? 1 : 0;
  return 0;
}

/**
 * Match a natural-language agent-creation request to the exact, supported
 * built-in tool names using Jev's typed decisions API.
 */
export async function selectAgentTools(
  userRequest: string,
  options: {
    threshold?: number;
    signal?: AbortSignal;
  } = {},
): Promise<AgentToolSelection[]> {
  const request = userRequest.trim();
  if (!request) throw new Error("A non-empty agent-creation request is required.");

  const threshold = Math.max(0, Math.min(1,
    options.threshold ?? DEFAULT_AGENT_TOOL_RELEVANCE_THRESHOLD,
  ));
  const questions = Object.fromEntries(
    AGENT_TOOL_CATALOG.map((candidate) => [
      candidate.name,
      {
        type: "noul" as const,
        instructions:
          "Given the complete request to create a specialist agent, decide whether this specific tool is materially useful and intended for that agent to carry out the described responsibilities. " +
          "Match by capability and meaning, not by whether the user knows or wrote the tool's exact name. Select it when its capability is clearly needed; do not select it merely because it could be useful in a vague or unrelated way.",
        criteria: {
          true: "This exact tool capability is clearly useful for the requested agent's work.",
          false: "This tool is not clearly needed for the requested agent's work.",
        },
      },
    ]),
  );

  const explicitlyRequested = new Set(
    AGENT_TOOL_CATALOG
      .filter((candidate) => isExplicitlyRequested(candidate.name, request))
      .map((candidate) => candidate.name),
  );

  let response: JevResponse;
  try {
    response = await getJevDecision({
      state: {
        agent_creation_request: request,
        available_tools: AGENT_TOOL_CATALOG,
      },
      questions,
      signal: options.signal,
    }) as JevResponse;
  } catch (error) {
    // Explicitly named capabilities should still be assignable if Jev is
    // temporarily unavailable. Requests with no explicit capability still
    // fail loudly rather than silently creating an under-equipped agent.
    if (explicitlyRequested.size === 0) throw error;
    console.warn(
      "[Agent Tool Selector] Jev unavailable; using explicitly requested tools.",
      error,
    );
    return AGENT_TOOL_CATALOG
      .filter((candidate) => explicitlyRequested.has(candidate.name))
      .map(({ name }) => ({ name, relevance: 1 }));
  }

  return AGENT_TOOL_CATALOG
    .map((candidate) => {
      const relevance = probabilityOfToolRelevance(
        response?.answers?.[candidate.name],
      );
      return {
        name: candidate.name,
        relevance: explicitlyRequested.has(candidate.name)
          ? Math.max(relevance, 1)
          : relevance,
      };
    })
    .filter((selection) =>
      explicitlyRequested.has(selection.name) || selection.relevance >= threshold,
    );
}
