import { getJevDecision } from "../../services/ai/tools/decision/Jev_model";
import { Bm25Index } from "./bm25";
import { searchDocs } from "./doc-search";
import type { StoredDoc } from "./doc-storage";

/** Maximum sections sent to Jev in a single choice question. */
const MAX_SECTIONS = 15;

/** A section of a doc: one "## ..." heading plus its content. */
export type DocSection = {
  /** 0-based position of the section inside the doc. */
  index: number;
  title: string;
  content: string;
};

export type SectionRelevance = {
  section: DocSection;
  /** 0..1 relevance probability for the user input. */
  probability: number;
};

export type RelevantSectionResult = {
  /** The doc that BM25 search ranked first. */
  doc: StoredDoc;
  /** All sections of that doc. */
  sections: DocSection[];
  /** Per-section relevance, best first. */
  ranking: SectionRelevance[];
  /** Convenience alias: ranking[0]?.section ?? null. */
  best: DocSection | null;
  /** How relevance was computed: the Jev model or a BM25 fallback. */
  source: "jev" | "bm25-fallback";
};

/**
 * Splits a doc body into sections at "## ..." headings. Content before the
 * first heading becomes the "Overview" section.
 */
export function splitDocIntoSections(body: string): DocSection[] {
  const lines = body.split(/\r?\n/);

  const sections: DocSection[] = [];
  let currentTitle = "Overview";
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content || sections.length === 0) {
      sections.push({
        index: sections.length,
        title: currentTitle,
        content: content || currentTitle,
      });
    }
  };

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);

    if (heading) {
      flush();
      currentTitle = heading[1].replace(/^#+\s*/, "").trim() || "Untitled";
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  flush();

  return sections;
}

/**
 * The complete "understand what the user wants" step for ONE doc:
 *
 *   1. BM25-search the saved docs with the user input.
 *   2. Take the most relevant doc and split it into sections.
 *   3. Ask the Jev decision model ONE question where every section is a
 *      choice option, so it picks the section matching the user input.
 *   4. Return per-section relevance (from Jev's probability distribution),
 *      best section first.
 *
 * If the Jev model is not configured or fails, section relevance falls back
 * to BM25 over the section texts, so the pipeline always returns something.
 */
export async function findRelevantSection(
  userInput: string,
  options: { docsLimit?: number } = {},
): Promise<RelevantSectionResult | null> {
  const results = await findRelevantSectionsForDocs(userInput, {
    docsLimit: options.docsLimit ?? 1,
  });

  return results[0] ?? null;
}

/**
 * Same pipeline as findRelevantSection, but for EACH of the top matching
 * docs: search finds up to docsLimit docs, and every doc gets its own
 * section-relevance analysis (one Jev call per doc).
 */
export async function findRelevantSectionsForDocs(
  userInput: string,
  options: { docsLimit?: number } = {},
): Promise<RelevantSectionResult[]> {
  const trimmedInput = userInput.trim();

  if (!trimmedInput) {
    return [];
  }

  // 1. Find the most relevant docs.
  const searchResults = await searchDocs(
    trimmedInput,
    options.docsLimit ?? 2,
  );

  if (searchResults.length === 0) {
    return [];
  }

  // 2+3. Analyze every doc separately so one failing doc cannot block the rest.
  const results: RelevantSectionResult[] = [];

  for (const searchResult of searchResults) {
    results.push(
      await analyzeDocSections(trimmedInput, searchResult.doc),
    );
  }

  return results;
}

async function analyzeDocSections(
  userInput: string,
  doc: StoredDoc,
): Promise<RelevantSectionResult> {
  const sections = splitDocIntoSections(doc.body).slice(0, MAX_SECTIONS);

  if (sections.length === 0) {
    return {
      doc,
      sections: [],
      ranking: [],
      best: null,
      source: "bm25-fallback",
    };
  }

  // 4. Ask Jev which section matches, with a BM25 fallback.
  try {
    const ranking = await rankSectionsWithJev(userInput, sections);
    return {
      doc,
      sections,
      ranking,
      best: ranking[0]?.section ?? null,
      source: "jev",
    };
  } catch {
    const ranking = rankSectionsWithBm25(userInput, sections);
    return {
      doc,
      sections,
      ranking,
      best: ranking[0]?.section ?? null,
      source: "bm25-fallback",
    };
  }
}

async function rankSectionsWithJev(
  userInput: string,
  sections: DocSection[],
): Promise<SectionRelevance[]> {
  // Every section becomes a choice option: keys "1".."N", values are the
  // section titles. One API call covers all sections at once.
  const criteria: Record<string, string> = {};
  for (const section of sections) {
    criteria[String(section.index + 1)] = section.title.slice(0, 100);
  }

  const response = (await getJevDecision({
    state: userInput,
    questions: {
      relevant_section: {
        type: "choice",
        instructions:
          "The user said the text below. Which section of the document is most related to it? Choose exactly one option.",
        criteria,
      },
    },
  })) as JevDecisionsResponse;

  const answer = response.answers?.relevant_section;

  if (!answer) {
    throw new Error("Jev response is missing the relevant_section answer.");
  }

  // Ranking 1: explicit probability distribution over the options, when the
  // API returns one. This gives a relevance value for EVERY section.
  const probabilities = answer.probabilities;

  if (
    probabilities &&
    typeof probabilities === "object" &&
    !Array.isArray(probabilities)
  ) {
    const ranking = probabilitiesToRanking(
      probabilities as Record<string, unknown>,
      sections,
    );
    if (ranking.length > 0) {
      return ranking;
    }
  }

  // Ranking 2: fall back to the single chosen option.
  const chosenKey = extractChoiceKey(answer);
  const chosenIndex = chosenKey === null ? null : Number(chosenKey) - 1;

  if (chosenIndex !== null && sections[chosenIndex]) {
    return [
      { section: sections[chosenIndex], probability: 1 },
      ...sections
        .filter((section) => section.index !== chosenIndex)
        .map((section) => ({ section, probability: 0 })),
    ];
  }

  throw new Error("Jev returned an unrecognized answer shape.");
}

type JevAnswer = {
  choice?: unknown;
  value?: unknown;
  answer?: unknown;
  selected?: unknown;
  probabilities?: unknown;
};

type JevDecisionsResponse = {
  answers?: Record<string, JevAnswer>;
} & Record<string, unknown>;

function extractChoiceKey(answer: JevAnswer): string | null {
  const candidates = [answer.choice, answer.value, answer.answer, answer.selected];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number") {
      return String(candidate);
    }
  }

  return null;
}

function probabilitiesToRanking(
  probabilities: Record<string, unknown>,
  sections: DocSection[],
): SectionRelevance[] {
  const ranking: SectionRelevance[] = [];

  for (const [key, rawProbability] of Object.entries(probabilities)) {
    const index = Number(key) - 1;
    const probability = typeof rawProbability === "number" ? rawProbability : Number(rawProbability);

    if (Number.isFinite(probability) && sections[index]) {
      ranking.push({ section: sections[index], probability });
    }
  }

  return ranking.sort((a, b) => b.probability - a.probability);
}

function rankSectionsWithBm25(
  userInput: string,
  sections: DocSection[],
): SectionRelevance[] {
  const index = new Bm25Index();

  for (const section of sections) {
    index.addDocument(String(section.index), `${section.title}\n${section.content}`);
  }

  const ranked = index.search(userInput, sections.length);

  const probabilityById = new Map(
    ranked.map((entry, position) => [
      entry.id,
      // Convert BM25 scores into a descending 1..0 relevance.
      1 - position / Math.max(1, ranked.length),
    ]),
  );

  return sections
    .map((section) => ({
      section,
      probability: probabilityById.get(String(section.index)) ?? 0,
    }))
    .sort((a, b) => b.probability - a.probability);
}
