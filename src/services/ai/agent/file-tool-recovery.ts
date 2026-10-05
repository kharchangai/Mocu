import { isAbortError, throwIfAborted } from "./abort";

const FILE_TOOLS = new Set(["read_file", "write_file", "edit_file", "find_file"]);

export function isFileToolError(result: unknown): boolean {
  if (typeof result === "string") {
    if (/^\s*(?:Error:|EXECUTION_FAILED\b|SECURITY_BLOCKED\b|SYSTEM_ERROR:)/i.test(result)) return true;
    try { return isFileToolError(JSON.parse(result)); } catch { return false; }
  }
  if (!result || typeof result !== "object") return false;
  const value = result as Record<string, unknown>;
  return value.ok === false || value.success === false || Boolean(value.error);
}

// Object key order must not let an identical failed call bypass recovery.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

/** One instance per turn/executor, never global or persisted across requests. */
export class FileToolRecovery {
  private readonly failures = new Map<string, string>();

  async execute(
    name: string,
    args: unknown,
    run: () => Promise<unknown>,
    terminalAvailable: boolean,
    signal?: AbortSignal,
  ): Promise<unknown> {
    throwIfAborted(signal);
    const isFileTool = FILE_TOOLS.has(name);
    const key = isFileTool ? JSON.stringify([name, canonical(args)]) : "";
    const fallback = terminalAvailable
      ? " If file tools cannot do it reliably, use terminal_executor with the host shell; preserve unrelated content and verify the diff. Never bypass permissions or safety checks."
      : " If you cannot proceed with available tools, explain the blocker.";
    const previous = this.failures.get(key);
    if (isFileTool && previous !== undefined) {
      return `Error: Identical failed ${name} call skipped; it was NOT executed again.\nPrevious error: ${previous}\nChange the arguments or approach; do not repeat this call.${fallback}`;
    }

    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      if (!isFileTool || isAbortError(error) || signal?.aborted) throw error;
      // Keep schema/path errors visible instead of an unhelpful generic failure.
      result = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (isFileTool && isFileToolError(result)) {
      const detail = (typeof result === "string" ? result : JSON.stringify(result)).slice(0, 1200);
      this.failures.set(key, detail);
      return `${detail}\nDo not repeat unchanged arguments. Check the path/schema; for line errors, read the current region and recalculate.${fallback}`;
    }
    // A successful mutation may fix an earlier failure. Reads alone do not.
    if (!isFileToolError(result) && ["edit_file", "write_file", "terminal_executor"].includes(name)) {
      this.failures.clear();
    }
    return result;
  }
}
