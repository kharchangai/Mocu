export {
  createExtension,
  MocuExtension,
} from "./extension.js";

export { LlmApi } from "./llm.js";
export { SummarizeApi } from "./summarize.js";
export { ExtractApi } from "./extract.js";
export { TypedFieldsApi } from "./extract-typed-fields.js";
export { DecisionApi } from "./decision.js";
export { EmbeddingApi } from "./embedding.js";
export { SpeechApi } from "./speech.js";
export { AgentsApi } from "./agents.js";
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
  SummarizeTextParams,
  SummarizeTextResult,
  ExtractEntitiesParams,
  ExtractTypedFieldType,
  ExtractTypedFieldDefinition,
  ExtractTypedFieldsParams,
  ExtractTypedFieldsResult,
  ExtractEntitiesResult,
  ExtractedEntity,
  EmbeddingEmbedParams,
  EmbeddingEmbedResult,
  AgentDescriptor,
  AgentRunParams,
  AgentRunResult,
  ExtensionExecuteParams,
  ExtensionInteractionButton,
  ExtensionInteractionParams,
  SttTranscribeParams,
  SttTranscribeResult,
  TtsSpeakParams,
  TtsSpeakResult,
} from "@mocu/extension-contracts";

export type { ExtensionInteractionOptions } from "./ui.js";
