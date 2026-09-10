import { mkdir } from "@tauri-apps/plugin-fs";

import Database from "@tauri-apps/plugin-sql";

import { textSimilarity } from "../../../../services/ai/tools/textSimilarity";

import type {
  EntityType,
  TurnEntity,
} from "../createTurn";

interface StoredEntityRow {
  id: number;
  normalized: string;
  type: EntityType;
  embedding_json: string;
}

interface StoredEntity {
  id: number;
  normalized: string;
  type: EntityType;
  embedding: number[];
}

export interface EntityMemoryOptions {
  similarityThreshold?: number;
  databaseUrl?: string;
}

export interface MatchExistingEntitiesOptions {
  /**
   * Minimum similarity for a match to be returned.
   */
  similarityThreshold?: number;

  /**
   * When true, query entities are compared against all stored
   * entities regardless of their type.
   */
  ignoreQueryType?: boolean;
}

/**
 * Represents an entity that already exists in the entity database.
 */
export interface ExistingEntityMatch {
  text: string;
  normalized: string;
  type: string;
  similarity: number;
}

/**
 * Relative SQLite paths used by the Tauri SQL plugin are resolved
 * inside the application's configuration directory.
 */
const DEFAULT_DATABASE_URL = "sqlite:memoryx.db";
const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

/**
 * Location of the entity SQLite database inside a user-selected
 * project folder. The file lives next to the other project storage:
 *
 * <projectPath>/.mocu/storage/memoryx.db
 */
const PROJECT_STORAGE_DIRECTORY = ".mocu/storage";
const PROJECT_DATABASE_FILE = "memoryx.db";

/**
 * Stores canonical entities and resolves new entities against
 * previously stored entities using embedding similarity.
 */
export class EntityMemoryStore {
  private databaseUrl: string;
  private readonly similarityThreshold: number;

  private databasePromise: Promise<Database> | null = null;
  private processingQueue: Promise<void> = Promise.resolve();

  public constructor(
    options: EntityMemoryOptions = {},
  ) {
    this.databaseUrl =
      options.databaseUrl ??
      DEFAULT_DATABASE_URL;

    this.similarityThreshold =
      options.similarityThreshold ??
      DEFAULT_SIMILARITY_THRESHOLD;

    if (
      !Number.isFinite(this.similarityThreshold) ||
      this.similarityThreshold < -1 ||
      this.similarityThreshold > 1
    ) {
      throw new Error(
        "Entity similarityThreshold must be between -1 and 1.",
      );
    }
  }

  /**
   * Points the store at the SQLite entity database of a
   * user-selected project folder:
   *
   * <projectPath>/.mocu/storage/memoryx.db
   *
   * Passing null restores the default database inside the
   * application configuration directory. The project storage
   * directory is created so SQLite can open its file.
   *
   * Returns the file path of the active entity database.
   */
  public async useProjectDatabase(
    projectPath: string | null,
  ): Promise<string> {
    return this.runExclusively(async () => {
      const normalizedProjectPath =
        normalizeProjectPath(projectPath);

      if (
        normalizedProjectPath &&
        !isAbsolutePath(normalizedProjectPath)
      ) {
        throw new Error(
          `The project folder path must be absolute: ${normalizedProjectPath}`,
        );
      }

      const targetUrl = normalizedProjectPath
        ? [
            `sqlite:${normalizedProjectPath}`,
            PROJECT_STORAGE_DIRECTORY,
            PROJECT_DATABASE_FILE,
          ].join("/")
        : DEFAULT_DATABASE_URL;

      if (targetUrl !== this.databaseUrl) {
        /*
         * The cached connection points at the previous location.
         * Database.load replaces the pool per connection string,
         * so dropping the cached promise is enough: the next call
         * reopens the database at the new location.
         */
        this.databasePromise = null;
        this.databaseUrl = targetUrl;
      }

      if (normalizedProjectPath) {
        const storageDirectory = [
          normalizedProjectPath,
          PROJECT_STORAGE_DIRECTORY,
        ].join("/");

        await mkdir(storageDirectory, {
          recursive: true,
        });
      }

      return this.databaseUrl.replace(
        /^sqlite:/,
        "",
      );
    });
  }

