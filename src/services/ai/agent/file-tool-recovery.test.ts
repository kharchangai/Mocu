import { describe, expect, it, vi } from "vitest";
import { FileToolRecovery, isFileToolError } from "./file-tool-recovery";
import { ToolExecutor } from "./tool-executor";
import { FILE_TOOLS_SYSTEM_PROMPT } from "../tools/filesystem/prompt";
import { shortToolDescription } from "./tool-summaries";

const args = { path: "E:\\project\\file.ts", edits: [{ startLine: 8, endLine: 7, text: "new" }] };

describe("file tool recovery", () => {
  it("blocks an identical failed call even with reordered keys or intervening reads", async () => {
    const recovery = new FileToolRecovery();
    const run = vi.fn(async () => "Error: Overlapping edits");
    expect(await recovery.execute("edit_file", args, run, true)).toContain("terminal_executor");
    await recovery.execute("read_file", { path: args.path }, async () => "File: current lines", true);
    const reordered = { edits: [{ text: "new", endLine: 7, startLine: 8 }], path: args.path };
    const result = await recovery.execute("edit_file", reordered, run, true);
    expect(result).toContain("NOT executed again");
    expect(result).toContain("Overlapping edits");
    expect(run).toHaveBeenCalledOnce();
  });

  it("preserves thrown schema errors instead of swallowing their reason", async () => {
    const recovery = new FileToolRecovery();
    const run = vi.fn(async () => { throw new Error("edits[0].startLine must be an integer"); });
    const result = await recovery.execute("edit_file", args, run, true);
    expect(result).toContain("startLine must be an integer");
    expect(result).toContain("Never bypass permissions");
    await recovery.execute("edit_file", args, run, true);
    expect(run).toHaveBeenCalledOnce();
  });

  it("allows corrected arguments immediately", async () => {
    const recovery = new FileToolRecovery();
    const run = vi.fn().mockResolvedValueOnce("Error: invalid range").mockResolvedValueOnce("Edited file");
    await recovery.execute("edit_file", args, run, true);
    expect(await recovery.execute("edit_file", { ...args, edits: [{ startLine: 2, endLine: 2, text: "new" }] }, run, true)).toBe("Edited file");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not recommend an unavailable terminal", async () => {
    const result = await new FileToolRecovery().execute("write_file", args, async () => "Error: file exists", false);
    expect(result).not.toContain("terminal_executor");
    expect(result).toContain("explain the blocker");
  });

  it("keeps failure state isolated per turn", async () => {
    const run = vi.fn(async () => "Error: missing file");
    await new FileToolRecovery().execute("read_file", args, run, true);
    await new FileToolRecovery().execute("read_file", args, run, true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("allows retry after a successful repair, not after a failed terminal command", async () => {
    const recovery = new FileToolRecovery();
    const run = vi.fn(async () => "Error: missing file");
    await recovery.execute("read_file", args, run, true);
    await recovery.execute("terminal_executor", {}, async () => "SYSTEM_ERROR: failed", true);
    await recovery.execute("read_file", args, run, true);
    expect(run).toHaveBeenCalledOnce();
    await recovery.execute("terminal_executor", {}, async () => "Created missing file", true);
    await recovery.execute("read_file", args, run, true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("never caches cancellation or converts it to a file failure", async () => {
    const recovery = new FileToolRecovery();
    const error = new DOMException("Stopped", "AbortError");
    await expect(recovery.execute("edit_file", args, async () => { throw error; }, true)).rejects.toBe(error);
    const run = vi.fn(async () => "Edited file");
    expect(await recovery.execute("edit_file", args, run, true)).toBe("Edited file");
    const controller = new AbortController();
    controller.abort();
    await expect(recovery.execute("edit_file", args, run, true, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not limit successful file calls or other tools", async () => {
    const recovery = new FileToolRecovery();
    const run = vi.fn(async () => "Read complete");
    for (let i = 0; i < 15; i++) await recovery.execute("read_file", args, run, true);
    expect(run).toHaveBeenCalledTimes(15);
    const fail = vi.fn(async () => { throw new Error("network failure"); });
    await expect(recovery.execute("perplexity_search", {}, fail, true)).rejects.toThrow("network failure");
    await expect(recovery.execute("perplexity_search", {}, fail, true)).rejects.toThrow("network failure");
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it("recognizes text and structured failures without treating ordinary data as errors", () => {
    for (const result of ["Error: range", "EXECUTION_FAILED\nexit 1", "SECURITY_BLOCKED: denied", "SYSTEM_ERROR: unavailable", '{"ok":false}', { error: "denied" }]) {
      expect(isFileToolError(result)).toBe(true);
    }
    for (const result of ["Edited file", "File: test\n1 | throw new Error('x');", { ok: true }, "null"]) {
      expect(isFileToolError(result)).toBe(false);
    }
  });

  it("is wired into ToolExecutor and reports returned failures accurately", async () => {
    const executor = new ToolExecutor();
    const execute = vi.fn(async () => "Error: bad range");
    executor.registerTool({ name: "edit_file", description: "edit", execute });
    executor.registerTool({ name: "terminal_executor", description: "shell", execute: async () => "done" });
    const first = await executor.executeCall({ name: "edit_file", arguments: args });
    expect(first.success).toBe(false);
    expect(first.result).toContain("bad range");
    expect(await executor.execute("edit_file", args)).toContain("NOT executed again");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("keeps the prompt compact and permits terminal fallback in specialist summaries", () => {
    expect(FILE_TOOLS_SYSTEM_PROMPT.length).toBeLessThan(1700);
    expect(FILE_TOOLS_SYSTEM_PROMPT).toContain("AFTER");
    expect(FILE_TOOLS_SYSTEM_PROMPT).toContain("never repeat");
    expect(FILE_TOOLS_SYSTEM_PROMPT).toContain("terminal_executor");
    expect(shortToolDescription("terminal_executor")).not.toContain("Do NOT use");
    expect(shortToolDescription("terminal_executor")).toContain("verify the diff");
  });
});
