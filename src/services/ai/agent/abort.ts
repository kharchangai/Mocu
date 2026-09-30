export const createAbortError = (): DOMException => {
  return new DOMException(
    "The operation was cancelled.",
    "AbortError",
  );
};

export const throwIfAborted = (
  signal?: AbortSignal,
): void => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

/*
 * Combines several abort signals into one that aborts as soon as any of
 * them aborts (e.g. the chat run's cancel signal plus a fetch timeout).
 * Returns undefined when no signal is given.
 */
export const combineAbortSignals = (
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined => {
  const defined = signals.filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );

  if (defined.length === 0) {
    return undefined;
  }

  if (defined.length === 1) {
    return defined[0];
  }

  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;

  if (typeof anyFn === "function") {
    return anyFn(defined);
  }

  // Fallback for older WebViews without AbortSignal.any.
  const controller = new AbortController();

  for (const signal of defined) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    signal.addEventListener(
      "abort",
      () => controller.abort(signal.reason),
      { once: true },
    );
  }

  return controller.signal;
};

export const isAbortError = (
  error: unknown,
): boolean => {
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  ) || (
    error instanceof Error &&
    error.name === "AbortError"
  );
};