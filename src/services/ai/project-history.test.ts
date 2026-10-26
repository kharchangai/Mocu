import { describe, expect, it } from "vitest";
import { compileMocuIgnore, isMocuIgnored } from "./project-history";

describe("project history ignore rules", () => {
  it("ignores gitignore-like globs, folders and negated rules", () => {
    const rules = compileMocuIgnore("node_modules/\n*.log\n!keep.log\nsrc/generated/**");
    expect(isMocuIgnored("node_modules/pkg/index.js", false, rules)).toBe(true);
    expect(isMocuIgnored("debug.log", false, rules)).toBe(true);
    expect(isMocuIgnored("keep.log", false, rules)).toBe(false);
    expect(isMocuIgnored("src/generated/file.ts", false, rules)).toBe(true);
  });

  it("always excludes internal metadata", () => {
    expect(isMocuIgnored(".mocu/history/index.json", false, [])).toBe(true);
    expect(isMocuIgnored(".git/config", false, [])).toBe(true);
  });
});
