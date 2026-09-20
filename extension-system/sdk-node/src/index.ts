export {
  createExtension,
  MocuExtension,
} from "./extension.js";

export { LlmApi } from "./llm.js";
export { DecisionApi } from "./decision.js";
export { EmbeddingApi } from "./embedding.js";

export type {
  ExtensionCommandHandler,
  ExtensionConfig,
  MaybePromise,
  MocuExtensionDefinition,
  PendingRequest,
} from "./types.js";

export type {
  LlmGenerateParams,
  LlmGenerateResult,
  DecisionAskParams,
  DecisionAskResult,
  DecisionQuestion,
  EmbeddingEmbedParams,
  EmbeddingEmbedResult,
  ExtensionExecuteParams,
} from "@mocu/extension-contracts";
