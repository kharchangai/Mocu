// episode/episodeIndexes.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmInvoke, embedText } = vi.hoisted(() => ({
  llmInvoke: vi.fn(),
  embedText: vi.fn(),
}));

vi.mock("../storage/databaseManager", async () => {
  return await import("./testing/mockDatabaseManager");
});

vi.mock("../../../../services/ai/llm", () => ({
  getAsyncLLM: vi.fn(async () => ({
    invoke: llmInvoke,
  })),
}));

vi.mock(
  "../../../../services/ai/tools/textSimilarity",
  () => ({
    textSimilarity: {
      embedText,
      compareEmbeddingToEmbedding: vi.fn(),
    },
  }),
);

import {
  buildEpisodeIndexes,
  createEpisodeEmbeddingText,
  mergeWindowEntities,
} from "./episodeIndexes";
import {
  DATABASE_VECTOR,
  createTestWindow,
} from "./testing/testHelpers";

describe("buildEpisodeIndexes", () => {
  beforeEach(() => {
    llmInvoke.mockReset();
    embedText.mockReset();

    embedText.mockImplementation(async (text: string) => [
      text.length,
    ]);
  });

  it("creates the general subject without an LLM call when there is only one Window subject", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"should not be used"}',
    });

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      window,
    ]);

    expect(indexes.subject).toBe(
      "Database schema design",
    );

    expect(llmInvoke).not.toHaveBeenCalled();
  });

  it("uses the LLM to create one general subject for several Windows", async () => {
    llmInvoke.mockResolvedValue({
      content:
        '{"subject":"Database engineering"}',
    });

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      firstWindow,
      secondWindow,
    ]);

    expect(indexes.subject).toBe(
      "Database engineering",
    );

    expect(llmInvoke).toHaveBeenCalledTimes(1);

    /*
     * The LLM receives compact Window indexes and no raw Turns.
     */
    const promptText = JSON.stringify(
      llmInvoke.mock.calls[0],
    );

    expect(promptText).toContain("windows");

    expect(promptText).toContain(
      "Database schema design",
    );

    expect(promptText).not.toContain(
      "User message about",
    );
  });

  it("falls back to the first Window subject when the LLM call fails", async () => {
    llmInvoke.mockRejectedValue(
      new Error("The LLM is not configured."),
    );

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: [],
      types: [],
      vector: DATABASE_VECTOR,
    });

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: [],
      types: [],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      firstWindow,
      secondWindow,
    ]);

    expect(indexes.subject).toBe(
      "Database schema design",
    );
  });

  it("merges keywords without case-insensitive duplicates and keeps the first representation", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["First subject"],
      keywords: ["Postgres", "SQL"],
      types: [],
      vector: DATABASE_VECTOR,
    });

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Second subject"],
      keywords: [
        "  postgres  ",
        "sql",
        "indexes",
      ],
      types: [],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      firstWindow,
      secondWindow,
    ]);

    expect(indexes.keywords).toEqual([
      "Postgres",
      "SQL",
      "indexes",
    ]);
  });

  it("merges types without duplicates", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["First subject"],
      types: ["question", "decision"],
      vector: DATABASE_VECTOR,
    });

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Second subject"],
      types: ["Question", "planning"],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      firstWindow,
      secondWindow,
    ]);

    /*
     * Types are deduplicated case-insensitively and the first
     * representation wins.
     */
    expect(indexes.types).toEqual([
      "question",
      "decision",
      "planning",
    ]);
  });

  it("merges entities using the normalized entity identity", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["First subject"],
      vector: DATABASE_VECTOR,
      entities: [
        {
          text: "PostgreSQL",
          normalized: "postgresql",
          type: "technology",
        },
      ],
    });

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Second subject"],
      vector: DATABASE_VECTOR,
      entities: [
        {
          text: "postgresql",
          normalized: "postgresql",
          type: "technology",
        },
        {
          text: "psql",
          normalized: "psql",
          type: "technology",
        },
      ],
    });

    const indexes = await buildEpisodeIndexes([
      firstWindow,
      secondWindow,
    ]);

    expect(indexes.entities).toEqual([
      {
        text: "PostgreSQL",
        normalized: "postgresql",
        type: "technology",
      },
      {
        text: "psql",
        normalized: "psql",
        type: "technology",
      },
    ]);
  });

  it("keeps entities of different types separate", () => {
    const merged = mergeWindowEntities([
      {
        text: "Mercury",
        normalized: "mercury",
        type: "product",
      },
      {
        text: "Mercury",
        normalized: "mercury",
        type: "person",
      },
    ]);

    expect(merged).toHaveLength(2);
  });

  it("creates the embedding from the canonical Episode index text", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"Database work"}',
    });

    embedText.mockImplementation(
      async (text: string) => [text],
    );

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      entities: [
        {
          text: "users table",
          normalized: "users table",
          type: "other",
        },
      ],
    });

    const indexes = await buildEpisodeIndexes([
      window,
    ]);

    const embeddingText = indexes.embedding[0];

    /*
     * A single Window subject is used directly as the general
     * subject without an LLM call.
     */
    expect(embeddingText).toBe(
      [
        "Subject: Database schema",
        "Window subjects:",
        "- Database schema",
        "Keywords: postgres",
        "Types: question",
        "Entities: users table",
      ].join("\n"),
    );

    expect(embedText).toHaveBeenCalledTimes(1);
  });

  it("handles empty keyword and entity lists safely", async () => {
    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Only subject"],
      keywords: [],
      types: [],
      vector: DATABASE_VECTOR,
    });

    const indexes = await buildEpisodeIndexes([
      window,
    ]);

    expect(indexes.keywords).toEqual([]);
    expect(indexes.entities).toEqual([]);

    expect(indexes.embedding).toEqual([
      [
        "Subject: Only subject",
        "Window subjects:",
        "- Only subject",
        "Keywords: ",
        "Types: ",
        "Entities: ",
      ].join("\n").length,
    ]);
  });

  it("throws when no Window subject is available", async () => {
    const window = createTestWindow({
      id: "window-1",
      subjects: [],
      vector: DATABASE_VECTOR,
    });

    await expect(
      buildEpisodeIndexes([window]),
    ).rejects.toThrow(
      "Episode indexes require at least one Window subject.",
    );
  });

  it("throws when no Window is provided", async () => {
    await expect(
      buildEpisodeIndexes([]),
    ).rejects.toThrow(
      "Episode indexes require at least one Window.",
    );
  });

  it("builds the documented canonical embedding text shape", () => {
    const text = createEpisodeEmbeddingText(
      "Database work",
      ["Database schema", "Migrations"],
      ["postgres", "sql"],
      ["question"],
      ["users table"],
    );

    expect(text).toBe(
      [
        "Subject: Database work",
        "Window subjects:",
        "- Database schema",
        "- Migrations",
        "Keywords: postgres, sql",
        "Types: question",
        "Entities: users table",
      ].join("\n"),
    );

    expect(text).not.toContain("window-");
    expect(text).not.toContain("2024-");
  });
});
