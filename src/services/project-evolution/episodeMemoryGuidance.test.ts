import { describe, expect, it, vi } from "vitest";
import { retrieveEpisodeMemoryGuidance } from "./episodeMemoryGuidance";
import type { EpisodeMemoryLesson } from "./episodeMemoryStore";

const lesson = (overrides: Partial<EpisodeMemoryLesson> = {}): EpisodeMemoryLesson => ({
  id: 1,
  runId: "run-1",
  causes: [{ step: 1, tool: "write_file", args: { path: "src/app.py" }, ok: true }],
  failure: { step: 3, tool: "edit_file", args: { path: "src/app.py" }, ok: false, error: "change was not applied" },
  instruction: "For code files, use the terminal editor and inspect the diff afterward.",
  score: 50,
  successCount: 0,
  failureCount: 0,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("retrieveEpisodeMemoryGuidance", () => {
  it("searches cause and failed-action indexes independently and ranks high-score matches first", async () => {
    const high = lesson({ id: 2, score: 90 });
    const decide = vi.fn(async ({ state }: { state: { retrieval_branch: string } }) => ({
      same_practical_situation: { noul: state.retrieval_branch === "cause" ? 0.94 : 0.01 },
    }));
    const result = await retrieveEpisodeMemoryGuidance(
      { tool: "write_file", args: { path: "src/new.py" } },
      { listLessons: async () => [lesson(), high], decide: decide as never },
    );
    expect(result.reason).toBe("guidance_ready");
    expect(result.matches.map((match) => match.lesson.id)).toEqual([2, 1]);
    expect(result.matches[0].matchedBy).toContain("cause");
    expect(decide).toHaveBeenCalledTimes(4);
  });

  it("does not return guidance for superficial lexical matches rejected by Decision", async () => {
    const result = await retrieveEpisodeMemoryGuidance(
      { tool: "write_file", args: { path: "src/new.py" } },
      {
        listLessons: async () => [lesson()],
        decide: vi.fn(async () => ({ same_practical_situation: { noul: 0.1 } })) as never,
      },
    );
    expect(result.reason).toBe("no_match");
    expect(result.guidance).toBeNull();
  });

  it("returns empty guidance if BM25 has no common tokens", async () => {
    const decide = vi.fn();
    const result = await retrieveEpisodeMemoryGuidance(
      { tool: "desktop_vision_tool", args: { image: "landscape" } },
      { listLessons: async () => [lesson()], decide: decide as never },
    );
    expect(result.reason).toBe("no_candidates");
    expect(decide).not.toHaveBeenCalled();
  });
});
