import { createExtension } from "@mocu/extension-sdk";
import { semanticSearch } from "./semantic_search.js";

const extension = createExtension({
  commands: {
    search_files: async (input) => ({
      results: await semanticSearch(extension, input),
    }),
  },
});

extension.start();
