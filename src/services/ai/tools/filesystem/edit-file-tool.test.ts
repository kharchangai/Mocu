import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: mocks.exists,
  mkdir: mocks.mkdir,
  readDir: vi.fn(),
  readTextFile: mocks.readTextFile,
  writeTextFile: mocks.writeTextFile,
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (path: string) => path.replace(/[\\/][^\\/]+$/, ""),
  isAbsolute: async () => true,
  normalize: async (path: string) => path,
}));

import { editFileTool } from "./edit-file-tool";

describe("edit_file line-ending preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exists.mockResolvedValue(true);
    mocks.writeTextFile.mockResolvedValue(undefined);
  });

  it("preserves CRLF endings when editing a Windows source file", async () => {
    mocks.readTextFile.mockResolvedValue("const first = 1;\r\nconst second = 2;\r\n");

    await editFileTool.invoke(
      {
        path: "E:\\project\\example.ts",
        edits: [{ startLine: 2, endLine: 2, text: "const second = 3;" }],
      },
      {},
    );

    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "E:\\project\\example.ts",
      "const first = 1;\r\nconst second = 3;\r\n",
    );
  });

  it("uses the existing line ending for inserted replacement lines", async () => {
    mocks.readTextFile.mockResolvedValue("first\r\nlast\r\n");

    await editFileTool.invoke(
      {
        path: "E:\\project\\example.ts",
        edits: [{ startLine: 2, endLine: 1, text: "middle one\nmiddle two" }],
      },
      {},
    );

    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "E:\\project\\example.ts",
      "first\r\nmiddle one\r\nmiddle two\r\nlast\r\n",
    );
  });
  it("reports an unchanged edit without writing the file again", async () => {
    mocks.readTextFile.mockResolvedValue("first\r\nsecond\r\n");
    const result = await editFileTool.invoke({
      path: "E:\\project\\example.ts",
      edits: [{ startLine: 2, endLine: 2, text: "second" }],
    }, {});
    expect(result).toContain("No changes needed");
    expect(result).toContain("Do not repeat");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("validates the entire batch before writing and preserves the error reason", async () => {
    mocks.readTextFile.mockResolvedValue("first\nsecond\nthird\n");
    const result = await editFileTool.invoke({
      path: "E:\\project\\example.ts",
      edits: [
        { startLine: 1, endLine: 2, text: "one" },
        { startLine: 2, endLine: 3, text: "two" },
      ],
    }, {});
    expect(result).toContain("Error: Overlapping edits");
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("reminds the model to use fresh AFTER numbers for the next edit", async () => {
    mocks.readTextFile.mockResolvedValue("first\nsecond\n");
    const result = await editFileTool.invoke({
      path: "E:\\project\\example.ts",
      edits: [{ startLine: 1, endLine: 0, text: "inserted" }],
    }, {});
    expect(result).toContain("use the AFTER line numbers");
    expect(result).toContain("   2 | first");
  });
});
