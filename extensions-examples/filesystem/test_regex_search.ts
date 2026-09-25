import assert from "node:assert/strict";
import { search } from "./regex_search.ts";
import { semanticSearch, type DecisionClient } from "./semantic_search.ts";

const folder = "E:/news";
const patterns = ["(?=.*[sS][tT][oO][cC][Kk]).+"];
const extensions = [".txt", ".md", ".json", ".html"];

// Test 1: the first stage still returns the raw regex candidates.
const rawResults = search(folder, patterns, extensions);
assert.ok(Array.isArray(rawResults), "regex search must return an array");
console.log(`Regex candidates: ${rawResults.length}`);

// Test 2: exercise the second stage without creating an extension.
// This fake has the same shape as the Mocu object: extension.decision.ask().
// Replace this object with the real Mocu extension when running inside Mocu.
const fakeExtension: DecisionClient = {
  decision: {
    async ask({ state, questions }) {
      const searchGoal = String(
        (state as { search_goal?: unknown }).search_goal ?? "",
      ).toLowerCase();
      const candidates = (state as {
        candidates?: Array<{ id: string; text: string }>;
      }).candidates ?? [];

      return {
        answers: Object.fromEntries(
          candidates.map((candidate) => {
            const text = candidate.text.toLowerCase();
            const relevant =
              (searchGoal.includes("stock") && text.includes("stock")) ||
              (searchGoal.includes("tesla") && text.includes("tesla"));
            return [candidate.id, {
              probabilities: {
                true: relevant ? 0.95 : 0.05,
                false: relevant ? 0.05 : 0.95,
              },
            }];
          }),
        ),
        question_count: Object.keys(questions).length,
      };
    },
  },
};

const filteredResults = await semanticSearch(fakeExtension, {
  folder,
  query: "Find stock-related text",
  patterns,
  extensions,
  threshold: 0.6,
  batch_size: 32,
});

assert.ok(Array.isArray(filteredResults), "semantic search must return an array");
assert.ok(
  filteredResults.every((result) => result.relevance >= 0.6),
  "every returned result must pass the relevance threshold",
);
assert.ok(
  filteredResults.every((result) => /stock/i.test(result.text)),
  "the fake Jev should keep only stock-related candidates",
);

console.log(`Filtered semantic results: ${filteredResults.length}`);
console.log(JSON.stringify(filteredResults, null, 2));
console.log("Regex and semantic-search tests passed.");
