import { describe, expect, it } from "vitest";

import { parseFocusStartGoal } from "./focusCommand";

describe("parseFocusStartGoal", () => {
  it.each([
    ["Focus on creating an extension for Mocu", "creating an extension for Mocu"],
    ["I want to focus on fixing the build", "fixing the build"],
    ["Let's focus on the parser", "the parser"],
    ["Start Focus mode: improve the settings page", "improve the settings page"],
    ["Could we focus on writing tests?", "writing tests?"],
  ])("extracts a goal from %s", (message, goal) => {
    expect(parseFocusStartGoal(message)).toBe(goal);
  });

  it("does not enter Focus for an ordinary focus-related sentence", () => {
    expect(parseFocusStartGoal("I need to focus more at work")).toBeNull();
  });
});
