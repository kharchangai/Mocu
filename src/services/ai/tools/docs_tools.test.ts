import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, syncCalls, removeCalls } = vi.hoisted(() => ({
  state: {
    files: new Map<string, string>(),
    llmText: "",
    embedCalls: [] as string[],
  },
  syncCalls: [] as string[],
  removeCalls: [] as string[],
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (path: string) => {
    if (state.files.has(path)) {
      return true;
    }
    for (const key of state.files.keys()) {
      if (key.startsWith(`${path}/`)) {
        return true;
      }
    }
    return false;
  }),
  mkdir: vi.fn(async () => undefined),
  readDir: vi.fn(async (dir: string) =>
    Array.from(state.files.keys())
      .filter((key) => key.startsWith(`${dir}/`))
      .map((key) => ({ name: key.slice(dir.length + 1), isDirectory: false })),
  ),
  readTextFile: vi.fn(async (path: string) => {
    const content = state.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    state.files.set(path, content);
  }),
  remove: vi.fn(async (path: string) => {
    state.files.delete(path);
  }),
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn(async () => "C:/appdata"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

// SQL is fully faked: the tests assert that lifecycle tools still invoke the
// index synchronization hooks, without needing a real SQLite database.
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    load: vi.fn(async () => ({
      select: vi.fn(async (sql: string) =>
        sql.trim().toLowerCase() === "select 1" ? [{ "1": 1 }] : [],
      ),
      execute: vi.fn(async () => ({ rowsAffected: 0 })),
    })),
  },
}));

vi.mock("../../../store", () => ({
  readSettings: vi.fn(async () => ({ embeddingModel: "test-model" })),
}));

vi.mock("./textSimilarity", () => ({
  textSimilarity: {
    embedText: vi.fn(async (text: string) => {
      state.embedCalls.push(text);
      return [0.25, 0.5, 0.75];
    }),
  },
}));

vi.mock("../llm", () => ({
  getAsyncLLM: vi.fn(async () => ({
    invoke: vi.fn(async () => ({ content: state.llmText })),
  })),
}));

vi.mock("../../../chat/docs/doc-index", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../chat/docs/doc-index")>();
  return {
    ...actual,
    syncDocIndexAfterWrite: vi.fn(async (...args: unknown[]) => {
      syncCalls.push(String(args[0]));
    }),
    removeDocFromIndex: vi.fn(async (...args: unknown[]) => {
      removeCalls.push(String(args[0]));
    }),
  };
});

import {
  createDocTool,
  deleteDocTool,
  listDocsTool,
  readDocTool,
  updateDocTool,
} from "./docs_tools";

beforeEach(() => {
  vi.clearAllMocks();
  state.files.clear();
  state.llmText = "";
  state.embedCalls.length = 0;
  syncCalls.length = 0;
  removeCalls.length = 0;
});

function seedDoc(
  path: string,
  meta: { id: string; title: string; description: string; keywords: string[] },
  body: string,
): void {
  state.files.set(
    path,
    [
      "---",
      `id: ${meta.id}`,
      `title: ${meta.title}`,
      `description: ${meta.description}`,
      "keywords:",
      ...meta.keywords.map((keyword) => `  - ${keyword}`),
      "---",
      "",
      body,
    ].join("\n"),
  );
}

