// episode/testing/mockDatabaseManager.ts

/**
 * In-memory replacement for the SQLite databaseManager.
 *
 * It implements the subset of the DatabaseManager API that the Window
 * and Episode storage layers use. The mock also supports simulating
 * write failures for the persistence tests.
 */

import type {
  RecordType,
  StoredRecord,
} from "../../storage/databaseManager";

type MockRecord = StoredRecord<unknown>;

const records = new Map<string, MockRecord>();

let upsertCallCount = 0;

let upsertFailure: {
  remainingSuccessfulCalls: number;
} | null = null;

let failureMessage = "The upsert failed.";

function now(): number {
  return Date.now();
}

function normalizeKey(key: unknown): string {
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("Record key must be a non-empty string.");
  }

  return key;
}

export const databaseManager = {
  async upsert<T>(input: {
    type: RecordType;
    key: string;
    data: T;
    sessionKey?: string | null;
    parentKey?: string | null;
    sequence?: number | null;
  }): Promise<StoredRecord<T>> {
    upsertCallCount += 1;

    if (
      upsertFailure &&
      upsertFailure.remainingSuccessfulCalls === 0
    ) {
      /*
       * The failure is one-shot: later rollback writes succeed.
       */
      upsertFailure = null;

      throw new Error(failureMessage);
    }

    if (upsertFailure) {
      upsertFailure.remainingSuccessfulCalls -= 1;
    }

    const key = normalizeKey(input.key);
    const existing = records.get(key);
    const timestamp = now();

    const record: MockRecord = {
      key,
      type: input.type,
      sessionKey: input.sessionKey ?? null,
      parentKey: input.parentKey ?? null,
      sequence: input.sequence ?? null,
      data: input.data,
      createdAt: existing ? existing.createdAt : timestamp,
      updatedAt: timestamp,
    };

    records.set(key, record);

    return { ...record, data: input.data } as StoredRecord<T>;
  },

  async get<T>(
    key: string,
  ): Promise<StoredRecord<T> | null> {
    const record = records.get(normalizeKey(key));

    if (!record) {
      return null;
    }

    return { ...record } as StoredRecord<T>;
  },

  async getByType<T>(
    type: RecordType,
  ): Promise<Array<StoredRecord<T>>> {
    const result: Array<StoredRecord<T>> = [];

    for (const record of records.values()) {
      if (record.type === type) {
        result.push({ ...record } as StoredRecord<T>);
      }
    }

    return result;
  },

  async delete(key: string): Promise<boolean> {
    return records.delete(normalizeKey(key));
  },

  async deleteByType(type: RecordType): Promise<number> {
    let deleted = 0;

    for (const [key, record] of records) {
      if (record.type === type) {
        records.delete(key);
        deleted += 1;
      }
    }

    return deleted;
  },
};

/**
 * Removes all records and failure simulations.
 */
export function __resetDatabase(): void {
  records.clear();
  upsertCallCount = 0;
  upsertFailure = null;
}

/**
 * Returns the raw stored payload of one record.
 */
export function __getRecordData<T>(
  key: string,
): T | null {
  const record = records.get(key);

  return record
    ? (record.data as T)
    : null;
}

/**
 * Makes a future upsert call fail.
 *
 * The first `skipCount` upsert calls succeed, then the next call
 * throws an error with the given message.
 */
export function __failUpsertOnNextCall(
  skipCount: number,
  message: string,
): void {
  upsertFailure = {
    remainingSuccessfulCalls: skipCount,
  };

  failureMessage = message;
}
