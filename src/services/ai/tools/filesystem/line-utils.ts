/*
 * Pure line-number helpers shared by the read / write / edit / find file
 * tools (the pi-style filesystem tool set).
 *
 * Line model (used consistently by every tool):
 * - Content is normalized to LF ("\n") line separators.
 * - Line numbers are 1-based and shown to the agent exactly as returned by
 *   read_file / find_file, so edit_file can target the same numbers.
 * - A line array is content.split("\n"), so a file ending with a newline
 *   has a final empty line and joinLines(splitLines(text)) === normalized text.
 */

export function normalizeContent(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function splitLines(content: string): string[] {
  return normalizeContent(content).split("\n");
}

export function joinLines(lines: string[]): string {
  return lines.join("\n");
}

/*
 * Formats lines with right-aligned line numbers:
 *
 *   12 | const answer = 42;
 *
 * startLine is the 1-based number of the first entry of `lines`.
 */
export function formatNumberedLines(
  lines: string[],
  startLine = 1,
): string {
  const lastNumber = startLine + lines.length - 1;
  const width = Math.max(4, String(lastNumber).length);

  return lines
    .map(
      (text, index) =>
        `${String(startLine + index).padStart(width)} | ${text}`,
    )
    .join("\n");
}

export type LineEdit = {
  /**
   * First line of the replaced range (1-based, inclusive).
   * For pure insertion this is the line the text is inserted before.
   */
  startLine: number;
  /**
   * Last line of the replaced range (1-based, inclusive).
   * Defaults to startLine. Use endLine = startLine - 1 for a pure
   * insertion (no line is removed).
   */
  endLine: number;
  /**
   * Replacement text. Empty string deletes the range.
   */
  text: string;
};

/**
 * True when the edit replaces the inclusive range [startLine, endLine].
 */
export function isReplacementRange(edit: LineEdit): boolean {
  return edit.endLine >= edit.startLine;
}

/**
 * Splits replacement text into lines. An empty replacement becomes an
 * empty array so it deletes lines; every other value keeps its newlines
 * verbatim (e.g. "x\n" replaces with one text line plus one empty line).
 */
export function replacementLines(text: string): string[] {
  return text === "" ? [] : splitLines(text);
}

/**
 * Validates one edit against a file with `totalLines` lines.
 * Throws an Error with a clear message when the range is invalid.
 */
export function validateLineEdit(
  edit: LineEdit,
  totalLines: number,
): void {
  const { startLine, endLine } = edit;

  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new Error(
      `startLine must be a 1-based integer, got ${String(startLine)}.`,
    );
  }

  if (!Number.isInteger(endLine)) {
    throw new Error(
      `endLine must be a 1-based integer, got ${String(endLine)}.`,
    );
  }

  if (isReplacementRange(edit)) {
    if (startLine > totalLines) {
      throw new Error(
        `startLine ${startLine} is beyond the end of the file (${totalLines} lines).`,
      );
    }

    if (endLine > totalLines) {
      throw new Error(
        `endLine ${endLine} is beyond the end of the file (${totalLines} lines).`,
      );
    }

    return;
  }

  // Pure insertion: endLine === startLine - 1.
  if (endLine !== startLine - 1) {
    throw new Error(
      `Invalid line range ${startLine}-${endLine}: expected ` +
        `startLine <= endLine (replacement) or endLine = startLine - 1 (insertion).`,
    );
  }

  if (startLine > totalLines + 1) {
    throw new Error(
      `Cannot insert before line ${startLine}: the file has ${totalLines} lines.`,
    );
  }
}

/**
 * Applies a single edit to `lines` and returns a new array.
 * The edit must already be validated with validateLineEdit().
 */
export function applyLineEdit(
  lines: string[],
  edit: LineEdit,
): string[] {
  const inserted = replacementLines(edit.text);

  if (isReplacementRange(edit)) {
    return [
      ...lines.slice(0, edit.startLine - 1),
      ...inserted,
      ...lines.slice(edit.endLine),
    ];
  }

  // Pure insertion before startLine (startLine may be lines.length + 1).
  return [
    ...lines.slice(0, edit.startLine - 1),
    ...inserted,
    ...lines.slice(edit.startLine - 1),
  ];
}

/**
 * Applies several edits to one file in a single pass.
 *
 * Edits are validated against the original line numbering (the same
 * numbers the agent saw in read_file) and must not overlap. They are
 * applied bottom-up so earlier line numbers stay valid.
 */
export function applyLineEdits(
  lines: string[],
  edits: LineEdit[],
): string[] {
  for (const edit of edits) {
    validateLineEdit(edit, lines.length);
  }

  // Overlap check on the original numbering: two edits overlap when
  // their touched line sets intersect. A pure insertion touches no line
  // but must not point inside another edit's replaced range.
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const a = edits[i];
      const b = edits[j];

      const aStart = a.startLine;
      const aEnd = isReplacementRange(a) ? a.endLine : a.startLine - 1;
      const bStart = b.startLine;
      const bEnd = isReplacementRange(b) ? b.endLine : b.startLine - 1;

      const overlap =
        isReplacementRange(a) && isReplacementRange(b)
          ? aStart <= bEnd && bStart <= aEnd
          : isReplacementRange(a)
            ? bStart >= aStart && bStart <= aEnd
            : isReplacementRange(b)
              ? aStart >= bStart && aStart <= bEnd
              : aStart === bStart;

      if (overlap) {
        throw new Error(
          `Overlapping edits: line ranges starting at ${aStart} and ${bStart} overlap.`,
        );
      }
    }
  }

  const sorted = [...edits].sort(
    (a, b) => b.startLine - a.startLine,
  );

  let result = lines;

  for (const edit of sorted) {
    result = applyLineEdit(result, edit);
  }

  return result;
}
