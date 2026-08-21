import { performance } from "node:perf_hooks";

import { createExtension } from "@mocu/extension-sdk";

/*
 * A dead-simple Mocu text extension built on the official Node.js SDK.
 *
 * It exposes a single "time" command. Running it returns two things:
 *   - the current date/time (ISO string)
 *   - the response time: how long the command took to run (ms)
 *
 * Built with the Mocu Node.js SDK (@mocu/extension-sdk), which handles
 * the JSON-RPC protocol over stdin/stdout, lifecycle (initialize /
 * activate / deactivate / execute), logging and host calls for us.
 */

const extension = createExtension({
  commands: {
    // Called by Mocu whenever the user runs the "time" command.
    // The input object contains { prompt } (the user's text).
    time(input) {
      const startedAt = performance.now();

      const now = new Date();

      const responseTimeMs = performance.now() - startedAt;

      return [
        `Current time: ${now.toISOString()}`,
        `Response time: ${responseTimeMs.toFixed(2)} ms`,
        `Command input: ${JSON.stringify(input)}`,
      ].join("\n");
    },
  },
});

// Start listening for JSON-RPC messages from the Mocu host.
extension.start();
