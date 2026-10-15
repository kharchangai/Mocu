import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askUserForAnswer,
  dispatchAskUserQuestion,
  getPendingAskUserQuestion,
  resolveAskUserAnswer,
} from "./ask-user-tool";

const originalWindow = globalThis.window;

afterEach(() => {
  vi.useRealTimers();
  if (originalWindow) {
    vi.stubGlobal("window", originalWindow);
  } else {
    vi.unstubAllGlobals();
  }
});

describe("ask_user answer handoff", () => {
  it("resolves a pending tool call with the user's answer", async () => {
    const answerPromise = askUserForAnswer({ toolCallId: "ask-test-1" });

    expect(resolveAskUserAnswer("ask-test-1", "Option A")).toBe(true);
    await expect(answerPromise).resolves.toBe("Option A");
    expect(resolveAskUserAnswer("ask-test-1", "Option B")).toBe(false);
  });

  it("returns false for an unknown tool call", () => {
    expect(resolveAskUserAnswer("missing-ask", "Answer")).toBe(false);
  });

  it("rejects and removes a pending question when the run is aborted", async () => {
    const controller = new AbortController();
    const answerPromise = askUserForAnswer({
      toolCallId: "ask-test-abort",
      signal: controller.signal,
    });

    controller.abort();

    await expect(answerPromise).rejects.toThrow("aborted");
    expect(resolveAskUserAnswer("ask-test-abort", "Too late")).toBe(false);
  });

  it("rejects immediately when the run was already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      askUserForAnswer({
        toolCallId: "ask-test-already-aborted",
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(
      resolveAskUserAnswer("ask-test-already-aborted", "Too late"),
    ).toBe(false);
  });

  it("stores a question before dispatch so a remounted chat can restore it", () => {
    const eventListener = vi.fn();
    vi.stubGlobal("window", new EventTarget());
    window.addEventListener("mocu_ask_user", eventListener);

    dispatchAskUserQuestion("Which option?", ["A", "B"], "ask-restored", "chat-restore");

    expect(eventListener).toHaveBeenCalledOnce();
    expect(getPendingAskUserQuestion("chat-restore")).toEqual({
      question: "Which option?",
      options: ["A", "B"],
      toolCallId: "ask-restored",
      chatId: "chat-restore",
    });
    expect(getPendingAskUserQuestion("another-chat")).toBeNull();
  });

  it("clears the pending question when its answer is resolved", async () => {
    vi.stubGlobal("window", new EventTarget());
    const resolvedListener = vi.fn();
    window.addEventListener("mocu_ask_user_resolved", resolvedListener);
    dispatchAskUserQuestion("Question?", [], "ask-clear", "chat-clear");
    const answerPromise = askUserForAnswer({ toolCallId: "ask-clear" });

    expect(resolveAskUserAnswer("ask-clear", "Done")).toBe(true);
    await expect(answerPromise).resolves.toBe("Done");
    expect(getPendingAskUserQuestion("chat-clear")).toBeNull();
    expect(resolvedListener).toHaveBeenCalledOnce();
  });

  it("removes a timed-out question from pending state", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", new EventTarget());
    dispatchAskUserQuestion("Question?", [], "ask-timeout", "chat-timeout");
    const answerPromise = askUserForAnswer({ toolCallId: "ask-timeout" });
    const assertion = expect(answerPromise).resolves.toBe("Timeout: no answer.");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await assertion;
    expect(getPendingAskUserQuestion("chat-timeout")).toBeNull();
  });
});