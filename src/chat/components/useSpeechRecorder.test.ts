import { describe, expect, it } from "vitest";

import { joinVoiceText } from "./useSpeechRecorder";

describe("joinVoiceText", () => {
  it("uses the spoken text alone when the composer is empty", () => {
    expect(joinVoiceText("", "hello world")).toBe("hello world");
  });

  it("keeps the base text when the spoken text is empty", () => {
    expect(joinVoiceText("draft", "   ")).toBe("draft");
    expect(joinVoiceText("draft", "")).toBe("draft");
  });

  it("joins base and spoken text with a single space", () => {
    expect(joinVoiceText("please", "say hello")).toBe("please say hello");
  });

  it("trims trailing whitespace from the base before joining", () => {
    expect(joinVoiceText("please   ", "say hello")).toBe("please say hello");
  });

  it("replaces the previous spoken part when called again with the same base", () => {
    const base = "please";

    const first = joinVoiceText(base, "say hel");
    const refined = joinVoiceText(base, "say hello there");

    expect(first).toBe("please say hel");
    expect(refined).toBe("please say hello there");
  });
});