  /**
   * Resolves all entities against the SQLite entity memory.
   *
   * If a stored entity has a similarity greater than 0.90,
   * the stored normalized value replaces the new normalized value.
   *
   * If no matching entity exists, the new entity and its embedding
   * are inserted into SQLite.
   */
  public async processEntities(
    entities: TurnEntity[],
  ): Promise<TurnEntity[]> {
    if (entities.length === 0) {
      return [];
    }

    return this.runExclusively(async () => {
      const database = await this.getDatabase();
      const resolvedEntities: TurnEntity[] = [];

      for (const entity of entities) {
        const resolvedEntity =
          await this.resolveEntity(
            database,
            entity,
          );

        resolvedEntities.push(
          resolvedEntity,
        );
      }

      return uniqueEntities(
        resolvedEntities,
      );
    });
  }

  /**
   * Resolves query entities against previously stored entities without
   * writing anything.
   *
   * This is a read-only operation:
   *
   * - It may read existing entities.
   * - It may create query embeddings in memory.
   * - It must not insert or update any entity.
   * - Unmatched query entities are not returned.
   */
  public async matchExistingEntities(
    queryEntities: TurnEntity[],
    options: MatchExistingEntitiesOptions = {},
  ): Promise<ExistingEntityMatch[]> {
    if (queryEntities.length === 0) {
      return [];
    }

    const threshold =
      options.similarityThreshold ??
      this.similarityThreshold;

    const database =
      await this.getDatabase();

    const storedEntities =
      options.ignoreQueryType
        ? await this.findAllEntities(
            database,
          )
        : null;

    const results:
      ExistingEntityMatch[] = [];

    for (const queryEntity of queryEntities) {
      const normalizedQuery =
        normalizeEntityText(
          queryEntity.normalized,
        );

      if (!normalizedQuery) {
        continue;
      }

      const candidates =
        storedEntities ??
        (await this.findEntitiesByType(
          database,
          queryEntity.type,
        ));

      if (candidates.length === 0) {
        continue;
      }

      /*
       * Prefer an exact normalized match before creating an embedding.
       */
      const exactMatch =
        candidates.find(
          (candidate) =>
            normalizeEntityText(
              candidate.normalized,
            ) === normalizedQuery,
        );

      if (exactMatch) {
        results.push({
          text: exactMatch.normalized,
          normalized:
            exactMatch.normalized,
          type: exactMatch.type,
          similarity: 1,
        });

        continue;
      }

      const queryEmbedding =
        await createEntityEmbedding(
          normalizedQuery,
        );

      const bestMatch = findBestMatch(
        queryEmbedding,
        candidates,
      );

      if (
        bestMatch &&
        bestMatch.similarity >=
          threshold
      ) {
        results.push({
          text:
            bestMatch.entity.normalized,

          normalized:
            bestMatch.entity.normalized,

          type: bestMatch.entity.type,

          similarity:
            bestMatch.similarity,
        });
      }

      /*
       * Important: when no match is found, nothing is inserted or
       * updated. The database stays untouched.
       */
    }

    return results;
  }

