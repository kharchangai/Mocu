// window/windowStorage.ts

import { databaseManager } from "../storage/databaseManager";
import type { MemoryWindow } from "./types";
import { cloneWindow } from "./helpers";
import { assertValidStoredWindow } from "./validation";

/* -------------------------------------------------------------------------- */
/* Database Persistence                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record type used for Windows inside the SQLite database.
 */
export const WINDOW_RECORD_TYPE = "window";

/**
 * Inserts or updates a Window in the database.
 *
 * The Window id is used as the record key, so the created_at timestamp of
 * the first insert is preserved across updates.
 */
export async function saveWindow(
  window: MemoryWindow,
): Promise<void> {
  await databaseManager.upsert<MemoryWindow>({
    type: WINDOW_RECORD_TYPE,
    key: window.id,
    data: window,
  });
}

/**
 * Loads and validates every persisted Window, oldest first.
 */
export async function loadAllWindows(): Promise<
  MemoryWindow[]
> {
  const storedRecords =
    await databaseManager.getByType<MemoryWindow>(
      WINDOW_RECORD_TYPE,
    );

  return storedRecords.map((record) => {
    assertValidStoredWindow(record.data);

    return cloneWindow(record.data);
  });
}

/**
 * Removes all persisted Windows from the database.
 */
export async function deleteAllWindows(): Promise<number> {
  return databaseManager.deleteByType(
    WINDOW_RECORD_TYPE,
  );
}

/**
 * Returns the index of the most recent open Window, or -1.
 */
export function findOpenWindowIndex(
  windows: MemoryWindow[],
): number {
  for (
    let index = windows.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (windows[index]?.status === "open") {
      return index;
    }
  }

  return -1;
}
