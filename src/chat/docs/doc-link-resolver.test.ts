import { describe, expect, it } from "vitest";
import {
  describeDocReferenceRejection,
  resolveDocReference,
  stripAnchor,
} from "./doc-link-resolver";

describe("stripAnchor", () => {
  it("strips a trailing markdown anchor", () => {
    expect(stripAnchor("other.md#section")).toBe("other.md");
    expect(stripAnchor("guides/setup.md#step-2--nested")).toBe(
      "guides/setup.md",
    );
  });

  it("keeps references without an anchor untouched", () => {
    expect(stripAnchor("plain.md")).toBe("plain.md");
  });
});

describe("resolveDocReference — accepted references", () => {
  it("resolves a plain file name against the docs root", () => {
    expect(resolveDocReference("my-idea.md")).toEqual({
      ok: true,
      path: "my-idea.md",
    });
  });

  it("resolves a nested docs-relative path", () => {
    expect(resolveDocReference("guides/deep.md")).toEqual({
      ok: true,
      path: "guides/deep.md",
    });
  });

  it("resolves a relative link against the current doc's folder", () => {
    expect(resolveDocReference("deep.md", "guides/setup.md")).toEqual({
      ok: true,
      path: "guides/deep.md",
    });
    expect(resolveDocReference("./sibling.md", "guides/setup.md")).toEqual({
      ok: true,
      path: "guides/sibling.md",
    });
  });

  it("resolves a parent-directory link that stays inside the docs root", () => {
    expect(resolveDocReference("../shared.md", "guides/setup.md")).toEqual({
      ok: true,
      path: "shared.md",
    });
    expect(
      resolveDocReference("../api/ref.md", "guides/nested/setup.md"),
    ).toEqual({
      ok: true,
      path: "guides/api/ref.md",
    });
  });

  it("strips anchors before lookup", () => {
    expect(resolveDocReference("other.md#section", "guides/setup.md")).toEqual({
      ok: true,
      path: "guides/other.md",
    });
  });

  it("accepts root-relative references emitted in the prompt", () => {
    expect(resolveDocReference("/my-doc.md", "guides/setup.md")).toEqual({
      ok: true,
      path: "my-doc.md",
    });
    expect(resolveDocReference("/guides/deep.md")).toEqual({
      ok: true,
      path: "guides/deep.md",
    });
  });

  it("accepts AppData-relative docs/ references as docs-root-relative", () => {
    expect(resolveDocReference("docs/my-doc.md", "guides/setup.md")).toEqual({
      ok: true,
      path: "my-doc.md",
    });
  });
});

describe("resolveDocReference — rejections", () => {
  it("rejects traversal that would leave the docs root", () => {
    expect(resolveDocReference("../secret.md")).toEqual({
      ok: false,
      reason: "traversal",
    });
    expect(resolveDocReference("../../etc/passwd", "guides/setup.md")).toEqual({
      ok: false,
      reason: "traversal",
    });
    expect(resolveDocReference("guides/../../secret.md")).toEqual({
      ok: false,
      reason: "traversal",
    });
    expect(resolveDocReference("/../secret.md")).toEqual({
      ok: false,
      reason: "traversal",
    });
  });

  it("rejects absolute file paths (drive letters and UNC shares)", () => {
    expect(resolveDocReference("C:/Windows/System32/x.md")).toEqual({
      ok: false,
      reason: "absolute-path",
    });
    expect(resolveDocReference("C:\\Users\\me\\secret.md")).toEqual({
      ok: false,
      reason: "absolute-path",
    });
    expect(resolveDocReference("\\\\server\\share\\x.md")).toEqual({
      ok: false,
      reason: "absolute-path",
    });
    expect(resolveDocReference("//host/path.md")).toEqual({
      ok: false,
      reason: "absolute-path",
    });
  });

  it("rejects URLs — external links are never resolved", () => {
    expect(resolveDocReference("https://example.com/a.md")).toEqual({
      ok: false,
      reason: "url",
    });
    expect(
      resolveDocReference("file:///c:/secret.md", "guides/setup.md"),
    ).toEqual({
      ok: false,
      reason: "url",
    });
    expect(resolveDocReference("data:text/plain;base64,AAAA")).toEqual({
      ok: false,
      reason: "url",
    });
  });

  it("rejects query strings", () => {
    expect(resolveDocReference("a.md?v=1")).toEqual({
      ok: false,
      reason: "query-string",
    });
  });

  it("rejects empty references", () => {
    expect(resolveDocReference("")).toEqual({ ok: false, reason: "empty" });
    expect(resolveDocReference("   ")).toEqual({ ok: false, reason: "empty" });
    expect(resolveDocReference("#anchor-only")).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("rejects an unsafe current doc path", () => {
    expect(resolveDocReference("x.md", "../evil.md")).toEqual({
      ok: false,
      reason: "outside-root",
    });
  });

  it("produces a human-facing message for every rejection reason", () => {
    for (const reason of [
      "url",
      "query-string",
      "absolute-path",
      "traversal",
      "outside-root",
    ] as const) {
      const message = describeDocReferenceRejection(reason, "bad-ref");
      expect(message.startsWith("Error:")).toBe(true);
      expect(message).toContain("bad-ref");
    }

    expect(describeDocReferenceRejection("empty", "")).toContain("Error:");
  });
});