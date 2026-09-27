import { describe, expect, it } from "vitest";

import { parseSpecialistSlashCommand } from "./specialistSlashCommands";

describe("parseSpecialistSlashCommand", () => {
  it.each([
    ["/focus Fix the parser", { command: "focus", task: "Fix the parser" }],
    ["/STEP Write tests", { command: "step", task: "Write tests" }],
    ["/focus build a parser", { command: "focus", task: "build a parser" }],
    ["/focus: build a parser", { command: "focus", task: "build a parser" }],
    ["/FOCUS - Fix the build", { command: "focus", task: "Fix the build" }],
    ["/focus\nfix tests", { command: "focus", task: "fix tests" }],
    ["/focus، هدف اول", { command: "focus", task: "هدف اول" }],
    ["/focus。修复构建", { command: "focus", task: "修复构建" }],
    ["\u200B/focus\u200F fix RTL", { command: "focus", task: "fix RTL" }],
    ["/focus", { command: "focus", task: "" }],
    ["/focus.", { command: "focus", task: "" }],
    ["/focus .env support", { command: "focus", task: ".env support" }],
    ["/step: plan the release", { command: "step", task: "plan the release" }],
    ["بررسی استفاده ابزار در ایجنت پروژه /focus", { command: "focus", task: "بررسی استفاده ابزار در ایجنت پروژه" }],
    ["بررسی ابزارها /step", { command: "step", task: "بررسی ابزارها" }],
    ["بررسی ابزارها /focus\u200F", { command: "focus", task: "بررسی ابزارها" }],
    ["Review the project agent /focus.", { command: "focus", task: "Review the project agent" }],
  ])("parses %s", (message, expected) => {
    expect(parseSpecialistSlashCommand(message)).toEqual(expected);
  });

  it.each([
    "/focuspoint",
    "/focusful task",
    "/stepper",
    "/step-by-step",
    "Please focus on the parser",
    "ordinary /step text",
    "how does /focus work?",
    "focus on the parser",
  ])("does not parse ordinary text as a command: %s", (message) => {
    expect(parseSpecialistSlashCommand(message)).toBeNull();
  });
});
