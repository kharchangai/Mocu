import { beforeEach, describe, expect, it, vi } from "vitest";

const { files, directories } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  directories: new Set<string>(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  BaseDirectory: { AppData: 1 },
  exists: vi.fn(async (path: string) => {
    if (files.has(path) || directories.has(path)) {
      return true;
    }
    for (const key of files.keys()) {
      if (key.startsWith(`${path}/`)) {
        return true;
      }
    }
    for (const key of directories) {
      if (key.startsWith(`${path}/`)) {
        return true;
      }
    }
    return false;
  }),
  mkdir: vi.fn(async (path: string) => {
    directories.add(path);
  }),
  readDir: vi.fn(async (dir: string) => {
    const prefix = `${dir}/`;
    const names = new Set<string>();
    for (const key of [...files.keys(), ...directories]) {
      if (!key.startsWith(prefix)) continue;
      const remainder = key.slice(prefix.length);
      const [name] = remainder.split("/");
      if (name) names.add(name);
    }
    return Array.from(names, (name) => ({
      name,
      isDirectory:
        directories.has(`${dir}/${name}`) ||
        [...files.keys(), ...directories].some((key) =>
          key.startsWith(`${dir}/${name}/`),
        ),
    }));
  }),
  readTextFile: vi.fn(async (path: string) => {
    const content = files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  }),
  writeTextFile: vi.fn(async (path: string, content: string) => {
    files.set(path, content);
  }),
  remove: vi.fn(async (path: string) => {
    files.delete(path);
  }),
}));

import { parseDoc, serializeDoc } from "./doc-frontmatter";
import { readAllDocs, readDoc, saveDoc } from "./doc-storage";

beforeEach(() => {
  files.clear();
  directories.clear();
});

describe("readDoc with legacy docs", () => {
  it("reads a legacy name-frontmatter doc and derives id from the file name", async () => {
    files.set(
      "docs/my-legacy-note.md",
      [
        "---",
        "name: My Legacy Note",
        "description: Written before the id/title schema.",
        "keywords: alpha, beta",
        "---",
        "",
        "Body with a [link](other-doc.md).",
      ].join("\n"),
    );

    const doc = await readDoc("my-legacy-note.md");

    expect(doc).not.toBeNull();
    expect(doc!.file).toBe("my-legacy-note.md");
    expect(doc!.id).toBe("my-legacy-note");
    expect(doc!.title).toBe("My Legacy Note");
    expect(doc!.keywords).toEqual(["alpha", "beta"]);
    expect(doc!.body).toContain("[link](other-doc.md)");
  });

  it("reads a new-schema doc with its explicit id", async () => {
    files.set(
      "docs/new-doc.md",
      serializeDoc(
        {
          id: "explicit-id",
          title: "New Doc",
          description: "A new schema doc.",
          keywords: ["fresh"],
        },
        "Body.",
      ),
    );

    const doc = await readDoc("new-doc.md");

    expect(doc!.id).toBe("explicit-id");
    expect(doc!.title).toBe("New Doc");
  });

  it("returns null for unsafe names and missing files", async () => {
    expect(await readDoc("../secret.md")).toBeNull();
    expect(await readDoc("missing.md")).toBeNull();
  });
});

describe("saveDoc", () => {
  it("writes new-schema frontmatter and preserves links in the body", async () => {
    const body = "# Fresh Idea\n\nSee [other doc](other-doc.md) and [site](https://example.com).";

    const fileName = await saveDoc(
      {
        id: "fresh-idea",
        title: "Fresh Idea",
        description: "A brand new idea.",
        keywords: ["idea"],
      },
      body,
    );

    expect(fileName).toBe("fresh-idea.md");

    const raw = files.get("docs/fresh-idea.md")!;
    const parsed = parseDoc(raw, { fileName });

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("fresh-idea");
    expect(parsed!.title).toBe("Fresh Idea");
    expect(parsed!.body).toContain("[other doc](other-doc.md)");
    expect(parsed!.body).toContain("[site](https://example.com)");
  });

  it("does not overwrite an existing file name (adds a timestamp suffix)", async () => {
    files.set("docs/fresh-idea.md", "existing content");

    const fileName = await saveDoc(
      {
        id: "fresh-idea-2",
        title: "Fresh Idea",
        description: "Duplicate title.",
        keywords: [],
      },
      "body",
    );

    expect(fileName).toMatch(/^fresh-idea-\d+\.md$/);
    expect(files.get("docs/fresh-idea.md")).toBe("existing content");
    expect(files.has(`docs/${fileName}`)).toBe(true);
  });

  it("suffixes the id when it collides with a different existing doc", async () => {
    files.set(
      "docs/existing.md",
      serializeDoc(
        {
          id: "my-idea",
          title: "Something Else",
          description: "Already owns the id.",
          keywords: [],
        },
        "Existing body.",
      ),
    );

    const fileName = await saveDoc(
      {
        id: "my-idea",
        title: "Fresh Idea",
        description: "Wants the same id.",
        keywords: [],
      },
      "body",
    );

    expect(fileName).toBe("fresh-idea.md");

    const parsed = parseDoc(files.get(`docs/${fileName}`)!);
    expect(parsed!.id).toBe("my-idea-2");
  });
});

describe("readAllDocs id collision safety", () => {
  it("keeps explicit ids unique when two files claim the same one", async () => {
    files.set(
      "docs/first.md",
      serializeDoc(
        {
          id: "shared",
          title: "First",
          description: "First doc.",
          keywords: [],
        },
        "A.",
      ),
    );
    files.set(
      "docs/second.md",
      serializeDoc(
        {
          id: "shared",
          title: "Second",
          description: "Second doc.",
          keywords: [],
        },
        "B.",
      ),
    );

    const docs = await readAllDocs();
    const ids = docs.map((doc) => doc.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain("shared");
    expect(ids).toContain("second");
  });

  it("lists legacy and new-schema docs together", async () => {
    files.set(
      "docs/legacy.md",
      [
        "---",
        "name: Legacy Doc",
        "description: Old schema.",
        "keywords: old",
        "---",
        "",
        "Legacy body.",
      ].join("\n"),
    );
    files.set(
      "docs/modern.md",
      serializeDoc(
        {
          id: "modern",
          title: "Modern Doc",
          description: "New schema.",
          keywords: ["new"],
        },
        "Modern body.",
      ),
    );

    const docs = await readAllDocs();
    const byFile = new Map(docs.map((doc) => [doc.file, doc]));

    expect(byFile.size).toBe(2);
    expect(byFile.get("legacy.md")!.id).toBe("legacy");
    expect(byFile.get("legacy.md")!.title).toBe("Legacy Doc");
    expect(byFile.get("modern.md")!.id).toBe("modern");
  });

  it("recursively lists and reads nested Markdown files using docs-relative paths", async () => {
    files.set(
      "docs/guides/setup.md",
      serializeDoc(
        {
          id: "guide-setup",
          title: "Guide Setup",
          description: "A nested guide document.",
          keywords: ["guide", "setup"],
        },
        "Nested body with [a link](../other.md).",
      ),
    );

    const docs = await readAllDocs();

    expect(docs.map((doc) => doc.file)).toEqual(["guides/setup.md"]);
    expect(docs[0].id).toBe("guide-setup");
    expect(docs[0].body).toContain("[a link](../other.md)");
    expect(await readDoc("guides/setup.md")).toMatchObject({
      file: "guides/setup.md",
      title: "Guide Setup",
    });
    expect(files.has("docs/guides/setup.md")).toBe(true);
  });
});
