import { describe, expect, it } from "vitest";

import {
  applyLineEdit,
  applyLineEdits,
  editLineDelta,
  formatNumberedLines,
  joinLines,
  replacementLines,
  splitLines,
  validateLineEdit,
} from "./line-utils";
import { renderNumberedWindow } from "./read-file-tool";
import { formatEditPreview } from "./edit-file-tool";
import {
  compilePattern,
  deriveKeywordPattern,
  findFileInputSchema,
  stripInlineFlags,
} from "./find-file-tool";
import { probabilityOfRelevant } from "./jev-relevance";

describe("line-utils", () => {
  it("normalizes CRLF and round-trips content", () => {
    expect(splitLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    expect(joinLines(splitLines("a\r\nb"))).toBe("a\nb");
  });

  it("formats lines with right-aligned numbers", () => {
    const text = formatNumberedLines(["first", "second"], 8);
    expect(text).toBe("   8 | first\n   9 | second");
  });

  it("replaces a single line", () => {
    const lines = ["a", "b", "c"];
    const result = applyLineEdit(lines, {
      startLine: 2,
      endLine: 2,
      text: "X",
    });
    expect(result).toEqual(["a", "X", "c"]);
  });

  it("replaces a multi-line range", () => {
    const lines = ["a", "b", "c", "d"];
    const result = applyLineEdit(lines, {
      startLine: 2,
      endLine: 3,
      text: "X\nY\nZ",
    });
    expect(result).toEqual(["a", "X", "Y", "Z", "d"]);
  });

  it("deletes lines with empty text", () => {
    const lines = ["a", "b", "c"];
    const result = applyLineEdit(lines, {
      startLine: 1,
      endLine: 2,
      text: "",
    });
    expect(result).toEqual(["c"]);
  });

  it("inserts without deleting when endLine = startLine - 1", () => {
    const lines = ["a", "b"];
    const result = applyLineEdit(lines, {
      startLine: 2,
      endLine: 1,
      text: "X",
    });
    expect(result).toEqual(["a", "X", "b"]);
  });

  it("appends at the end via insertion after the last line", () => {
    const lines = ["a", "b"];
    const result = applyLineEdit(lines, {
      startLine: 3,
      endLine: 2,
      text: "c",
    });
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("applies multiple edits in one pass with stable numbering", () => {
    const lines = ["1", "2", "3", "4", "5"];
    const result = applyLineEdits(lines, [
      { startLine: 1, endLine: 1, text: "one" },
      { startLine: 4, endLine: 5, text: "four\nfive" },
    ]);
    expect(result).toEqual(["one", "2", "3", "four", "five"]);
  });

  it("rejects out-of-range edits", () => {
    expect(() =>
      validateLineEdit({ startLine: 4, endLine: 4, text: "x" }, 3),
    ).toThrow(/beyond the end/);
    expect(() =>
      validateLineEdit({ startLine: 0, endLine: 1, text: "x" }, 3),
    ).toThrow(/1-based/);
  });

  it("rejects overlapping edits", () => {
    expect(() =>
      applyLineEdits(["a", "b", "c"], [
        { startLine: 1, endLine: 2, text: "x" },
        { startLine: 2, endLine: 3, text: "y" },
      ]),
    ).toThrow(/[Oo]verlap/);
  });

  it("rejects an ambiguous gap range", () => {
    expect(() =>
      validateLineEdit({ startLine: 3, endLine: 1, text: "x" }, 5),
    ).toThrow(/Invalid line range/);
  });
});

describe("replacement text lines", () => {
  it("treats a trailing newline as a line terminator, not a blank line", () => {
    expect(replacementLines("x")).toEqual(["x"]);
    expect(replacementLines("x\n")).toEqual(["x"]);
    expect(replacementLines("a\nb\n")).toEqual(["a", "b"]);
    expect(replacementLines("x\n\n")).toEqual(["x", ""]);
  });

  it("blanks one line with a lone newline and deletes with empty text", () => {
    expect(replacementLines("\n")).toEqual([""]);
    expect(replacementLines("")).toEqual([]);

    // Regression: text ending in "\n" used to inject a phantom blank line
    // and shift every following line.
    expect(
      applyLineEdits(["1", "2", "3"], [
        { startLine: 2, endLine: 2, text: "B\n" },
      ]),
    ).toEqual(["1", "B", "3"]);

    expect(
      applyLineEdits(["1", "2", "3"], [
        { startLine: 2, endLine: 2, text: "\n" },
      ]),
    ).toEqual(["1", "", "3"]);
  });

  it("reports the net line-count delta of an edit", () => {
    expect(editLineDelta({ startLine: 2, endLine: 2, text: "X\nY" })).toBe(1);
    expect(editLineDelta({ startLine: 2, endLine: 4, text: "" })).toBe(-3);
    expect(editLineDelta({ startLine: 3, endLine: 2, text: "a\nb" })).toBe(2);
    expect(editLineDelta({ startLine: 3, endLine: 2, text: "" })).toBe(0);
  });
});

describe("formatEditPreview", () => {
  const before = splitLines("1\n2\n3\n4\n5\n6\n7\n8\n9\n10");

  it("keeps the after window aligned when earlier edits shift lines", () => {
    const edits = [
      { startLine: 2, endLine: 2, text: "X\nY" },
      { startLine: 8, endLine: 8, text: "B" },
    ];
    const after = applyLineEdits(before, edits);

    // Regression: the "after" window was built from before-file offsets,
    // so it showed the wrong lines once an earlier edit shifted counts.
    const preview = formatEditPreview(before, after, edits[1], 1);
    expect(preview).toContain("   8 | 7");
    expect(preview).toContain("   9 | B");
    expect(preview).toContain("-> now at line 9");
  });

  it("keeps the change visible when earlier edits insert many lines", () => {
    const edits = [
      { startLine: 2, endLine: 1, text: "i1\ni2\ni3\ni4\ni5" },
      { startLine: 8, endLine: 8, text: "B" },
    ];
    const after = applyLineEdits(before, edits);

    // Regression: with a shift >= the context size the edited line was
    // completely outside the "after" window.
    const preview = formatEditPreview(before, after, edits[1], 5);
    expect(preview).toContain("  13 | B");
    expect(preview).toContain("-> now at line 13");
  });
});

describe("renderNumberedWindow", () => {
  it("shows the requested line window with numbers", () => {
    const { text, totalLines, shownFrom, shownTo } = renderNumberedWindow(
      "a\nb\nc\nd",
      2,
      2,
    );
    expect(totalLines).toBe(4);
    expect(shownFrom).toBe(2);
    expect(shownTo).toBe(3);
    expect(text).toBe("   2 | b\n   3 | c");
  });

  it("clamps offset past the end to an empty window", () => {
    const { text, shownFrom, shownTo } = renderNumberedWindow("a\nb", 10, 5);
    expect(shownFrom).toBeGreaterThan(shownTo);
    expect(text).toBe("");
  });
});

describe("find_file pattern handling", () => {
  it("accepts a search location, full search goal, candidate hints, and optional extensions", () => {
    const parsed = findFileInputSchema.safeParse({
      root: "E:/project/src",
      query: "find the line that validates password reset requests",
      patterns: ["password", "reset", "credential", "authenticate"],
      extensions: [".ts", ".tsx"],
    });

    expect(parsed.success).toBe(true);
  });

  it("strips Python-style (?i) inline flags and folds them in", () => {
    const { pattern, flags } = stripInlineFlags("(?i)stocks?|shares?");
    expect(pattern).toBe("stocks?|shares?");
    expect(flags).toContain("i");

    const regex = compilePattern("(?i)stocks?", "gs", "contentPattern");
    expect(regex.test("STOCK MARKET")).toBe(true);
  });

  it("strips inline modifier groups like (?i:stock)", () => {
    const { pattern } = stripInlineFlags("(?i:stock) market");
    expect(pattern).toBe("(?:stock) market");

    const regex = compilePattern("(?i:stock)", "g", "contentPattern");
    expect(regex.test("Stock")).toBe(true);
  });

  it("accepts the exact pattern an agent sent with (?i)", () => {
    // Regression: "Invalid regular expression: /(?i)stocks?|.../: Invalid group"
    const regex = compilePattern(
      "(?i)stocks?|shares?|stock market|equities|سهام|بورس",
      "gs",
      "contentPattern",
    );
    expect(regex.test("بازار بورس تهران")).toBe(true);
    regex.lastIndex = 0; // 'g' flag makes test() stateful
    expect(regex.test("SHARE PRICES")).toBe(true);
  });

  it("gives an actionable error for genuinely invalid regex", () => {
    expect(() => compilePattern("[unclosed", "g", "contentPattern")).toThrow(
      /JavaScript regex|query/,
    );
  });

  it("derives keyword candidates from a natural-language query", () => {
    const pattern = deriveKeywordPattern(
      "Find news articles, headlines, or text about stocks, shares, the stock market, companies' share prices, or stock investing.",
    );

    expect(pattern).toBeTruthy();
    const regex = compilePattern(pattern as string, "gs", "contentPattern");
    expect(regex.test("global stocks rally")).toBe(true);
    regex.lastIndex = 0; // 'g' flag makes test() stateful
    expect(regex.test("a headline about share prices")).toBe(true);
  });

  it("keeps non-ASCII keywords so non-English requests work", () => {
    const pattern = deriveKeywordPattern("اخبار درباره سهام و بورس");
    expect(pattern).toBeTruthy();
    expect((pattern as string).split("|").length).toBeGreaterThanOrEqual(2);
  });

  it("drops stopwords and returns null for empty keyword sets", () => {
    expect(
      deriveKeywordPattern("find the text or files about this thing"),
    ).toBeNull();
  });
});

describe("probabilityOfRelevant", () => {
  it("reads Jev's noul probability", () => {
    expect(probabilityOfRelevant({ noul: 0.8 })).toBe(0.8);
  });

  it("falls back to probabilities map then boolean", () => {
    expect(
      probabilityOfRelevant({ probabilities: { true: 0.4 } }),
    ).toBe(0.4);
    expect(probabilityOfRelevant({ value: true })).toBe(1);
    expect(probabilityOfRelevant(undefined)).toBe(0);
    expect(probabilityOfRelevant({})).toBe(0);
  });

  it("clamps out-of-range values", () => {
    expect(probabilityOfRelevant({ noul: 1.7 })).toBe(1);
    expect(probabilityOfRelevant({ noul: -0.2 })).toBe(0);
  });
});
