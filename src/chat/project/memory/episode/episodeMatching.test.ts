// episode/episodeMatching.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

const { compareEmbeddingToEmbedding } = vi.hoisted(() => ({
  compareEmbeddingToEmbedding: vi.fn(),
}));

vi.mock(
  "../../../../services/ai/tools/textSimilarity",
  () => ({
    textSimilarity: {
      embedText: vi.fn(),
      compareEmbeddingToEmbedding,
    },
  }),
);

import {
  findBestEpisodeCandidate,
  scoreEpisodeCandidate,
} from "./episodeMatching";
import type {
  EpisodeManagerConfig,
  MemoryEpisode,
} from "./types";
import {
  COOKING_VECTOR,
  DATABASE_VECTOR,
  cosineSimilarity,
  createTestWindow,
} from "./testing/testHelpers";
import type { MemoryWindow } from "../window/types";

const CONFIG: EpisodeManagerConfig = {
  similarityThreshold: 0.38,
  embeddingWeight: 0.6,
  keywordWeight: 0.25,
  entityWeight: 0.15,
};

function createTestEpisode(options: {
  id: string;
  subjects: string[];
  keywords?: string[];
  entityNormalized?: string[];
  vector: number[];
}): MemoryEpisode {
  const now = "2024-01-01T00:00:00.000Z";

  return {
    id: options.id,
    sessionId: "default",
    windowIds: ["window-0"],
    indexes: {
      subject: options.subjects[0] ?? "",
      subjects: options.subjects,
      keywords: options.keywords ?? [],
      types: [],
      entities: (options.entityNormalized ?? []).map(
        (normalized) => ({
          text: normalized,
          normalized,
          type: "technology",
        }),
      ),
      embedding: [...options.vector],
    },
    status: "open",
    estimatedTokens: 100,
    startedAt: now,
    updatedAt: now,
  };
}

describe("scoreEpisodeCandidate", () => {
  beforeEach(() => {
    compareEmbeddingToEmbedding.mockReset();
    compareEmbeddingToEmbedding.mockImplementation(
      cosineSimilarity,
    );
  });

  it("gives a full score to an identical Window", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
      entities: [
        {
          text: "postgres",
          normalized: "postgres",
          type: "technology",
        },
      ],
    });

    const episode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      entityNormalized: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const score = scoreEpisodeCandidate(
      window,
      episode,
      CONFIG,
    );

    expect(score.score).toBeCloseTo(1, 5);
    expect(score.embeddingSimilarity).toBeCloseTo(
      1,
      5,
    );
    expect(score.keywordOverlap).toBe(1);
    expect(score.entityOverlap).toBe(1);
  });

  it("gives a low score to an unrelated Window", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Cooking a pasta recipe"],
      keywords: ["pasta", "recipe"],
      vector: COOKING_VECTOR,
    });

    const episode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const score = scoreEpisodeCandidate(
      window,
      episode,
      CONFIG,
    );

    expect(score.score).toBeLessThan(0.2);
  });

  it("uses the normalized entity identity for the entity overlap", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      vector: DATABASE_VECTOR,
      entities: [
        {
          text: "PostgreSQL",
          normalized: "postgresql",
          type: "technology",
        },
        {
          text: "unknown entity",
          normalized: "unknown entity",
          type: "technology",
        },
      ],
    });

    const episode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      entityNormalized: ["postgresql"],
      vector: DATABASE_VECTOR,
    });

    const score = scoreEpisodeCandidate(
      window,
      episode,
      CONFIG,
    );

    expect(score.entityOverlap).toBeCloseTo(0.5, 5);
  });

  it("treats a dimension mismatch as missing embedding evidence", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: [1, 2, 3],
    });

    const episode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const score = scoreEpisodeCandidate(
      window,
      episode,
      CONFIG,
    );

    expect(score.embeddingSimilarity).toBe(0);
    expect(score.keywordOverlap).toBe(1);
  });

  it("normalizes the configured weights", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const episode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const scaledConfig: EpisodeManagerConfig = {
      similarityThreshold: 0.38,
      embeddingWeight: 6,
      keywordWeight: 2.5,
      entityWeight: 1.5,
    };

    const defaultScore = scoreEpisodeCandidate(
      window,
      episode,
      CONFIG,
    );

    const scaledScore = scoreEpisodeCandidate(
      window,
      episode,
      scaledConfig,
    );

    expect(scaledScore.score).toBeCloseTo(
      defaultScore.score,
      5,
    );
  });

  it("compares embeddings with the cosine similarity", () => {
    expect(
      cosineSimilarity(
        DATABASE_VECTOR,
        DATABASE_VECTOR,
      ),
    ).toBeCloseTo(1, 5);

    expect(
      cosineSimilarity(
        DATABASE_VECTOR,
        COOKING_VECTOR,
      ),
    ).toBeLessThan(0.2);
  });
});

describe("findBestEpisodeCandidate", () => {
  it("returns the best candidate above the threshold", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      vector: DATABASE_VECTOR,
    });

    const weakerEpisode = createTestEpisode({
      id: "episode-weaker",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const strongerEpisode = createTestEpisode({
      id: "episode-stronger",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      vector: DATABASE_VECTOR,
    });

    const best = findBestEpisodeCandidate(
      window,
      [weakerEpisode, strongerEpisode],
      CONFIG,
    );

    expect(best?.episode.id).toBe(
      "episode-stronger",
    );
  });

  it("returns null when no candidate reaches the threshold", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Cooking a pasta recipe"],
      keywords: ["pasta"],
      vector: COOKING_VECTOR,
    });

    const unrelatedEpisode = createTestEpisode({
      id: "episode-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      vector: DATABASE_VECTOR,
    });

    const best = findBestEpisodeCandidate(
      window,
      [unrelatedEpisode],
      CONFIG,
    );

    expect(best).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    const window: MemoryWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      vector: DATABASE_VECTOR,
    });

    const best = findBestEpisodeCandidate(
      window,
      [],
      CONFIG,
    );

    expect(best).toBeNull();
  });
});
