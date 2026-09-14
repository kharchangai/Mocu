import { createExtension } from "@mocu/extension-sdk";

/*
 * A minimal test extension: it uses the Mocu LLM to respond to "hi".
 *
 * The "hi" command asks the host LLM to reply to "hi" and returns the
 * generated text. Run it from a chat message using /extension hi-llm-node
 * (or any command that invokes the "hi" command).
 */

const extension = createExtension({
  commands: {
    async hi() {
      // Ask the Mocu host LLM to respond to "hi".
      const result = await extension.llm.generate({
        prompt: "hi",
        systemPrompt: "You are a friendly, concise assistant. Reply briefly.",
      });

      return result.text;
    },
  },
});

// Start listening for JSON-RPC messages from the Mocu host.
extension.start();
