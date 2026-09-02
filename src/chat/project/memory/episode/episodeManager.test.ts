// episode/episodeManager.test.ts

import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmInvoke, embedText, compareEmbeddingToEmbedding } =
  vi.hoisted(() => ({
    llmInvoke: vi.fn(),
    embedText: vi.fn(),
    compareEmbeddingToEmbedding: vi.fn(),
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
      compareEmbeddingToEmbedding,
    },
  }),
);

import { EpisodeManager } from "./EpisodeManager";
import {
  __failUpsertOnNextCall,
  __getRecordData,
  __resetDatabase,
  databaseManager,
} from "./testing/mockDatabaseManager";
import {
  COOKING_VECTOR,
  DATABASE_VECTOR,
  cosineSimilarity,
  createTestWindow,
  vectorForText,
} from "./testing/testHelpers";
import type { MemoryWindow } from "../window/types";
import type { MemoryEpisode } from "./types";

async function createManager(): Promise<EpisodeManager> {
  return new EpisodeManager();
}

describe("EpisodeManager.addWindow", () => {
  beforeEach(() => {
    __resetDatabase();

    llmInvoke.mockReset();
    embedText.mockReset();
    compareEmbeddingToEmbedding.mockReset();

    /*
     * The mocked embedding service maps texts deterministically to
     * topic vectors, so related texts produce a similarity of 1 and
     * unrelated texts produce a similarity near 0.
     */
    embedText.mockImplementation(vectorForText);

    compareEmbeddingToEmbedding.mockImplementation(
      cosineSimilarity,
    );

    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });
  });

  it("creates a new Episode for the first Window", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const result =
      await episodeManager.addWindow(window);

    expect(result.action).toBe("created");
    expect(result.episodeId).toBe(
      result.episode.id,
    );

    expect(result.episode.windowIds).toEqual([
      "window-1",
    ]);

    expect(result.episode.status).toBe("open");
    expect(result.episode.sessionId).toBe(
      "default",
    );

    expect(result.episode.indexes.subjects).toEqual(
      ["Database schema design"],
    );

    expect(result.episode.estimatedTokens).toBe(100);
  });

  it("appends a related Window to an existing Episode", async () => {
    const episodeManager = await createManager();

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres", "schema"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const firstResult =
      await episodeManager.addWindow(firstWindow);

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql", "migration"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    const secondResult =
      await episodeManager.addWindow(secondWindow);

    expect(secondResult.action).toBe("appended");
    expect(secondResult.episodeId).toBe(
      firstResult.episodeId,
    );

    expect(
      secondResult.episode.windowIds,
    ).toEqual(["window-1", "window-2"]);

    expect(
      secondResult.episode.indexes.subjects,
    ).toEqual([
      "Database schema design",
      "Database migration script",
    ]);

    expect(
      secondResult.episode.estimatedTokens,
    ).toBe(200);
  });

  it("creates another Episode for an unrelated Window", async () => {
    const episodeManager = await createManager();

    const databaseWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    await episodeManager.addWindow(
      databaseWindow,
    );

    const cookingWindow = createTestWindow({
      id: "window-2",
      subjects: ["Cooking a pasta recipe"],
      keywords: ["pasta", "recipe"],
      types: ["question"],
      vector: COOKING_VECTOR,
    });

    const result =
      await episodeManager.addWindow(
        cookingWindow,
      );

    expect(result.action).toBe("created");
    expect(result.episode.windowIds).toEqual([
      "window-2",
    ]);

    const allEpisodes =
      await episodeManager.getAllEpisodes();

    expect(allEpisodes).toHaveLength(2);
  });

  it("does not duplicate the Window id when the same Window is processed again", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    await episodeManager.addWindow(window);

    const windowCopy = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      episodeId: undefined,
    });

    const result =
      await episodeManager.addWindow(windowCopy);

    expect(result.action).toBe("appended");

    const [episode] =
      await episodeManager.getAllEpisodes();

    expect(episode?.windowIds).toEqual([
      "window-1",
    ]);
  });

  it('returns "updated" when an assigned Window is reprocessed', async () => {
    const episodeManager = await createManager();

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const firstResult =
      await episodeManager.addWindow(firstWindow);

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    await episodeManager.addWindow(secondWindow);

    const reassignedFirstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      episodeId: firstResult.episodeId,
    });

    const result =
      await episodeManager.addWindow(
        reassignedFirstWindow,
      );

    expect(result.action).toBe("updated");
    expect(result.episodeId).toBe(
      firstResult.episodeId,
    );

    const [episode] =
      await episodeManager.getAllEpisodes();

    expect(episode?.windowIds).toEqual([
      "window-1",
      "window-2",
    ]);
  });

  it("rebuilds the Episode indexes after an assigned Window changes", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      estimatedTokens: 100,
    });

    const firstResult =
      await episodeManager.addWindow(window);

    expect(
      firstResult.episode.indexes.keywords,
    ).toEqual(["postgres"]);

    const changedWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres", "migration"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      estimatedTokens: 160,
      episodeId: firstResult.episodeId,
    });

    const result =
      await episodeManager.addWindow(
        changedWindow,
      );

    expect(result.action).toBe("updated");

    expect(result.episode.indexes.keywords).toEqual(
      ["postgres", "migration"],
    );

    expect(result.episode.estimatedTokens).toBe(
      160,
    );
  });

  it("only selects Episodes of the same session", async () => {
    const episodeManager = await createManager();

    const firstSessionWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      sessionId: "session-1",
    });

    const firstResult =
      await episodeManager.addWindow(
        firstSessionWindow,
      );

    const secondSessionWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      sessionId: "session-2",
    });

    const secondResult =
      await episodeManager.addWindow(
        secondSessionWindow,
      );

    expect(secondResult.action).toBe("created");
    expect(secondResult.episodeId).not.toBe(
      firstResult.episodeId,
    );

    expect(secondResult.episode.sessionId).toBe(
      "session-2",
    );

    const firstSessionEpisodes =
      await episodeManager.getEpisodesForSession(
        "session-1",
      );

    expect(firstSessionEpisodes).toHaveLength(1);

    expect(
      firstSessionEpisodes[0]?.windowIds,
    ).toEqual(["window-1"]);
  });

  it("persists both sides of the relationship", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const result =
      await episodeManager.addWindow(window);

    const storedEpisode =
      __getRecordData<MemoryEpisode>(
        result.episodeId,
      );

    expect(storedEpisode?.windowIds).toEqual([
      "window-1",
    ]);

    expect(storedEpisode?.sessionId).toBe(
      "default",
    );

    const storedWindow =
      __getRecordData<MemoryWindow>("window-1");

    expect(storedWindow?.episodeId).toBe(
      result.episodeId,
    );

    /*
     * The Window record was written through the Window storage
     * conventions.
     */
    expect(
      (await databaseManager.getByType("window"))
        .length,
    ).toBe(1);
  });

  it("does not select a closed Episode for a new Window", async () => {
    const episodeManager = await createManager();

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const firstResult =
      await episodeManager.addWindow(firstWindow);

    await episodeManager.closeEpisodeById(
      firstResult.episodeId,
    );

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    const result =
      await episodeManager.addWindow(secondWindow);

    expect(result.action).toBe("created");

    const allEpisodes =
      await episodeManager.getAllEpisodes();

    expect(allEpisodes).toHaveLength(2);

    const closedEpisode = allEpisodes.find(
      (episode) =>
        episode.id === firstResult.episodeId,
    );

    expect(closedEpisode?.status).toBe("closed");

    expect(closedEpisode?.windowIds).toEqual([
      "window-1",
    ]);
  });

  it("propagates embedding failures and leaves no partial Episode", async () => {
    const episodeManager = await createManager();

    embedText.mockRejectedValue(
      new Error(
        "The embedding model is not configured.",
      ),
    );

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    await expect(
      episodeManager.addWindow(window),
    ).rejects.toThrow(
      "Could not create the Episode embedding",
    );

    const allEpisodes =
      await episodeManager.getAllEpisodes();

    expect(allEpisodes).toHaveLength(0);
  });

  it("falls back to a deterministic subject when the LLM fails", async () => {
    const episodeManager = await createManager();

    llmInvoke.mockRejectedValue(
      new Error("The LLM is not configured."),
    );

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    await episodeManager.addWindow(firstWindow);

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    const result =
      await episodeManager.addWindow(secondWindow);

    expect(result.action).toBe("appended");

    /*
     * The LLM failure falls back to the subject of the first
     * Window of the Episode.
     */
    expect(
      result.episode.indexes.subject,
    ).toBe("Database schema design");
  });

  it("restores the previous Episode when the Window update fails after appending", async () => {
    const episodeManager = await createManager();

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const firstResult =
      await episodeManager.addWindow(firstWindow);

    /*
     * The next upsert call is the Episode save for the rebuild, and
     * the call after it is the Window save. Only the Window save
     * fails.
     */
    __failUpsertOnNextCall(
      1,
      "The database is locked.",
    );

    const secondWindow = createTestWindow({
      id: "window-2",
      subjects: ["Database migration script"],
      keywords: ["sql"],
      types: ["instruction"],
      vector: DATABASE_VECTOR,
    });

    await expect(
      episodeManager.addWindow(secondWindow),
    ).rejects.toThrow("The database is locked.");

    const storedEpisode =
      __getRecordData<MemoryEpisode>(
        firstResult.episodeId,
      );

    expect(storedEpisode?.windowIds).toEqual([
      "window-1",
    ]);

    const storedSecondWindow =
      __getRecordData<MemoryWindow>("window-2");

    expect(
      storedSecondWindow?.episodeId,
    ).toBeUndefined();
  });

  it("removes a created Episode when the Window update fails", async () => {
    const episodeManager = await createManager();

    /*
     * The next upsert call is the Episode insert. It fails.
     */
    __failUpsertOnNextCall(
      0,
      "The database is read-only.",
    );

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    await expect(
      episodeManager.addWindow(window),
    ).rejects.toThrow(
      "The database is read-only.",
    );

    const allEpisodes =
      await episodeManager.getAllEpisodes();

    expect(allEpisodes).toHaveLength(0);
  });

  it("keeps an Episode consistent when the Window update fails during creation rollback", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    /*
     * The next upsert call is the Episode insert, which succeeds.
     * The call after it is the Window save, which fails.
     * The rollback delete also fails, which must surface a combined
     * error instead of a silent inconsistency.
     */
    __failUpsertOnNextCall(
      1,
      "The database is locked.",
    );

    const deleteSpy = vi
      .spyOn(databaseManager, "delete")
      .mockRejectedValue(
        new Error("The delete failed."),
      );

    await expect(
      episodeManager.addWindow(window),
    ).rejects.toThrow(
      "Could not update the Window after Episode creation",
    );

    deleteSpy.mockRestore();
  });

  it("throws when a Window without an id is processed", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "",
      subjects: ["Database schema design"],
      vector: DATABASE_VECTOR,
    });

    await expect(
      episodeManager.addWindow(window),
    ).rejects.toThrow(
      "The Window must contain a non-empty id.",
    );
  });
});

