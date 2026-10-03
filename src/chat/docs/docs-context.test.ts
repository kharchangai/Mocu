import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocSearchResult } from "./doc-search";

const searchMock = vi.hoisted(() => ({
  searchDocs: vi.fn(),
}));

vi.mock("./doc-search", () => searchMock);

import {
  buildDocsContextPrompt,
  escapeDocsMetadata,
  MAX_CONTEXT_DOCS,
} from "./docs-context";
import type { StoredDoc } from "./doc-storage";

// Failure-path tests trigger the expected fail-open warning.
vi.spyOn(console, "warn").mockImplementation(() => undefined);

function makeResult(
  overrides: Partial<StoredDoc> & { file: string },
  extras: { snippet?: string; score?: number } = {},
): DocSearchResult {
  const doc: StoredDoc = {
    id: overrides.file.replace(/\.md$/, ""),
    title: "Title",
    description: "Description.",
    keywords: ["kw"],
    body: "BODY MUST NEVER APPEAR IN THE PROMPT",
    ...overrides,
  };
  return {
    doc,
    score: extras.score ?? 0.9,
    jev: { applied: false, probability: null, weight: 0.5, source: "disabled", hybridScore: 0.9 },
    scores: { bm25: 1, keyword: 1, embedding: null },
    raw: { bm25: 1, keyword: 1, embedding: null },
    snippet: extras.snippet ?? "SNIPPET MUST NEVER APPEAR",
  } as DocSearchResult;
}

beforeEach(() => {
  searchMock.searchDocs.mockReset();
});