  /**
   * Resolves one entity against previously stored entities.
   */
  private async resolveEntity(
    database: Database,
    entity: TurnEntity,
  ): Promise<TurnEntity> {
    const normalized =
      normalizeEntityText(entity.normalized);

    if (!normalized) {
      return entity;
    }

    /*
     * Exact matches do not require another embedding request.
     */
    const exactMatch =
      await this.findExactEntity(
        database,
        normalized,
        entity.type,
      );

    if (exactMatch) {
      return {
        ...entity,
        normalized: exactMatch.normalized,
      };
    }

    /*
     * The embedding is created only once and will either be used
     * for comparison or saved as a new entity.
     */
    const currentEmbedding =
      await createEntityEmbedding(normalized);

    /*
     * Only entities with the same type are compared.
     *
     * This reduces incorrect matches such as a person being merged
     * with an organization that has a semantically similar name.
     */
    const candidates =
      await this.findEntitiesByType(
        database,
        entity.type,
      );

    const bestMatch = findBestMatch(
      currentEmbedding,
      candidates,
    );

    if (
      bestMatch &&
      bestMatch.similarity >
        this.similarityThreshold
    ) {
      return {
        ...entity,

        /*
         * The normalized value already stored in the database
         * becomes the canonical normalized value.
         */
        normalized:
          bestMatch.entity.normalized,
      };
    }

    await this.insertEntity(
      database,
      normalized,
      entity.type,
      currentEmbedding,
    );

    return {
      ...entity,
      normalized,
    };
  }

  /**
   * Finds an exact normalized + type match.
   */
  private async findExactEntity(
    database: Database,
    normalized: string,
    type: EntityType,
  ): Promise<StoredEntity | null> {
    const rows =
      await database.select<StoredEntityRow[]>(
        `
          SELECT
            id,
            normalized,
            type,
            embedding_json
          FROM entity_memory
          WHERE normalized = ?
            AND type = ?
          LIMIT 1
        `,
        [
          normalized,
          type,
        ],
      );

    if (rows.length === 0) {
      return null;
    }

    return parseStoredEntity(rows[0]);
  }

  /**
   * Loads all stored entities of the same type.
   *
   * This is a linear scan and is suitable for the first version.
   * A vector index can replace it later if the table becomes large.
   */
  private async findEntitiesByType(
    database: Database,
    type: EntityType,
  ): Promise<StoredEntity[]> {
    const rows =
      await database.select<StoredEntityRow[]>(
        `
          SELECT
            id,
            normalized,
            type,
            embedding_json
          FROM entity_memory
          WHERE type = ?
        `,
        [type],
      );

    const entities: StoredEntity[] = [];

    for (const row of rows) {
      const parsed = parseStoredEntity(row);

      if (parsed) {
        entities.push(parsed);
      }
    }

    return entities;
  }

  /**
   * Loads all stored entities regardless of type.
   *
   * Used by the read-only search path when query entities have no
   * reliable type.
   */
  private async findAllEntities(
    database: Database,
  ): Promise<StoredEntity[]> {
    const rows =
      await database.select<StoredEntityRow[]>(
        `
          SELECT
            id,
            normalized,
            type,
            embedding_json
          FROM entity_memory
        `,
      );

    const entities: StoredEntity[] = [];

    for (const row of rows) {
      const parsed = parseStoredEntity(row);

      if (parsed) {
        entities.push(parsed);
      }
    }

    return entities;
  }

