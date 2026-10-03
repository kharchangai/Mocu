import { beforeEach, describe, expect, it, vi } from "vitest";

const { llmInvoke, readDocMock, saveDocMock, writeDocFileMock } = vi.hoisted(
  () => ({
    llmInvoke: vi.fn(),
    readDocMock: vi.fn(),
    saveDocMock: vi.fn(),
    writeDocFileMock: vi.fn(),
  }),
);

vi.mock("../../services/ai/llm", () => ({
  getAsyncLLM: vi.fn(async () => ({ invoke: llmInvoke })),
}));

vi.mock("./doc-storage", () => ({
  readDoc: readDocMock,
  saveDoc: saveDocMock,
  writeDocFile: writeDocFileMock,
}));

import {
  createDocFromText,
  updateDocFields,
  updateDocFromText,
} from "./doc-generator";

function llmResponds(content: string) {
  llmInvoke.mockResolvedValueOnce({ content });
}

const NEW_SCHEMA_OUTPUT = `---
title: Tauri Plugin Setup
description: How to set up and configure Tauri plugins in mocu.
keywords:
  - tauri
  - plugin
  - setup
---

# Tauri Plugin Setup

See [the Tauri docs](https://tauri.app/plugin/fs) and my
[sqlite notes](sqlite-notes.md) for more.`;

const LEGACY_SCHEMA_OUTPUT = `---
name: Old Style Doc
description: Generated before the id/title schema.
keywords: alpha, beta
---

Legacy body with a [link](other-doc.md).`;

beforeEach(() => {
  llmInvoke.mockReset();
  readDocMock.mockReset();
  saveDocMock.mockReset();
  writeDocFileMock.mockReset();
});

describe("createDocFromText", () => {
  it("saves new-schema frontmatter with a deterministic id and preserves links", async () => {
    llmResponds(NEW_SCHEMA_OUTPUT);
    saveDocMock.mockResolvedValueOnce("tauri-plugin-setup.md");

    const created = await createDocFromText(
      "Remember how we set up Tauri plugins",
    );

    expect(saveDocMock).toHaveBeenCalledTimes(1);

    const [meta, body] = saveDocMock.mock.calls[0];
    expect(meta).toMatchObject({
      id: "tauri-plugin-setup",
      title: "Tauri Plugin Setup",
      description: "How to set up and configure Tauri plugins in mocu.",
      keywords: ["tauri", "plugin", "setup"],
    });
    expect(body).toContain("[the Tauri docs](https://tauri.app/plugin/fs)");
    expect(body).toContain("[sqlite notes](sqlite-notes.md)");

    expect(created.file).toBe("tauri-plugin-setup.md");
    expect(created.id).toBe("tauri-plugin-setup");
    expect(created.title).toBe("Tauri Plugin Setup");
  });

  it("accepts legacy name-shaped LLM output and maps name to title", async () => {
    llmResponds(LEGACY_SCHEMA_OUTPUT);
    saveDocMock.mockResolvedValueOnce("old-style-doc.md");

    const created = await createDocFromText("some raw input text");

    const [meta] = saveDocMock.mock.calls[0];
    expect(meta.title).toBe("Old Style Doc");
    expect(meta.id).toBe("old-style-doc");
    expect(meta.keywords).toEqual(["alpha", "beta"]);
    expect(created.title).toBe("Old Style Doc");
  });

  it("falls back to derived metadata when the frontmatter YAML is invalid", async () => {
    llmResponds(
      `---\ntitle: [broken\ndescription: never parsed\n---\nSaved body [link](x.md)`,
    );
    saveDocMock.mockResolvedValueOnce("fallback.md");

    const created = await createDocFromText(
      "Remember the deployment steps for staging",
    );

    const [meta, body] = saveDocMock.mock.calls[0];
    expect(meta.title).toBe("Remember the deployment steps for staging");
    expect(meta.id).toBe("remember-the-deployment-steps-for-staging");
    expect(meta.description.length).toBeGreaterThan(0);
    // Body below the broken frontmatter is still kept, links included.
    expect(body).toBe("Saved body [link](x.md)");
    expect(created.body).toContain("[link](x.md)");
  });

  it("uses the raw output as body when there is no frontmatter at all", async () => {
    llmResponds("Plain output with a [descriptive link](https://example.com).");
    saveDocMock.mockResolvedValueOnce("plain.md");

    const created = await createDocFromText("plain output please");

    const [meta, body] = saveDocMock.mock.calls[0];
    expect(meta.title).toBe("plain output please");
    expect(meta.id).toBe("plain-output-please");
    expect(body).toBe(
      "Plain output with a [descriptive link](https://example.com).",
    );
    expect(created.file).toBe("plain.md");
  });

  it("rejects empty input", async () => {
    await expect(createDocFromText("   ")).rejects.toThrow(
      "Cannot create a doc from empty text.",
    );
    expect(llmInvoke).not.toHaveBeenCalled();
  });
});