describe("buildDocsContextPrompt (unit)", () => {
  it("emits only references + approved metadata — never body or snippet", async () => {
    searchMock.searchDocs.mockResolvedValue([
      makeResult({
        file: "guide.md",
        id: "guide",
        title: "The Guide",
        description: "How to guide things.",
        keywords: ["guide", "howto"],
      }),
    ]);

    const prompt = await buildDocsContextPrompt("guide me");

    expect(searchMock.searchDocs).toHaveBeenCalledWith("guide me", MAX_CONTEXT_DOCS);
    expect(prompt).toContain('file: "guide.md"');
    expect(prompt).toContain("id: guide");
    expect(prompt).toContain("title: The Guide");
    expect(prompt).toContain("description: How to guide things.");
    expect(prompt).toContain("keywords: guide, howto");
    // The agent-read instruction and link guidance.
    expect(prompt).toContain("read_knowledge_doc");
    expect(prompt).toContain("descriptive leads");
    expect(prompt).toContain(`max ${MAX_CONTEXT_DOCS}`);
    // Body/snippet/score never leak.
    expect(prompt).not.toContain("BODY MUST NEVER APPEAR");
    expect(prompt).not.toContain("SNIPPET MUST NEVER APPEAR");
    expect(prompt).not.toMatch(/\b(bm25|embedding|hybridScore|score)\b:/i);
  });

  it("caps the number of references (default and override)", async () => {
    searchMock.searchDocs.mockResolvedValue(
      ["one.md", "two.md", "three.md"].map((file) => makeResult({ file })),
    );

    const defaultPrompt = await buildDocsContextPrompt("anything");
    const defaultRefs = defaultPrompt
      .split("\n")
      .filter((line) => line.startsWith("- file:"));
    expect(defaultRefs).toHaveLength(MAX_CONTEXT_DOCS);

    searchMock.searchDocs.mockResolvedValue(
      ["one.md", "two.md", "three.md"].map((file) => makeResult({ file })),
    );
    const cappedPrompt = await buildDocsContextPrompt("anything", { docsLimit: 1 });
    expect(
      cappedPrompt.split("\n").filter((line) => line.startsWith("- file:")),
    ).toHaveLength(1);
    expect(searchMock.searchDocs).toHaveBeenLastCalledWith("anything", 1);
  });

  it("applies the search limit and slices defensively", async () => {
    searchMock.searchDocs.mockResolvedValue([
      makeResult({ file: "a.md" }),
      makeResult({ file: "b.md" }),
    ]);

    const prompt = await buildDocsContextPrompt("q", { docsLimit: 5 });
    // Search limit forwarded; a result list longer than the default cap is
    // still truncated to the default when no explicit limit... here an
    // explicit limit of 5 is used, so all 2 pass.
    expect(searchMock.searchDocs).toHaveBeenCalledWith("q", 5);
    expect(prompt.match(/- file:/g)).toHaveLength(2);
  });

  it("falls back to the default cap for invalid docsLimit values", async () => {
    searchMock.searchDocs.mockResolvedValue([makeResult({ file: "a.md" })]);
    await buildDocsContextPrompt("q", { docsLimit: 0 });
    expect(searchMock.searchDocs).toHaveBeenLastCalledWith("q", MAX_CONTEXT_DOCS);

    searchMock.searchDocs.mockResolvedValue([makeResult({ file: "a.md" })]);
    await buildDocsContextPrompt("q", { docsLimit: Number.NaN });
    expect(searchMock.searchDocs).toHaveBeenLastCalledWith("q", MAX_CONTEXT_DOCS);
  });

  it("returns '' on empty input without searching", async () => {
    expect(await buildDocsContextPrompt("   ")).toBe("");
    expect(searchMock.searchDocs).not.toHaveBeenCalled();
  });

  it("fails open: '' on no matches and on a thrown search", async () => {
    searchMock.searchDocs.mockResolvedValue([]);
    expect(await buildDocsContextPrompt("nothing matches")).toBe("");

    searchMock.searchDocs.mockRejectedValue(new Error("index exploded"));
    expect(await buildDocsContextPrompt("anything")).toBe("");
  });

  it("escapes hostile metadata (markdown, HTML, control chars)", async () => {
    searchMock.searchDocs.mockResolvedValue([
      makeResult({
        file: "hostile.md",
        title: "evil **title** <b>bold</b>\nsecond line",
        description: "[click](http://evil) `code` _under_",
        keywords: ["a_b", "# heading"],
      }),
    ]);

    const prompt = await buildDocsContextPrompt("evil");

    expect(prompt).not.toContain("**title**");
    expect(prompt).toContain("\\*\\*title\\*");
    expect(prompt).not.toContain("<b>");
    expect(prompt).toContain("&lt;b&gt;");
    expect(prompt).not.toContain("\nsecond line"); // control char neutralized
    expect(prompt).toContain("\\[click\\]");
    expect(prompt).toContain("\\_under\\_");
    expect(prompt).toContain("a\\_b");
    // The reference structure survives escaping.
    expect(prompt).toContain('file: "hostile.md"');
    expect(prompt).toContain("title: evil");
  });
});

describe("escapeDocsMetadata", () => {
  it("neutralizes every dangerous character class", () => {
    expect(escapeDocsMetadata("a\nb")).toBe("a b");
    expect(escapeDocsMetadata("a\tb\rc")).toBe("a b c");
    expect(escapeDocsMetadata("**x**")).toBe("\\*\\*x\\*\\*");
    expect(escapeDocsMetadata("[y](z)")).toBe("\\[y\\](z)");
    expect(escapeDocsMetadata("<tag>")).toBe("&lt;tag&gt;");
    expect(escapeDocsMetadata("`tick`")).toBe("\\`tick\\`");
    expect(escapeDocsMetadata("## head")).toBe("\\#\\# head");
    expect(escapeDocsMetadata("under_score")).toBe("under\\_score");
    expect(escapeDocsMetadata("back\\slash")).toBe("back\\\\slash");
    expect(escapeDocsMetadata("   spaced   ")).toBe("spaced");
    expect(escapeDocsMetadata("")).toBe("");
  });

  it("truncates over-long fields with an ellipsis", async () => {
    searchMock.searchDocs.mockResolvedValue([
      makeResult({
        file: "long.md",
        description: "x".repeat(1000),
      }),
    ]);

    const prompt = await buildDocsContextPrompt("long");
    const descriptionLine = prompt
      .split("\n")
      .find((line) => line.includes("description:"))!;
    expect(descriptionLine.length).toBeLessThan(400);
    expect(descriptionLine).toContain("…");
  });
});