// src/storage/databaseManager.ts

import {
  BaseDirectory,
  mkdir,
} from "@tauri-apps/plugin-fs";

import Database from "@tauri-apps/plugin-sql";

/* -------------------------------------------------------------------------- */
/* Database Configuration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Relative SQLite paths used by Tauri SQL are resolved inside
 * the application's configuration directory.
 *
 * The resulting location is:
 *
 * AppConfig/storage/memory.db
 */
const DATABASE_DIRECTORY = "storage";
const DATABASE_FILE = "memory.db";
const DATABASE_URL =
  `sqlite:${DATABASE_DIRECTORY}/${DATABASE_FILE}`;

/**
 * Location of the SQLite database inside a user-selected project
 * folder. The file lives next to the other project storage:
 *
 * <projectPath>/.mocu/storage/memory.db
 */
const PROJECT_STORAGE_DIRECTORY = ".mocu/storage";
const PROJECT_DATABASE_FILE = "memory.db";

const RECORD_COLUMNS = `
  record_key,
  record_type,
  session_key,
  parent_key,
  sequence_number,
  payload,
  created_at,
  updated_at
`;

/* -------------------------------------------------------------------------- */
/* Public Types                                                               */
/* -------------------------------------------------------------------------- */

export type KnownRecordType =
  | "turn"
  | "span"
  | "window"
  | "episode"
  | "session"
  | "memory"
  | "entity";

/**
 * The intersection preserves autocomplete for known values while
 * still allowing custom record types.
 */
export type RecordType =
  | KnownRecordType
  | (string & {});

export interface SaveRecordInput<T> {
  type: RecordType;
  data: T;

  key?: string;
  sessionKey?: string | null;
  parentKey?: string | null;
  sequence?: number | null;
}

export interface StoredRecord<T> {
  key: string;
  type: RecordType;
  sessionKey: string | null;
  parentKey: string | null;
  sequence: number | null;
  data: T;
  createdAt: number;
  updatedAt: number;
}

export interface UpdateRecordInput<T> {
  data?: T;
  sessionKey?: string | null;
  parentKey?: string | null;
  sequence?: number | null;
}

/* -------------------------------------------------------------------------- */
/* Internal Types                                                             */
/* -------------------------------------------------------------------------- */

interface DatabaseRow {
  record_key: string;
  record_type: string;
  session_key: string | null;
  parent_key: string | null;

  /*
   * SQLite drivers may return integer values as numbers or strings,
   * depending on the platform and value.
   */
  sequence_number: number | string | null;
  payload: string;
  created_at: number | string;
  updated_at: number | string;
}

interface CountRow {
  total: number | string;
}

/* -------------------------------------------------------------------------- */
/* Database Manager                                                           */
/* -------------------------------------------------------------------------- */

export class DatabaseManager {
  private database: Database | null = null;

  /**
   * Connection URL of the active database.
   *
   * The default points to AppConfig. useProjectDatabase switches it to
   * the database of a user-selected project folder.
   */
  private databaseUrl: string = DATABASE_URL;

  private initializationPromise:
    | Promise<void>
    | null = null;

  private closingPromise:
    | Promise<void>
    | null = null;

  /**
   * Serializes all public database operations.
   *
   * Every public method runs through this promise chain so that a
   * connection can never be closed while another operation is still
   * using it. Without this, useProjectDatabase could close the active
   * connection between getDatabase() and the actual query, which makes
   * the Tauri SQL plugin throw "attempted to acquire a connection on
   * a closed pool".
   */
  private operationQueue: Promise<void> = Promise.resolve();

  /**
   * Runs an operation exclusively.
   *
   * The operation waits for all previously queued operations and
   * blocks later operations until it finishes. Errors never break
   * the queue.
   */
  private runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result =
      this.operationQueue.then(
        operation,
        operation,
      );

    this.operationQueue =
      result.then(
        () => undefined,
        () => undefined,
      );

