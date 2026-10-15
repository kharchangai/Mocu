import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const askUserTool = tool(
  async ({ question, options }) => ({
    asked: true,
    question: question.trim(),
    options: options ?? [],
    instruction:
      "Wait for the user's answer; the answer is returned as this tool's result.",
  }),
  {
    name: "ask_user",
    description:
      "Ask the user one concise question in English with up to 4 short English options when missing information prevents proceeding. Keep the question and every option in English. Wait for the user's answer, then continue the task using it.",
    schema: z.object({
      question: z.string().trim().min(1).max(2000),
      options: z
        .array(z.string().trim().min(1).max(120))
        .max(4)
        .optional()
        .describe("0 to 4 short option labels the user can click."),
    }),
  },
);

export type PendingAskUserQuestion = {
  question: string;
  options: string[];
  toolCallId: string;
  chatId?: string;
};

const pendingAnswers = new Map<string, (answer: string) => void>();
const pendingQuestions = new Map<string, PendingAskUserQuestion>();

export function askUserForAnswer(
  context?: Record<string, unknown>,
): Promise<string> {
  const id = String(context?.toolCallId ?? `ask-${Date.now()}`);
  const signal = context?.signal as AbortSignal | undefined;

  return new Promise<string>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (answer: string, aborted = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pendingAnswers.delete(id);
      const question = pendingQuestions.get(id);
      pendingQuestions.delete(id);

      if (question && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("mocu_ask_user_resolved", {
            detail: { toolCallId: id, chatId: question.chatId },
          }),
        );
      }

      if (aborted) {
        reject(new Error("aborted"));
      } else {
        resolve(answer);
      }
    };

    const onAbort = () => finish("", true);
    if (signal?.aborted) {
      finish("", true);
      return;
    }

    timer = setTimeout(() => finish("Timeout: no answer."), 5 * 60_000);
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingAnswers.set(id, (answer) => finish(answer));
  });
}

export function getAskUserQuestion(args: unknown): string {
  const a = (args ?? {}) as { question?: unknown };
  return typeof a.question === "string" ? a.question.trim() : "";
}

export const dispatchAskUserQuestion = (
  question: string,
  options: string[],
  toolCallId: string,
  chatId?: string,
): void => {
  if (!toolCallId) return;

  const pendingQuestion: PendingAskUserQuestion = {
    question,
    options,
    toolCallId,
    chatId,
  };
  pendingQuestions.set(toolCallId, pendingQuestion);

  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("mocu_ask_user", { detail: pendingQuestion }),
  );
};

/** Display a clarification in the owning chat and wait for the user's answer. */
export async function askUserForClarification(
  args: unknown,
  context?: Record<string, unknown>,
): Promise<string> {
  const input = (args ?? {}) as { question?: unknown; options?: unknown };
  const question = getAskUserQuestion(input);
  const options = Array.isArray(input.options)
    ? input.options.filter((option): option is string => typeof option === "string").slice(0, 4)
    : [];
  const toolCallId = String(context?.toolCallId ?? "");
  const chatId = typeof context?.chatId === "string" ? context.chatId : undefined;

  dispatchAskUserQuestion(question, options, toolCallId, chatId);
  return askUserForAnswer(context);
}

export function getPendingAskUserQuestion(
  chatId: string | null,
): PendingAskUserQuestion | null {
  const matchingQuestions = Array.from(pendingQuestions.values()).filter(
    (question) => question.chatId === chatId,
  );
  return matchingQuestions.length > 0
    ? matchingQuestions[matchingQuestions.length - 1]
    : null;
}

export function resolveAskUserAnswer(
  toolCallId: string,
  answer: string,
): boolean {
  const resolve = pendingAnswers.get(toolCallId);
  if (!resolve) return false;
  resolve(answer);
  return true;
}