describe("read_knowledge_doc — one safe document per call", () => {
  it("reads exactly one document by plain file name", async () => {
    seedDoc(
      "docs/root-doc.md",
      {
        id: "root-doc",
        title: "Root Doc",
        description: "A root doc.",
        keywords: ["root"],
      },
      "Root body with a [link](guides/deep.md).",
    );

    const result = await readDocTool.invoke({ fileName: "root-doc.md" });

    expect(result).toContain('Knowledge document "root-doc.md"');
    expect(result).toContain("id: root-doc");
    expect(result).toContain("Title: Root Doc");
    expect(result).toContain("Description: A root doc.");
    expect(result).toContain("Keywords: root");
    expect(result).toContain("Root body with a [link](guides/deep.md).");
    // Exactly one document read: no other file was touched.
    expect(result).not.toContain("Deep body");
  });

  it("follows a nested relative link using currentDoc", async () => {
    seedDoc(
      "docs/guides/setup.md",
      {
        id: "setup",
        title: "Setup",
        description: "Setup guide.",
        keywords: ["setup"],
      },
      "Setup body. See [deep dive](deep.md) for details.",
    );
    seedDoc(
      "docs/guides/deep.md",
      {
        id: "deep",
        title: "Deep Dive",
        description: "Nested doc.",
        keywords: ["deep"],
      },
      "Deep body.",
    );

    const result = await readDocTool.invoke({
      fileName: "deep.md",
      currentDoc: "guides/setup.md",
    });

    expect(result).toContain('Knowledge document "guides/deep.md"');
    expect(result).toContain("Title: Deep Dive");
    expect(result).toContain("Deep body.");
  });

  it("resolves the `path` alias and strips anchors", async () => {
    seedDoc(
      "docs/other.md",
      {
        id: "other",
        title: "Other",
        description: "Other doc.",
        keywords: ["other"],
      },
      "Other body.",
    );

    const result = await readDocTool.invoke({
      path: "other.md#section",
    });

    expect(result).toContain('Knowledge document "other.md"');
    expect(result).toContain("Other body.");
  });

  it("accepts root-relative references emitted in the prompt", async () => {
    seedDoc(
      "docs/my-doc.md",
      {
        id: "my-doc",
        title: "My Doc",
        description: "Prompt reference.",
        keywords: ["prompt"],
      },
      "Prompt body.",
    );

    const result = await readDocTool.invoke({
      fileName: "/my-doc.md",
      currentDoc: "guides/setup.md",
    });

    expect(result).toContain('Knowledge document "my-doc.md"');
    expect(result).toContain("Prompt body.");
  });

  it("returns a missing-file error without reading anything else", async () => {
    const result = await readDocTool.invoke({ fileName: "missing.md" });

    expect(result).toContain("Error:");
    expect(result).toContain("missing.md");
    expect(result).toContain("list_knowledge_docs");
  });

  it("rejects traversal and out-of-root references", async () => {
    const rejected = [
      // No currentDoc: any leading ".." leaves the docs root.
      { fileName: "../secret.md" },
      { fileName: "guides/../../secret.md" },
      // With currentDoc: two levels up from guides/setup.md escapes root.
      { fileName: "../../etc/passwd", currentDoc: "guides/setup.md" },
    ];

    for (const args of rejected) {
      const result = await readDocTool.invoke(args);
      expect(result).toContain("Error:");
      expect(result).toMatch(/outside|Traversal/i);
    }
  });

  it("rejects absolute paths", async () => {
    const result = await readDocTool.invoke({
      fileName: "C:/Windows/System32/secret.md",
    });

    expect(result).toContain("Error:");
    expect(result).toContain("absolute file path");
  });

  it("rejects external URLs — links are never auto-fetched", async () => {
    const result = await readDocTool.invoke({
      fileName: "https://example.com/a.md",
      currentDoc: "guides/setup.md",
    });

    expect(result).toContain("Error:");
    expect(result).toContain("URL/external address");
  });

  it("requires some reference argument", async () => {
    const result = await readDocTool.invoke({});
    expect(result).toContain("Error:");
    expect(result).toContain("reference is required");
  });
});

describe("read_knowledge_doc — proof of no automated link reads", () => {
  it("returns exactly ONE document and never touches linked files", async () => {
    seedDoc(
      "docs/hub.md",
      {
        id: "hub",
        title: "Hub",
        description: "Links to two docs.",
        keywords: ["hub"],
      },
      [
        "Hub body.",
        "See [alpha](alpha.md) and [beta](nested/beta.md).",
        "Also [external](https://example.com/x) and [escape](../escape.md).",
      ].join("\n"),
    );
    seedDoc(
      "docs/alpha.md",
      {
        id: "alpha",
        title: "Alpha",
        description: "Linked doc A.",
        keywords: ["alpha"],
      },
      "Alpha body SECRET-A.",
    );
    seedDoc(
      "docs/nested/beta.md",
      {
        id: "beta",
        title: "Beta",
        description: "Linked doc B.",
        keywords: ["beta"],
      },
      "Beta body SECRET-B.",
    );
    state.files.set("escape.md", "ESCAPE outside docs root.");

    const result = await readDocTool.invoke({ fileName: "hub.md" });

    // Only the hub's own content is returned.
    expect(result).toContain("Hub body.");
    expect(result).not.toContain("SECRET-A");
    expect(result).not.toContain("SECRET-B");
    expect(result).not.toContain("ESCAPE");
    // The links remain plain text in the body — never expanded.
    expect(result).toContain("[alpha](alpha.md)");
    expect(result).toContain("[beta](nested/beta.md)");
    expect(result).toContain("[external](https://example.com/x)");

    // Only the one requested file was read.
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    expect(
      (readTextFile as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
      ),
    ).toEqual(["docs/hub.md"]);
  });

  it("holds for nested currentDoc reads too", async () => {
    seedDoc(
      "docs/guides/setup.md",
      {
        id: "setup",
        title: "Setup",
        description: "Setup guide.",
        keywords: ["setup"],
      },
      "Setup body. See [deep](deep.md) and [up](../root.md).",
    );
    seedDoc(
      "docs/guides/deep.md",
      {
        id: "deep",
        title: "Deep",
        description: "Nested.",
        keywords: ["deep"],
      },
      "Deep body SECRET-DEEP. See [root](../root.md).",
    );
    seedDoc(
      "docs/root.md",
      {
        id: "root",
        title: "Root",
        description: "Root doc.",
        keywords: ["root"],
      },
      "Root body SECRET-ROOT.",
    );

    const result = await readDocTool.invoke({
      fileName: "deep.md",
      currentDoc: "guides/setup.md",
    });

    expect(result).toContain("Deep body SECRET-DEEP.");
    expect(result).not.toContain("SECRET-ROOT");

    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    expect(
      (readTextFile as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0],
      ),
    ).toEqual(["docs/guides/deep.md"]);
  });

  it("exposes exactly one tool call interface — no crawler hook", async () => {
    expect(readDocTool.name).toBe("read_knowledge_doc");
    const schema = JSON.stringify(readDocTool.schema);
    expect(schema).toContain("fileName");
    expect(schema).toContain("currentDoc");
    // The tool takes only a reference + current doc — nothing that would
    // request link traversal, batching, or model-based link evaluation.
    expect(schema).not.toMatch(/crawl|followLinks|depth|recursive/i);
  });
});