    return result;
  }

  /**
   * Initializes the database once.
   *
   * Simultaneous callers share the same initialization promise.
   */
  public async initialize(): Promise<void> {
    if (this.database) {
      /*
       * The Tauri SQL plugin keeps one pool per connection string and
       * Database.close() without a database name closes every pool.
       * External code can therefore close the active pool behind this
       * manager's back. Verify the cached connection before reusing
       * it, and re-initialize when its pool is gone.
       */
      const isConnectionAlive =
        await this.isConnectionAlive(this.database);

      if (isConnectionAlive) {
        return;
      }

      this.database = null;
    }

    if (this.closingPromise) {
      await this.closingPromise;
    }

    if (this.database) {
      return;
    }

    if (!this.initializationPromise) {
      const initialization =
        this.initializeDatabase();

      this.initializationPromise =
        initialization;

      void initialization.finally(() => {
        if (
          this.initializationPromise ===
          initialization
        ) {
          this.initializationPromise = null;
        }
      });
    }

    await this.initializationPromise;
  }

  /**
   * Points the manager at the SQLite database of a user-selected
   * project folder:
   *
   * <projectPath>/.mocu/storage/memory.db
   *
   * Passing null restores the default database in AppConfig. The
   * active connection is closed before switching, and the project
   * storage directory is created so SQLite can open its file.
   *
   * Returns the file path of the active database.
   */
  public useProjectDatabase(
    projectPath: string | null,
  ): Promise<string> {
    return this.runExclusive(() =>
      this.useProjectDatabaseInternal(projectPath),
    );
  }

  private async useProjectDatabaseInternal(
    projectPath: string | null,
  ): Promise<string> {
    const normalizedProjectPath =
      this.normalizeProjectPath(projectPath);

    if (
      normalizedProjectPath &&
      !this.isAbsolutePath(normalizedProjectPath)
    ) {
      throw new Error(
        `The project folder path must be absolute: ${normalizedProjectPath}`,
      );
    }

    const targetUrl =
      this.createDatabaseUrl(normalizedProjectPath);

    if (targetUrl === this.databaseUrl) {
      return this.getDatabaseFilePath();
    }

    await this.closeDatabase();

    if (normalizedProjectPath) {
      const storageDirectory = [
        normalizedProjectPath,
        PROJECT_STORAGE_DIRECTORY,
      ].join("/");

      await mkdir(storageDirectory, {
        recursive: true,
      });
    }

    this.databaseUrl = targetUrl;

    return this.getDatabaseFilePath();
  }

  /**
   * Closes the active database connection.
   *
   * A later database operation can initialize it again.
   */
  public close(): Promise<void> {
    return this.runExclusive(() =>
      this.closeInternal(),
    );
  }

  private async closeInternal(): Promise<void> {
    if (this.closingPromise) {
      return this.closingPromise;
    }

    const closingOperation =
      this.closeDatabase();

    this.closingPromise =
      closingOperation;

    try {
      await closingOperation;
    } finally {
      if (
        this.closingPromise ===
        closingOperation
      ) {
        this.closingPromise = null;
      }
    }
  }

  /**
   * Stores a new record.
   *
   * This method throws if the record key already exists.
   */
  public save<T>(
    input: SaveRecordInput<T>,
  ): Promise<StoredRecord<T>> {
    return this.runExclusive(() =>
      this.saveInternal(input),
    );
  }

  private async saveInternal<T>(
    input: SaveRecordInput<T>,
  ): Promise<StoredRecord<T>> {
    this.assertValidSaveInput(input);

    const database =
      await this.getDatabase();

    const key =
      input.key === undefined
        ? this.createKey()
        : this.normalizeRequiredString(
            input.key,
            "Record key",
          );

    const type =
      this.normalizeRequiredString(
        input.type,
        "Record type",
      ) as RecordType;

    const sessionKey =
      this.normalizeNullableString(
        input.sessionKey,
        "Session key",
      );

    const parentKey =
      this.normalizeNullableString(
        input.parentKey,
        "Parent key",
      );

    const sequence =
      this.normalizeSequence(
        input.sequence,
      );

    const payload =
      this.serialize(input.data);

    const now = Date.now();

    await database.execute(
      `
        INSERT INTO records (
          record_key,
          record_type,
          session_key,
          parent_key,
          sequence_number,
          payload,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        key,
        type,
        sessionKey,
        parentKey,
        sequence,
        payload,
        now,
        now,
      ],
    );

    return {
      key,
      type,
      sessionKey,
      parentKey,
      sequence,
      data: input.data,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Updates only the payload of an existing record.
   */
  public update<T>(
    key: string,
    data: T,
  ): Promise<StoredRecord<T> | null> {
    return this.runExclusive(() =>
      this.updateInternal(key, data),
    );
  }

  private async updateInternal<T>(
    key: string,
    data: T,
  ): Promise<StoredRecord<T> | null> {
    const normalizedKey =
      this.normalizeRequiredString(
        key,
        "Record key",
      );

    const database =
      await this.getDatabase();

    const payload = this.serialize(data);
    const updatedAt = Date.now();

    const result = await database.execute(
      `
        UPDATE records
        SET
          payload = ?,
          updated_at = ?
        WHERE record_key = ?
      `,
      [
        payload,
        updatedAt,
        normalizedKey,
      ],
    );

    if (result.rowsAffected === 0) {
      return null;
    }

    return this.getInternal<T>(normalizedKey);
  }

  /**
   * Updates one or more mutable fields of an existing record.
   *
   * Passing null explicitly clears a nullable field.
   * Passing undefined preserves the existing field.
   */
  public updateRecord<T>(
    key: string,
    changes: UpdateRecordInput<T>,
  ): Promise<StoredRecord<T> | null> {
    return this.runExclusive(() =>
      this.updateRecordInternal(key, changes),
    );
  }

  private async updateRecordInternal<T>(
    key: string,
    changes: UpdateRecordInput<T>,
  ): Promise<StoredRecord<T> | null> {
    const normalizedKey =
      this.normalizeRequiredString(
        key,
        "Record key",
      );

    if (!changes || typeof changes !== "object") {
      throw new Error(
        "Record changes must be an object.",
      );
    }

    const database =
      await this.getDatabase();

    const existingRecord =
      await this.selectByKey<T>(
        database,
        normalizedKey,
      );

    if (!existingRecord) {
      return null;
    }

    const nextData =
      changes.data !== undefined
        ? changes.data
        : existingRecord.data;

    const nextSessionKey =
      changes.sessionKey !== undefined
        ? this.normalizeNullableString(
            changes.sessionKey,
            "Session key",
          )
        : existingRecord.sessionKey;

    const nextParentKey =
      changes.parentKey !== undefined
        ? this.normalizeNullableString(
            changes.parentKey,
            "Parent key",
          )
        : existingRecord.parentKey;

    const nextSequence =
      changes.sequence !== undefined
        ? this.normalizeSequence(
            changes.sequence,
          )
        : existingRecord.sequence;

    const updatedAt = Date.now();

    const result = await database.execute(
      `
        UPDATE records
        SET
          session_key = ?,
          parent_key = ?,
          sequence_number = ?,
          payload = ?,
          updated_at = ?
        WHERE record_key = ?
      `,
      [
        nextSessionKey,
        nextParentKey,
        nextSequence,
        this.serialize(nextData),
        updatedAt,
        normalizedKey,
      ],
    );

    if (result.rowsAffected === 0) {
      return null;
    }

    return {
      ...existingRecord,
      sessionKey: nextSessionKey,
      parentKey: nextParentKey,
      sequence: nextSequence,
      data: nextData,
      updatedAt,
    };
  }

  /**
   * Atomically inserts or updates a record.
   *
   * If the key already exists:
   * - created_at is preserved;
   * - updated_at is replaced;
   * - type, metadata, and payload are replaced.
   */
  public upsert<T>(
    input: SaveRecordInput<T> & {
      key: string;
    },
  ): Promise<StoredRecord<T>> {
    return this.runExclusive(() =>
      this.upsertInternal(input),
    );
  }

  private async upsertInternal<T>(
    input: SaveRecordInput<T> & {
      key: string;
    },
  ): Promise<StoredRecord<T>> {
    this.assertValidSaveInput(input);

    const database =
      await this.getDatabase();

    const key =
      this.normalizeRequiredString(
        input.key,
        "Record key",
      );

    const type =
      this.normalizeRequiredString(
        input.type,
        "Record type",
      ) as RecordType;

    const sessionKey =
      this.normalizeNullableString(
        input.sessionKey,
        "Session key",
      );

    const parentKey =
      this.normalizeNullableString(
        input.parentKey,
        "Parent key",
      );

    const sequence =
      this.normalizeSequence(
        input.sequence,
      );

    const payload =
      this.serialize(input.data);

    const now = Date.now();

    await database.execute(
      `
        INSERT INTO records (
          record_key,
          record_type,
          session_key,
          parent_key,
          sequence_number,
          payload,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(record_key) DO UPDATE SET
          record_type = excluded.record_type,
          session_key = excluded.session_key,
          parent_key = excluded.parent_key,
          sequence_number = excluded.sequence_number,
          payload = excluded.payload,
          updated_at = excluded.updated_at
      `,
      [
        key,
        type,
        sessionKey,
        parentKey,
        sequence,
        payload,
        now,
        now,
      ],
    );

    const storedRecord =
      await this.selectByKey<T>(
        database,
        key,
      );

    if (!storedRecord) {
      throw new Error(
        `The upserted record could not be read: ${key}`,
      );
    }

    return storedRecord;
  }

  /**
   * Returns a single record by its primary key.
   */
  public get<T>(
    key: string,
  ): Promise<StoredRecord<T> | null> {
    return this.runExclusive(() =>
      this.getInternal(key),
    );
  }

  private async getInternal<T>(
    key: string,
  ): Promise<StoredRecord<T> | null> {
    const normalizedKey =
      this.normalizeRequiredString(
        key,
        "Record key",
      );

    const database =
      await this.getDatabase();

    return this.selectByKey<T>(
      database,
      normalizedKey,
    );
  }

  /**
   * Returns all records with the specified type.
   */
  public getByType<T>(
    type: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    return this.runExclusive(() =>
      this.getByTypeInternal(type),
    );
  }

  private async getByTypeInternal<T>(
    type: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    const normalizedType =
      this.normalizeRequiredString(
        type,
        "Record type",
      );

    const database =
      await this.getDatabase();

    const rows =
      await database.select<DatabaseRow[]>(
        `
          SELECT
            ${RECORD_COLUMNS}
          FROM records
          WHERE record_type = ?
          ORDER BY
            CASE
              WHEN sequence_number IS NULL THEN 1
              ELSE 0
            END,
            sequence_number ASC,
            created_at ASC,
            record_key ASC
        `,
        [normalizedType],
      );

    return this.mapRows<T>(rows);
  }

  /**
   * Returns records belonging to a session.
   *
   * An optional record type can be supplied.
   */
  public getBySession<T>(
    sessionKey: string,
    type?: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    return this.runExclusive(() =>
      this.getBySessionInternal(sessionKey, type),
    );
  }

  private async getBySessionInternal<T>(
    sessionKey: string,
    type?: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    const normalizedSessionKey =
      this.normalizeRequiredString(
        sessionKey,
        "Session key",
      );

    const database =
      await this.getDatabase();

    let rows: DatabaseRow[];

    if (type !== undefined) {
      const normalizedType =
        this.normalizeRequiredString(
          type,
          "Record type",
        );

      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE session_key = ?
              AND record_type = ?
            ORDER BY
              CASE
                WHEN sequence_number IS NULL THEN 1
                ELSE 0
              END,
              sequence_number ASC,
              created_at ASC,
              record_key ASC
          `,
          [
            normalizedSessionKey,
            normalizedType,
          ],
        );
    } else {
      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE session_key = ?
            ORDER BY
              CASE
                WHEN sequence_number IS NULL THEN 1
                ELSE 0
              END,
              sequence_number ASC,
              created_at ASC,
              record_key ASC
          `,
          [normalizedSessionKey],
        );
    }

    return this.mapRows<T>(rows);
  }

  /**
   * Returns records belonging to a parent record.
   *
   * An optional record type can be supplied.
   */
  public getByParent<T>(
    parentKey: string,
    type?: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    return this.runExclusive(() =>
      this.getByParentInternal(parentKey, type),
    );
  }

  private async getByParentInternal<T>(
    parentKey: string,
    type?: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    const normalizedParentKey =
      this.normalizeRequiredString(
        parentKey,
        "Parent key",
      );

    const database =
      await this.getDatabase();

    let rows: DatabaseRow[];

    if (type !== undefined) {
      const normalizedType =
        this.normalizeRequiredString(
          type,
          "Record type",
        );

      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE parent_key = ?
              AND record_type = ?
            ORDER BY
              CASE
                WHEN sequence_number IS NULL THEN 1
                ELSE 0
              END,
              sequence_number ASC,
              created_at ASC,
              record_key ASC
          `,
          [
            normalizedParentKey,
            normalizedType,
          ],
        );
    } else {
      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE parent_key = ?
            ORDER BY
              CASE
                WHEN sequence_number IS NULL THEN 1
                ELSE 0
              END,
              sequence_number ASC,
              created_at ASC,
              record_key ASC
          `,
          [normalizedParentKey],
        );
    }

    return this.mapRows<T>(rows);
  }

  /**
   * Returns recent records in chronological order.
   *
   * SQLite first selects the newest records. The result is then
   * reversed so callers receive oldest-to-newest order.
   */
  public getRecent<T>(
    type: RecordType,
    limit = 10,
    sessionKey?: string,
  ): Promise<Array<StoredRecord<T>>> {
    return this.runExclusive(() =>
      this.getRecentInternal(type, limit, sessionKey),
    );
  }

  private async getRecentInternal<T>(
    type: RecordType,
    limit = 10,
    sessionKey?: string,
  ): Promise<Array<StoredRecord<T>>> {
    const normalizedType =
      this.normalizeRequiredString(
        type,
        "Record type",
      );

    const safeLimit =
      this.normalizeLimit(limit);

    if (safeLimit === 0) {
      return [];
    }

    const database =
      await this.getDatabase();

    let rows: DatabaseRow[];

    if (sessionKey !== undefined) {
      const normalizedSessionKey =
        this.normalizeRequiredString(
          sessionKey,
          "Session key",
        );

      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE record_type = ?
              AND session_key = ?
            ORDER BY
              created_at DESC,
              record_key DESC
            LIMIT ?
          `,
          [
            normalizedType,
            normalizedSessionKey,
            safeLimit,
          ],
        );
    } else {
      rows =
        await database.select<DatabaseRow[]>(
          `
            SELECT
              ${RECORD_COLUMNS}
            FROM records
            WHERE record_type = ?
            ORDER BY
              created_at DESC,
              record_key DESC
            LIMIT ?
          `,
          [
            normalizedType,
            safeLimit,
          ],
        );
    }

    return this.mapRows<T>(rows).reverse();
  }

  /**
   * Deletes one record by key.
   */
  public delete(
    key: string,
  ): Promise<boolean> {
    return this.runExclusive(() =>
      this.deleteInternal(key),
    );
  }

  private async deleteInternal(
    key: string,
  ): Promise<boolean> {
    const normalizedKey =
      this.normalizeRequiredString(
        key,
        "Record key",
      );

    const database =
      await this.getDatabase();

    const result = await database.execute(
      `
        DELETE FROM records
        WHERE record_key = ?
      `,
      [normalizedKey],
    );

    return result.rowsAffected > 0;
  }

  /**
   * Deletes all records of one type.
   */
  public deleteByType(
    type: RecordType,
  ): Promise<number> {
    return this.runExclusive(() =>
      this.deleteByTypeInternal(type),
    );
  }

  private async deleteByTypeInternal(
    type: RecordType,
  ): Promise<number> {
    const normalizedType =
      this.normalizeRequiredString(
        type,
        "Record type",
      );

    const database =
      await this.getDatabase();

    const result = await database.execute(
      `
        DELETE FROM records
        WHERE record_type = ?
      `,
      [normalizedType],
    );

    return result.rowsAffected;
  }

  /**
   * Deletes all records associated with a session.
   */
  public deleteBySession(
    sessionKey: string,
  ): Promise<number> {
    return this.runExclusive(() =>
      this.deleteBySessionInternal(sessionKey),
    );
  }

  private async deleteBySessionInternal(
    sessionKey: string,
  ): Promise<number> {
    const normalizedSessionKey =
      this.normalizeRequiredString(
        sessionKey,
        "Session key",
      );

    const database =
      await this.getDatabase();

    const result = await database.execute(
      `
        DELETE FROM records
        WHERE session_key = ?
      `,
      [normalizedSessionKey],
    );

    return result.rowsAffected;
  }

  /**
   * Deletes all records associated with a parent.
   */
  public deleteByParent(
    parentKey: string,
  ): Promise<number> {
    return this.runExclusive(() =>
      this.deleteByParentInternal(parentKey),
    );
  }

  private async deleteByParentInternal(
    parentKey: string,
  ): Promise<number> {
    const normalizedParentKey =
      this.normalizeRequiredString(
        parentKey,
        "Parent key",
      );

    const database =
      await this.getDatabase();

    const result = await database.execute(
      `
        DELETE FROM records
        WHERE parent_key = ?
      `,
      [normalizedParentKey],
    );

    return result.rowsAffected;
  }

  /**
   * Counts records using optional type and session filters.
   */
  public count(
    type?: RecordType,
    sessionKey?: string,
  ): Promise<number> {
    return this.runExclusive(() =>
      this.countInternal(type, sessionKey),
    );
  }

  private async countInternal(
    type?: RecordType,
    sessionKey?: string,
  ): Promise<number> {
    const database =
      await this.getDatabase();

    let rows: CountRow[];

    if (
      type !== undefined &&
      sessionKey !== undefined
    ) {
      const normalizedType =
        this.normalizeRequiredString(
          type,
          "Record type",
        );

      const normalizedSessionKey =
        this.normalizeRequiredString(
          sessionKey,
          "Session key",
        );

      rows =
        await database.select<CountRow[]>(
          `
            SELECT COUNT(*) AS total
            FROM records
            WHERE record_type = ?
              AND session_key = ?
          `,
          [
            normalizedType,
            normalizedSessionKey,
          ],
        );
    } else if (type !== undefined) {
      const normalizedType =
        this.normalizeRequiredString(
          type,
          "Record type",
        );

      rows =
        await database.select<CountRow[]>(
          `
            SELECT COUNT(*) AS total
            FROM records
            WHERE record_type = ?
          `,
          [normalizedType],
        );
    } else if (
      sessionKey !== undefined
    ) {
      const normalizedSessionKey =
        this.normalizeRequiredString(
          sessionKey,
          "Session key",
        );

      rows =
        await database.select<CountRow[]>(
          `
            SELECT COUNT(*) AS total
            FROM records
            WHERE session_key = ?
          `,
          [normalizedSessionKey],
        );
    } else {
      rows =
        await database.select<CountRow[]>(
          `
            SELECT COUNT(*) AS total
            FROM records
          `,
        );
    }

    const total =
      Number(rows[0]?.total ?? 0);

    if (
      !Number.isFinite(total) ||
      total < 0
    ) {
      throw new Error(
        "The database returned an invalid record count.",
      );
    }

    return total;
  }

  /* ------------------------------------------------------------------------ */
  /* Initialization                                                           */
  /* ------------------------------------------------------------------------ */

  private async initializeDatabase(): Promise<void> {
    /*
     * Tauri SQL resolves the relative SQLite path from AppConfig.
     * Therefore, this directory must also be created under AppConfig.
     */
    await mkdir(DATABASE_DIRECTORY, {
      baseDir: BaseDirectory.AppConfig,
      recursive: true,
    });

    let database: Database | null = null;

    try {
      database =
        await Database.load(this.databaseUrl);

      await database.execute(`
        CREATE TABLE IF NOT EXISTS records (
          record_key TEXT PRIMARY KEY NOT NULL,
          record_type TEXT NOT NULL,
          session_key TEXT,
          parent_key TEXT,
          sequence_number INTEGER,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_type
        ON records(record_type)
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_session
        ON records(session_key)
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_parent
        ON records(parent_key)
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_sequence
        ON records(
          session_key,
          record_type,
          sequence_number
        )
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_created_at
        ON records(created_at)
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_type_created
        ON records(
          record_type,
          created_at
        )
      `);

      await database.execute(`
        CREATE INDEX IF NOT EXISTS idx_records_session_type
        ON records(
          session_key,
          record_type
        )
      `);

      this.database = database;
    } catch (error) {
      if (database) {
        try {
          await database.close();
        } catch {
          // Ignore close errors after failed initialization.
        }
      }

      this.database = null;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        `Could not initialize the SQLite database: ${message}`,
      );
    }
  }

  private async closeDatabase(): Promise<void> {
    /*
     * If initialization is running, wait for it before closing.
     */
    if (this.initializationPromise) {
      try {
        await this.initializationPromise;
      } catch {
        /*
         * Initialization already performs its own cleanup.
         */
      }
    }

    const database = this.database;
    this.database = null;

    if (!database) {
      return;
    }

    try {
      /*
       * Close only this manager's pool. close() without a database
       * name would close every pool of the whole application.
       */
      await database.close(database.path);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        `Could not close the SQLite database: ${message}`,
      );
    }
  }

  /**
   * Normalizes a project folder path to forward slashes without
   * trailing separators. Returns an empty string for null or empty
   * input.
   */
  private normalizeProjectPath(
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
  private isAbsolutePath(
    normalizedPath: string,
  ): boolean {
    return /^(?:[a-zA-Z]:[\/]|\\\\|\/)/.test(
      normalizedPath,
    );
  }

  /**
   * Builds the SQLite connection URL.
   *
   * A project path replaces the AppConfig base because the SQL plugin
   * maps absolute paths directly, while relative paths are resolved
   * inside AppConfig.
   */
  private createDatabaseUrl(
    normalizedProjectPath: string,
  ): string {
    if (!normalizedProjectPath) {
      return DATABASE_URL;
    }

    return [
      `sqlite:${normalizedProjectPath}`,
      PROJECT_STORAGE_DIRECTORY,
      PROJECT_DATABASE_FILE,
    ].join("/");
  }

  /**
   * Returns the file path of the active database without the
   * "sqlite:" prefix.
   */
  private getDatabaseFilePath(): string {
    return this.databaseUrl.replace(
      /^sqlite:/,
      "",
    );
  }

  private async getDatabase(): Promise<Database> {
    await this.initialize();

    if (!this.database) {
      throw new Error(
        "The database is not initialized.",
      );
    }

    return this.database;
  }

  /**
   * Returns true when the pool of the given database instance can
   * still acquire a connection.
   *
   * The Tauri SQL plugin does not remove a closed pool from its
   * registry, so a cached instance can silently point at a closed
   * pool. A cheap SELECT 1 detects that case.
   */
  private async isConnectionAlive(
    database: Database,
  ): Promise<boolean> {
    try {
      await database.select("SELECT 1");

      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Internal Queries                                                         */
  /* ------------------------------------------------------------------------ */

  private async selectByKey<T>(
    database: Database,
    key: string,
  ): Promise<StoredRecord<T> | null> {
    const rows =
      await database.select<DatabaseRow[]>(
        `
          SELECT
            ${RECORD_COLUMNS}
          FROM records
          WHERE record_key = ?
          LIMIT 1
        `,
        [key],
      );

    const row = rows[0];

    return row
      ? this.mapRow<T>(row)
      : null;
  }

  /* ------------------------------------------------------------------------ */
  /* Validation                                                               */
  /* ------------------------------------------------------------------------ */

  private assertValidSaveInput<T>(
    input: SaveRecordInput<T>,
  ): void {
    if (!input || typeof input !== "object") {
      throw new Error(
        "A valid record input is required.",
      );
    }

    this.normalizeRequiredString(
      input.type,
      "Record type",
    );

    if (input.key !== undefined) {
      this.normalizeRequiredString(
        input.key,
        "Record key",
      );
    }

    this.normalizeNullableString(
      input.sessionKey,
      "Session key",
    );

    this.normalizeNullableString(
      input.parentKey,
      "Parent key",
    );

    this.normalizeSequence(
      input.sequence,
    );

    /*
     * Validate serializability before executing the query.
     */
    this.serialize(input.data);
  }

  private normalizeRequiredString(
    value: unknown,
    label: string,
  ): string {
    if (typeof value !== "string") {
      throw new Error(
        `${label} must be a string.`,
      );
    }

    const normalizedValue = value.trim();

    if (!normalizedValue) {
      throw new Error(
        `${label} cannot be empty.`,
      );
    }

    return normalizedValue;
  }

  private normalizeNullableString(
    value: unknown,
    label: string,
  ): string | null {
    if (
      value === undefined ||
      value === null
    ) {
      return null;
    }

    return this.normalizeRequiredString(
      value,
      label,
    );
  }

  private normalizeSequence(
    value: unknown,
  ): number | null {
    if (
      value === undefined ||
      value === null
    ) {
      return null;
    }

    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error(
        "Sequence must be a non-negative safe integer or null.",
      );
    }

    return value;
  }

  private normalizeLimit(
    limit: number,
  ): number {
    if (!Number.isFinite(limit)) {
      return 10;
    }

    return Math.max(
      0,
      Math.floor(limit),
    );
  }

  private createKey(): string {
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID ===
        "function"
    ) {
      return globalThis.crypto.randomUUID();
    }

    /*
     * A Tauri WebView normally supports crypto.randomUUID.
     * This fallback prevents a complete failure on older WebViews.
     */
    return [
      Date.now().toString(36),
      Math.random().toString(36).slice(2),
      Math.random().toString(36).slice(2),
    ].join("-");
  }

  /* ------------------------------------------------------------------------ */
  /* Serialization                                                            */
  /* ------------------------------------------------------------------------ */

  private serialize<T>(
    data: T,
  ): string {
    try {
      const result = JSON.stringify(
        data,
        (_key, value: unknown) => {
          if (typeof value === "bigint") {
            throw new Error(
              "BigInt values are not JSON serializable.",
            );
          }

          if (
            typeof value === "number" &&
            !Number.isFinite(value)
          ) {
            throw new Error(
              "Non-finite numbers are not allowed.",
            );
          }

          return value;
        },
      );

      if (result === undefined) {
        throw new Error(
          "The root value is not JSON serializable.",
        );
      }

      return result;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        `The provided data cannot be serialized to JSON: ${message}`,
      );
    }
  }

  private deserialize<T>(
    payload: string,
    recordKey?: string,
  ): T {
    try {
      return JSON.parse(payload) as T;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const keyInformation =
        recordKey
          ? ` for record "${recordKey}"`
          : "";

      throw new Error(
        `The stored record${keyInformation} contains invalid JSON: ${message}`,
      );
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Row Mapping                                                              */
  /* ------------------------------------------------------------------------ */

  private mapRows<T>(
    rows: DatabaseRow[],
  ): Array<StoredRecord<T>> {
    return rows.map((row) =>
      this.mapRow<T>(row),
    );
  }

  private mapRow<T>(
    row: DatabaseRow,
  ): StoredRecord<T> {
    const createdAt =
      this.parseDatabaseInteger(
        row.created_at,
        "created_at",
        row.record_key,
      );

    const updatedAt =
      this.parseDatabaseInteger(
        row.updated_at,
        "updated_at",
        row.record_key,
      );

    const sequence =
      row.sequence_number === null
        ? null
        : this.parseDatabaseInteger(
            row.sequence_number,
            "sequence_number",
            row.record_key,
          );

    return {
      key: row.record_key,
      type: row.record_type as RecordType,
      sessionKey: row.session_key,
      parentKey: row.parent_key,
      sequence,
      data: this.deserialize<T>(
        row.payload,
        row.record_key,
      ),
      createdAt,
      updatedAt,
    };
  }

  private parseDatabaseInteger(
    value: number | string,
    columnName: string,
    recordKey: string,
  ): number {
    const numericValue = Number(value);

    if (
      !Number.isSafeInteger(numericValue)
    ) {
      throw new Error(
        `Record "${recordKey}" contains an invalid ${columnName} value.`,
      );
    }

    return numericValue;
  }
}

/* -------------------------------------------------------------------------- */
/* Default Instance                                                           */
/* -------------------------------------------------------------------------- */

export const databaseManager =
  new DatabaseManager();