describe("updateDocFromText", () => {
  const existingDoc = {
    file: "stable-doc.md",
    id: "stable-id",
    title: "Stable Doc",
    description: "The original description.",
    keywords: ["stable"],
    body: "# Stable Doc\n\nOriginal body.",
  };

  it("keeps the existing stable id even when the LLM renames the doc", async () => {
    readDocMock.mockResolvedValueOnce({ ...existingDoc });
    llmResponds(`---
title: Completely Different Title
description: A rewritten description.
keywords:
  - rewritten
---

# Completely Different Title

New body.`);

    const updated = await updateDocFromText(
      "stable-doc.md",
      "some new information",
    );

    expect(writeDocFileMock).toHaveBeenCalledTimes(1);

    const [file, meta, body] = writeDocFileMock.mock.calls[0];
    expect(file).toBe("stable-doc.md");
    expect(meta.id).toBe("stable-id");
    expect(meta.title).toBe("Completely Different Title");
    expect(body).toContain("# Completely Different Title");

    expect(updated.file).toBe("stable-doc.md");
    expect(updated.id).toBe("stable-id");
    expect(updated.title).toBe("Completely Different Title");
  });

  it("sends the existing doc to the LLM with the new id/title schema", async () => {
    readDocMock.mockResolvedValueOnce({ ...existingDoc });
    llmResponds(NEW_SCHEMA_OUTPUT);

    await updateDocFromText("stable-doc.md", "more text");

    const messages = llmInvoke.mock.calls[0][0] as Array<
      [string, string | string[]]
    >;
    const human = String(messages[1][1]);

    expect(human).toContain("id: stable-id");
    expect(human).toContain("title: Stable Doc");
    expect(human).toContain("title, description, keywords");
  });

  it("throws when the doc does not exist", async () => {
    readDocMock.mockResolvedValueOnce(null);

    await expect(
      updateDocFromText("missing.md", "text"),
    ).rejects.toThrow('No document named "missing.md" exists to update.');
    expect(llmInvoke).not.toHaveBeenCalled();
  });
});

describe("updateDocFields", () => {
  const existingDoc = {
    file: "field-doc.md",
    id: "field-id",
    title: "Field Doc",
    description: "Original description.",
    keywords: ["one"],
    body: "Original body.",
  };

  it("merges title/description/keywords while keeping the id stable", async () => {
    readDocMock.mockResolvedValueOnce({ ...existingDoc });

    const updated = await updateDocFields("field-doc.md", {
      title: "  Renamed Doc  ",
      description: "   ",
      keywords: ["two", "", " three "],
    });

    const [file, meta, body] = writeDocFileMock.mock.calls[0];
    expect(file).toBe("field-doc.md");
    expect(meta).toEqual({
      id: "field-id",
      title: "Renamed Doc",
      // empty/whitespace description falls back to the existing one
      description: "Original description.",
      keywords: ["two", "three"],
    });
    expect(body).toBe("Original body.");

    expect(updated.id).toBe("field-id");
    expect(updated.title).toBe("Renamed Doc");
  });

  it("updates the body only when provided", async () => {
    readDocMock.mockResolvedValueOnce({ ...existingDoc });

    await updateDocFields("field-doc.md", {
      body: "Brand new body with a [link](other.md).",
    });

    const [, meta, body] = writeDocFileMock.mock.calls[0];
    expect(meta.id).toBe("field-id");
    expect(meta.title).toBe("Field Doc");
    expect(body).toBe("Brand new body with a [link](other.md).");
  });

  it("throws when the doc does not exist", async () => {
    readDocMock.mockResolvedValueOnce(null);

    await expect(
      updateDocFields("missing.md", { title: "X" }),
    ).rejects.toThrow('No document named "missing.md" exists to update.');
    expect(writeDocFileMock).not.toHaveBeenCalled();
  });
});