describe("EpisodeManager.reassignWindow", () => {
  beforeEach(() => {
    __resetDatabase();

    embedText.mockImplementation(vectorForText);
    compareEmbeddingToEmbedding.mockImplementation(
      cosineSimilarity,
    );

    llmInvoke.mockReset();
    llmInvoke.mockResolvedValue({
      content: '{"subject":"General subject"}',
    });
  });

  it("moves a Window to another Episode of the same session", async () => {
    const episodeManager = await createManager();

    const firstWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
    });

    const firstResult =
      await episodeManager.addWindow(firstWindow);

    const unrelatedWindow = createTestWindow({
      id: "window-2",
      subjects: ["Cooking a pasta recipe"],
      keywords: ["pasta"],
      types: ["question"],
      vector: COOKING_VECTOR,
    });

    const secondResult =
      await episodeManager.addWindow(
        unrelatedWindow,
      );

    const movingWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      episodeId: firstResult.episodeId,
    });

    const result =
      await episodeManager.reassignWindow(
        movingWindow,
        secondResult.episodeId,
      );

    expect(result.episodeId).toBe(
      secondResult.episodeId,
    );

    const allEpisodes =
      await episodeManager.getAllEpisodes();

    const targetEpisode = allEpisodes.find(
      (episode) =>
        episode.id === secondResult.episodeId,
    );

    expect(
      targetEpisode?.windowIds,
    ).toEqual(["window-2", "window-1"]);

    /*
     * The previous Episode had no remaining Windows and was removed.
     */
    const previousEpisode = allEpisodes.find(
      (episode) =>
        episode.id === firstResult.episodeId,
    );

    expect(previousEpisode).toBeUndefined();

    const storedWindow =
      __getRecordData<MemoryWindow>("window-1");

    expect(storedWindow?.episodeId).toBe(
      secondResult.episodeId,
    );
  });

  it("refuses to move a Window to an Episode of another session", async () => {
    const episodeManager = await createManager();

    const window = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      sessionId: "session-1",
    });

    const result =
      await episodeManager.addWindow(window);

    const foreignEpisode = createTestWindow({
      id: "window-2",
      subjects: ["Cooking a pasta recipe"],
      keywords: ["pasta"],
      types: ["question"],
      vector: COOKING_VECTOR,
      sessionId: "session-2",
    });

    const foreignResult =
      await episodeManager.addWindow(
        foreignEpisode,
      );

    const movingWindow = createTestWindow({
      id: "window-1",
      subjects: ["Database schema design"],
      keywords: ["postgres"],
      types: ["question"],
      vector: DATABASE_VECTOR,
      sessionId: "session-1",
      episodeId: result.episodeId,
    });

    await expect(
      episodeManager.reassignWindow(
        movingWindow,
        foreignResult.episodeId,
      ),
    ).rejects.toThrow(
      "A Window cannot be reassigned to an Episode of another session.",
    );
  });
});
