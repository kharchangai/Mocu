import { createExtension } from "@mocu/extension-sdk";

/*
 * A minimal educational Mocu extension built on the official Node.js SDK.
 *
 * It exposes a single "time" command that returns the current system
 * date/time, taken directly with JavaScript (new Date()).
 *
 * The SDK handles the JSON-RPC protocol over stdin/stdout for us:
 * Mocu writes { method, id, params } to this process's stdin, the SDK
 * dispatches it to the matching command handler below, and the return
 * value is written back as { id, result: { success, output } }.
 */

const extension = createExtension({
  commands: {
    // Called by Mocu whenever the agent invokes the "time" command.
    time() {
      const now = new Date();

      return [
        "CURRENT SYSTEM TIME",
        "===================",
        `Local time: ${now.toLocaleString()}`,
        `ISO time:   ${now.toISOString()}`,
        `Unix (ms):  ${now.getTime()}`,
      ].join("\n");
    },
  },
});

// Start listening for JSON-RPC messages from the Mocu host.
extension.start();
