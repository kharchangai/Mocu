/*
 * Cancellation regression tests for the filesystem tools.
 *
 * The stop button aborts the chat run's AbortSignal. These tests pin the
 * behaviour that used to be broken: the tool's inner job (directory walk,
 * file reads) must actually STOP when the signal fires — not keep scanning
 * in the background after the promise has already rejected.
 */
import { describe, expect, it, vi } from "vitest";

import { combineAbortSignals } from "../../agent/abort";
import { walkFiles } from "./fs-adapter";
import { findFileTool } from "./find-file-tool";

const mocks = vi.hoisted(() => {
  const readDir = vi.fn();
  const exists = vi.fn();
  const readTextFile = vi.fn();
  const writeTextFile = vi.fn();
  const mkdir = vi.fn();

  return { readDir, exists, readTextFile, writeTextFile, mkdir };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: mocks.exists,
  mkdir: mocks.mkdir,
  readDir: mocks.readDir,
  readTextFile: mocks.readTextFile,
  writeTextFile: mocks.writeTextFile,
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (path: string) => path.replace(/[\\/][^\\/]+$/, ""),
  isAbsolute: async () => true,
  normalize: async (path: string) => path,
}));

type DirEntry = {
  name: string;
  path?: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink?: boolean;
};

const file = (name: string): DirEntry => ({
  name,
  isDirectory: false,
  isFile: true,
});

const dir = (name: string): DirEntry => ({
  name,
  isDirectory: true,
  isFile: false,
});

describe("walkFiles cancellation", () => {
  it("stops the scan as soon as the signal aborts", async () => {
    mocks.readDir.mockImplementation(async (path: string) => {
      void path;
      return [dir("sub"), file("a.ts"), file("b.ts")];
    });

    const controller = new AbortController();
    const walk = walkFiles("E:\\proj", controller.signal);

    // Pull one entry, then cancel the run (like the stop button).
    const first = await walk.next();
    expect(first.done).toBe(false);

    controller.abort();

    await expect(walk.next()).rejects.toMatchObject({
      name: "AbortError",
    });

    // The cancelled walk must not read any further directories.
    const callsAfterAbort = mocks.readDir.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.readDir.mock.calls.length).toBe(callsAfterAbort);
  });
});

describe("find_file cancellation", () => {
  it("rejects with AbortError and truly stops the background job", async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.readTextFile.mockResolvedValue("nothing to hide here");
    mocks.readDir.mockReset();

    let readDirCalls = 0;
    mocks.readDir.mockImplementation(async () => {
      readDirCalls += 1;

      // Simulate the user pressing stop mid-walk.
      if (readDirCalls === 3) {
        controller.abort();
      }

      return [dir("nested"), file("one.ts"), file("two.ts")];
    });

    const controller = new AbortController();

    await expect(
      findFileTool.invoke(
        { root: "E:\\proj", contentPattern: "needle" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    // The fix: the walk itself must stop, not run to completion behind
    // the already-rejected promise.
    const callsAtCancel = readDirCalls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readDirCalls).toBe(callsAtCancel);
  });

  it("keeps working when the signal is never aborted", async () => {
    mocks.exists.mockResolvedValue(true);
    mocks.readDir.mockReset();
    mocks.readDir.mockImplementation(async (path: string) =>
      String(path).includes("nested") ? [] : [dir("nested"), file("one.ts")],
    );
    mocks.readTextFile.mockResolvedValue("a needle in the haystack");

    const result = await findFileTool.invoke(
      { root: "E:\\proj", contentPattern: "needle" },
      {},
    );

    expect(String(result)).toContain("one.ts");
  });
});

describe("combineAbortSignals", () => {
  it("returns undefined when no signal is given", () => {
    expect(combineAbortSignals([undefined, undefined])).toBeUndefined();
  });

  it("passes through a single signal", () => {
    const controller = new AbortController();
    expect(combineAbortSignals([controller.signal])).toBe(controller.signal);
  });

  it("aborts when any input signal aborts", () => {
    const first = new AbortController();
    const second = new AbortController();

    const combined = combineAbortSignals([first.signal, second.signal]);
    expect(combined).toBeDefined();
    expect(combined?.aborted).toBe(false);

    second.abort();

    expect(combined?.aborted).toBe(true);
  });
});
