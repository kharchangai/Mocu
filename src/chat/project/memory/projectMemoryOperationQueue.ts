/*
 * Project memory uses a few shared SQLite connection managers whose active
 * database is switched when the selected project changes. Retrieval and
 * background saves must therefore not run at the same time: otherwise a
 * retrieval for project A can switch a manager while a save for project B is
 * still using it.
 */

let operationQueue: Promise<void> = Promise.resolve();

export function runProjectMemoryExclusive<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const nextOperation = operationQueue.then(operation);

  operationQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  );

  return nextOperation;
}