  /**
   * Inserts a new canonical entity.
   *
   * The unique constraint prevents duplicate normalized + type
   * records if the same entity is processed more than once.
   */
  private async insertEntity(
    database: Database,
    normalized: string,
    type: EntityType,
    embedding: number[],
  ): Promise<void> {
    const now = new Date().toISOString();

    await database.execute(
      `
        INSERT OR IGNORE INTO entity_memory (
          normalized,
          type,
          embedding_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        normalized,
        type,
        JSON.stringify(embedding),
        now,
        now,
      ],
    );
  }

  /**
   * Opens SQLite and creates the entity table when necessary.
   */
  private async getDatabase(): Promise<Database> {
    if (!this.databasePromise) {
      this.databasePromise =
        this.initializeDatabase();
    }

    return this.databasePromise;
  }

  private async initializeDatabase(): Promise<Database> {
    const database =
      await Database.load(
        this.databaseUrl,
      );

    await database.execute(`
      CREATE TABLE IF NOT EXISTS entity_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        normalized TEXT NOT NULL,
        type TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(normalized, type)
      )
    `);

    await database.execute(`
      CREATE INDEX IF NOT EXISTS
        idx_entity_memory_type
      ON entity_memory(type)
    `);

    return database;
  }

  /**
   * Prevents concurrent createTurn calls from inserting duplicate
   * entities before another operation has finished resolving them.
   */
  private async runExclusively<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const previousOperation =
      this.processingQueue;

    let releaseQueue!: () => void;

    this.processingQueue =
      new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });

    await previousOperation;

    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }
}

/**
 * Normalizes a project folder path to forward slashes without
 * trailing separators. Returns an empty string for null or empty
 * input.
 */
function normalizeProjectPath(
  projectPath: string | null,
): string {
  const trimmedPath =
    projectPath?.trim() ?? "";

  if (!trimmedPath) {
    return "";
  }

  return trimmedPath
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

/**
 * Returns true when the path is absolute on the current platform.
 */
function isAbsolutePath(
  normalizedPath: string,
): boolean {
  return /^(?:[a-zA-Z]:[\/]|\\\\|\/)/.test(
    normalizedPath,
  );
}

interface BestEntityMatch {
  entity: StoredEntity;
  similarity: number;
}

function findBestMatch(
  currentEmbedding: number[],
  candidates: StoredEntity[],
): BestEntityMatch | null {
  let bestMatch: BestEntityMatch | null =
    null;

  for (const candidate of candidates) {
    if (
      candidate.embedding.length !==
      currentEmbedding.length
    ) {
      continue;
    }

    const similarity = cosineSimilarity(
      currentEmbedding,
      candidate.embedding,
    );

    if (
      !bestMatch ||
      similarity > bestMatch.similarity
    ) {
      bestMatch = {
        entity: candidate,
        similarity,
      };
    }
  }

  return bestMatch;
}

/**
 * Returns cosine similarity in the range -1 to 1.
 *
 * A result close to 1 means the embeddings are highly similar.
 */
function cosineSimilarity(
  first: number[],
  second: number[],
): number {
  if (
    first.length === 0 ||
    first.length !== second.length
  ) {
    return -1;
  }

  let dotProduct = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;

  for (
    let index = 0;
    index < first.length;
    index += 1
  ) {
    const firstValue = first[index];
    const secondValue = second[index];

    dotProduct +=
      firstValue * secondValue;

    firstMagnitude +=
      firstValue * firstValue;

    secondMagnitude +=
      secondValue * secondValue;
  }

  if (
    firstMagnitude === 0 ||
    secondMagnitude === 0
  ) {
    return -1;
  }

  return (
    dotProduct /
    (
      Math.sqrt(firstMagnitude) *
      Math.sqrt(secondMagnitude)
    )
  );
}

async function createEntityEmbedding(
  normalized: string,
): Promise<number[]> {
  const embedding =
    await textSimilarity.embedText(
      normalized,
    );

  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    embedding.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value),
    )
  ) {
    throw new Error(
      `Invalid entity embedding returned for "${normalized}".`,
    );
  }

  return embedding;
}

function parseStoredEntity(
  row: StoredEntityRow,
): StoredEntity | null {
  if (
    typeof row.id !== "number" ||
    typeof row.normalized !== "string" ||
    typeof row.type !== "string" ||
    typeof row.embedding_json !== "string"
  ) {
    return null;
  }

  let embedding: unknown;

  try {
    embedding = JSON.parse(
      row.embedding_json,
    );
  } catch {
    return null;
  }

  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    embedding.some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value),
    )
  ) {
    return null;
  }

  return {
    id: row.id,
    normalized: row.normalized,
    type: row.type,
    embedding,
  };
}

function normalizeEntityText(
  text: string,
): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function uniqueEntities(
  entities: TurnEntity[],
): TurnEntity[] {
  const seen = new Set<string>();
  const result: TurnEntity[] = [];

  for (const entity of entities) {
    const key = [
      entity.normalized
        .normalize("NFKC")
        .trim()
        .toLowerCase(),
      entity.type,
    ].join(":");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(entity);
  }

  return result;
}

export const entityMemoryStore =
  new EntityMemoryStore({
    similarityThreshold: 0.9,
    databaseUrl: DEFAULT_DATABASE_URL,
  });