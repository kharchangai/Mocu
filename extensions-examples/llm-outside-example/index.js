import { createExtension } from "@mocu/extension-sdk";

/*
 * PROOF-OF-CONCEPT
 *
 * The whole point of this example: `extension.llm.generate()` does NOT have
 * to be called inside the `commands` object. It is used here inside a normal
 * standalone helper function (`askLlm`).
 *
 * Why it works: `extension.llm` is just a property of the extension object.
 * As long as we are in an async function AFTER `extension.start()`, the
 * protocol client is reading stdin and will receive the LLM's reply.
 */

// A plain standalone helper function — NOT a command handler.
// It is the one that talks to the LLM.
async function askLlm(extension, question) {
  // 1) call the host LLM from inside this helper
  const result = await extension.llm.generate({
    prompt: question,
    systemPrompt:
      "You are a helpful assistant. Keep the answer to one short sentence.",
    maxTokens: 120,
  });

  // 2) do something extra with the LLM's text
  const answer = result.text.trim();
  const wordCount = answer.split(/\s+/).filter(Boolean).length;

  // 3) return our own structured result
  return {
    reply: answer,
    wordCount,
    shouted: answer.toUpperCase(),
  };
}

// ---------- the extension itself ----------
const extension = createExtension({
  commands: {
    async ask(input) {
      const question = input?.question ?? "What is 2 + 2?";
      // call the outside helper, passing `extension` so it can use llm
      return await askLlm(extension, question);
    },
  },
});

// Start listening for commands from Mocu.
extension.start();