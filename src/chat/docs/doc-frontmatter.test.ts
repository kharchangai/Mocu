import { describe, expect, it } from "vitest";

import {
  docNameToSlug,
  normalizeDocId,
  parseDoc,
  serializeDoc,
} from "./doc-frontmatter";

const NEW_SCHEMA_DOC = `---
id: tauri-plugin-setup
title: Tauri Plugin Setup
description: How to set up and configure Tauri plugins in mocu.
keywords:
  - tauri
  - plugin
  - setup
---

# Tauri Plugin Setup

See [the Tauri docs](https://tauri.app/plugin/fs) for details, and my
[notes about sqlite](sqlite-notes.md) for the database side.`;

const LEGACY_SCHEMA_DOC = `---
name: My Legacy Note
description: A note written before the id/title schema existed.
keywords: alpha, beta
---

Legacy body with a descriptive [link to another doc](my-other-doc.md).`;

describe("parseDoc – new schema", () => {
  it("parses id/title/description/keywords and the body", () => {
    const parsed = parseDoc(NEW_SCHEMA_DOC);

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("tauri-plugin-setup");
    expect(parsed!.title).toBe("Tauri Plugin Setup");
    expect(parsed!.description).toBe(
      "How to set up and configure Tauri plugins in mocu.",
    );
    expect(parsed!.keywords).toEqual(["tauri", "plugin", "setup"]);
    expect(parsed!.body).toContain("# Tauri Plugin Setup");
  });

  it("preserves descriptive markdown links in the body", () => {
    const parsed = parseDoc(NEW_SCHEMA_DOC);

    expect(parsed!.body).toContain("[the Tauri docs](https://tauri.app/plugin/fs)");
    expect(parsed!.body).toContain("[notes about sqlite](sqlite-notes.md)");
  });

  it("derives the id from the title when no id is present", () => {
    const parsed = parseDoc(
      `---\ntitle: My Cool Doc\ndescription: D\n---\nbody`,
    );

    expect(parsed!.id).toBe("my-cool-doc");
  });

  it("normalizes an explicit id to a slug", () => {
    const parsed = parseDoc(
      `---\nid: My_Custom ID 42\ntitle: T\ndescription: D\n---\nbody`,
    );

    expect(parsed!.id).toBe("my-custom-id-42");
  });
});

describe("parseDoc – legacy name schema compatibility", () => {
  it("maps name to title and derives the id from the file name when known", () => {
    const parsed = parseDoc(LEGACY_SCHEMA_DOC, { fileName: "my-legacy-note.md" });

    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("My Legacy Note");
    expect(parsed!.id).toBe("my-legacy-note");
    expect(parsed!.description).toBe(
      "A note written before the id/title schema existed.",
    );
    expect(parsed!.keywords).toEqual(["alpha", "beta"]);
    expect(parsed!.body).toContain(
      "[link to another doc](my-other-doc.md)",
    );
  });

  it("derives the id from the title when the file name is unknown", () => {
    const parsed = parseDoc(LEGACY_SCHEMA_DOC);

    expect(parsed!.id).toBe("my-legacy-note");
    expect(parsed!.title).toBe("My Legacy Note");
  });

  it("prefers an explicit id over the file name", () => {
    const parsed = parseDoc(
      `---\nid: stable-id\nname: Legacy Title\ndescription: D\n---\nbody`,
      { fileName: "whatever.md" },
    );

    expect(parsed!.id).toBe("stable-id");
    expect(parsed!.title).toBe("Legacy Title");
  });
});

describe("parseDoc – invalid input", () => {
  it("returns null for invalid YAML", () => {
    const raw = `---\ntitle: [broken\ndescription: never parsed\n---\nbody`;

    expect(parseDoc(raw)).toBeNull();
  });

  it("returns null when the frontmatter is not an object", () => {
    expect(parseDoc(`---\njust a string\n---\nbody`)).toBeNull();
  });

  it("returns null when description is missing", () => {
    expect(
      parseDoc(`---\ntitle: Only Title\n---\nbody`),
    ).toBeNull();
    expect(
      parseDoc(`---\nname: Only Name\n---\nbody`),
    ).toBeNull();
  });

  it("returns null when title/name is missing", () => {
    expect(
      parseDoc(`---\ndescription: Only description\n---\nbody`),
    ).toBeNull();
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(parseDoc(`Just plain markdown without frontmatter.`)).toBeNull();
  });

  it("tolerates output wrapped in a ```markdown fence", () => {
    const fenced = [
      "```markdown",
      "---",
      "title: Fenced Doc",
      "description: Generated inside a fence.",
      "keywords:",
      "  - fenced",
      "---",
      "",
      "# Fenced Doc",
      "```",
    ].join("\n");

    const parsed = parseDoc(fenced);

    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("Fenced Doc");
    expect(parsed!.id).toBe("fenced-doc");
  });

  it("accepts comma-separated keyword strings", () => {
    const parsed = parseDoc(
      `---\ntitle: T\ndescription: D\nkeywords: one, two , three\n---\nbody`,
    );

    expect(parsed!.keywords).toEqual(["one", "two", "three"]);
  });
});

describe("serializeDoc", () => {
  it("writes id/title/description/keywords and round-trips", () => {
    const meta = {
      id: "round-trip",
      title: "Round Trip",
      description: "A doc that round-trips through serialize and parse.",
      keywords: ["alpha", "beta"],
    };
    const body = "# Round Trip\n\nBody content.";

    const serialized = serializeDoc(meta, body);

    expect(serialized.startsWith("---\n")).toBe(true);
    expect(serialized).toContain("id: round-trip");
    expect(serialized).toContain("title: Round Trip");

    const parsed = parseDoc(serialized);

    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe(meta.id);
    expect(parsed!.title).toBe(meta.title);
    expect(parsed!.description).toBe(meta.description);
    expect(parsed!.keywords).toEqual(meta.keywords);
    expect(parsed!.body).toBe(body);
  });

  it("preserves descriptive markdown links verbatim through serialize → parse", () => {
    const meta = {
      id: "linked-doc",
      title: "Linked Doc",
      description: "Docs that link to other docs.",
      keywords: ["links"],
    };
    const body = [
      "Read [other doc](other-doc.md) first, then",
      "[Example Site](https://example.com/path?a=1&b=2).",
      "",
      "Relative [sibling](./sibling-file.md) and [anchor](#section-name) links stay too.",
    ].join("\n");

    const parsed = parseDoc(serializeDoc(meta, body));

    expect(parsed).not.toBeNull();
    expect(parsed!.body).toContain("[other doc](other-doc.md)");
    expect(parsed!.body).toContain(
      "[Example Site](https://example.com/path?a=1&b=2)",
    );
    expect(parsed!.body).toContain("[sibling](./sibling-file.md)");
    expect(parsed!.body).toContain("[anchor](#section-name)");
  });
});

describe("docNameToSlug / normalizeDocId", () => {
  it("slugifies titles into safe file names/ids", () => {
    expect(docNameToSlug("My Cool Doc!")).toBe("my-cool-doc");
    expect(docNameToSlug("  spaced  out  ")).toBe("spaced-out");
    expect(docNameToSlug("!!!")).toBe("doc");
    expect(docNameToSlug("")).toBe("doc");
  });

  it("normalizeDocId matches the slug behavior", () => {
    expect(normalizeDocId("My_Custom ID 42")).toBe("my-custom-id-42");
    expect(normalizeDocId("")).toBe("doc");
  });
});
