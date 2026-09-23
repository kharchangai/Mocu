export {
  createExtension,
  MocuExtension,
} from "./extension.js";

export { LlmApi } from "./llm.js";
export { DecisionApi } from "./decision.js";
export { EmbeddingApi } from "./embedding.js";
export { ExtensionUiApi } from "./ui.js";

export type {
  ExtensionCommandHandler,
  ExtensionCommandContext,
  ExtensionExecuteHandlerParams,
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
  ExtensionInteractionButton,
  ExtensionInteractionParams,
  ExtensionInteractionResult,
} from "@mocu/extension-contracts";

export type { ExtensionInteractionOptions } from "./ui.js";
