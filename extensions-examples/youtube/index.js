import { createExtension } from "@mocu/extension-sdk";
import { getTranscript } from "./lib.js";

// stdout is reserved for the SDK's JSON-RPC protocol.
console.log = (...args) => console.error(...args);
console.info = (...args) => console.error(...args);
console.debug = (...args) => console.error(...args);

const extension = createExtension({
  commands: {
    async get_transcript(input, _context, config) {
      return getTranscript(input, config);
    },
  },
});

extension.start();