describe("lifecycle tools invoke index synchronization", () => {
  it("create_knowledge_doc writes the file and syncs the index", async () => {
    state.llmText = [
      "---",
      "title: Fresh Idea",
      "description: A brand new idea worth saving.",
      "keywords:",
      "  - idea",
      "  - fresh",
      "---",
      "",
      "# Fresh Idea",
      "",
      "Body with a [link](other.md).",
    ].join("\n");

    const result = await createDocTool.invoke({
      text: "Remember this fresh idea.",
    });

    expect(result).toContain('saved as "fresh-idea.md"');
    expect(state.files.has("docs/fresh-idea.md")).toBe(true);
    expect(state.files.get("docs/fresh-idea.md")).toContain(
      "[link](other.md)",
    );
    expect(syncCalls).toEqual(["fresh-idea.md"]);
  });

  it("update_knowledge_doc (metadata) writes and re-syncs the index", async () => {
    seedDoc(
      "docs/existing.md",
      {
        id: "existing",
        title: "Existing",
        description: "Before.",
        keywords: ["old"],
      },
      "Body.",
    );

    const result = await updateDocTool.invoke({
      fileName: "existing.md",
      description: "After.",
      keywords: ["new"],
    });

    expect(result).toContain("updated");
    expect(state.files.get("docs/existing.md")).toContain("After.");
    expect(syncCalls).toEqual(["existing.md"]);
  });

  it("delete_knowledge_doc removes the file and its index row", async () => {
    seedDoc(
      "docs/doomed.md",
      {
        id: "doomed",
        title: "Doomed",
        description: "To be deleted.",
        keywords: ["delete"],
      },
      "Body.",
    );

    const result = await deleteDocTool.invoke({ fileName: "doomed.md" });

    expect(result).toContain("deleted");
    expect(state.files.has("docs/doomed.md")).toBe(false);
    expect(removeCalls).toEqual(["doomed.md"]);
  });

  it("delete_knowledge_doc rejects unsafe names before touching anything", async () => {
    seedDoc(
      "docs/safe.md",
      {
        id: "safe",
        title: "Safe",
        description: "Safe doc.",
        keywords: ["safe"],
      },
      "Body.",
    );

    const result = await deleteDocTool.invoke({ fileName: "../safe.md" });

    expect(result).toContain("Error:");
    expect(result).toContain("outside the global docs folder");
    expect(state.files.has("docs/safe.md")).toBe(true);
    expect(removeCalls).toEqual([]);
  });

  it("list_knowledge_docs lists files with the new schema metadata", async () => {
    seedDoc(
      "docs/alpha.md",
      {
        id: "alpha",
        title: "Alpha",
        description: "First.",
        keywords: ["one", "two"],
      },
      "A.",
    );
    seedDoc(
      "docs/beta.md",
      {
        id: "beta",
        title: "Beta",
        description: "Second.",
        keywords: ["three"],
      },
      "B.",
    );

    const result = await listDocsTool.invoke({});

    expect(result).toContain(
      "- alpha.md | Alpha | First. | keywords: one, two",
    );
    expect(result).toContain("- beta.md | Beta | Second. | keywords: three");
  });
});