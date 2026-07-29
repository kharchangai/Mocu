import { z } from "zod";

const MAX_SHORT_LABEL_WORDS = 2;

const MEMORY_SCOPE_VALUES = [
  "single_request",
  "topic",
  "task_type",
  "domain",
  "global",
] as const;

const MEMORY_STATE_VALUES = [
  "active",
  "suspended",
  "superseded",
] as const;

const EMBEDDING_FIELD_PRIORITY_VALUES = [
  "scope_description",
  "problem_category",
  "task_type",
  "scope",
] as const;

const MEMORY_DECISION_VALUES = [
  "APPEND_RECALL",
  "SUSPEND_AND_CREATE",
  "CREATE_NEW",
] as const;

function hasAtMostTwoWords(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);

  return words.length >= 1 && words.length <= MAX_SHORT_LABEL_WORDS;
}

export const MemoryScopeSchema = z.enum(MEMORY_SCOPE_VALUES);

export const MemoryStateSchema = z.enum(MEMORY_STATE_VALUES);

/*
 * z.string().datetime() is deprecated in Zod v4.
 * Use z.iso.datetime() for ISO 8601 datetime validation.
 */
export const IsoDateTimeSchema = z.iso.datetime({
  error: "Value must be a valid ISO 8601 datetime string.",
});

export const UuidSchema = z.uuid({
  error: "Value must be a valid UUID.",
});

export const NonEmptyTrimmedStringSchema = z
  .string()
  .trim()
  .min(1, {
    error: "Value cannot be empty.",
  });

export const FeedbackMemorySourceInteractionSchema = z.object({
  user_request: NonEmptyTrimmedStringSchema,

  agent_response: NonEmptyTrimmedStringSchema,

  user_feedback: NonEmptyTrimmedStringSchema,
});

export const FeedbackMemoryRecallSchema = z.object({
  id: UuidSchema,

  created_at: IsoDateTimeSchema,

  summary: NonEmptyTrimmedStringSchema,

  source_interaction: FeedbackMemorySourceInteractionSchema,
});

export const FeedbackMemoryEmbeddingMetadataSchema = z.object({
  strategy: z.literal("weighted_text_repetition"),

  field_priority: z
    .array(z.enum(EMBEDDING_FIELD_PRIORITY_VALUES))
    .length(4, {
      error: "field_priority must contain exactly four fields.",
    }),

  repetitions: z.object({
    scope_description: z.number().int().positive(),
    problem_category: z.number().int().positive(),
    task_type: z.number().int().positive(),
    scope: z.number().int().positive(),
  }),

  generated_at: IsoDateTimeSchema,
});

export const FeedbackAnalysisModelResultSchema = z.object({
  problem_summary: NonEmptyTrimmedStringSchema,

  problem_category: NonEmptyTrimmedStringSchema.refine(hasAtMostTwoWords, {
    error: "problem_category must contain one or two words.",
  }),

  task_type: NonEmptyTrimmedStringSchema.refine(hasAtMostTwoWords, {
    error: "task_type must contain one or two words.",
  }),

  scope: MemoryScopeSchema,

  scope_description: NonEmptyTrimmedStringSchema,

  confidence: z.number().min(0).max(1),
});

export const FeedbackMemorySchema = FeedbackAnalysisModelResultSchema.extend({
  id: UuidSchema,

  state: MemoryStateSchema,

  created_at: IsoDateTimeSchema,

  activated_at: IsoDateTimeSchema.nullable(),

  /*
   * These fields must be null for an active memory.
   * They receive real values only when the memory is suspended or superseded.
   */
  suspended_at: IsoDateTimeSchema.nullable(),

  suspension_reason: NonEmptyTrimmedStringSchema.nullable(),

  replaced_by_memory_id: UuidSchema.nullable(),

  recalls: z.array(FeedbackMemoryRecallSchema).default([]),

  recall_count: z.number().int().nonnegative().default(0),

  combined_embedding: z.array(z.number().finite()).min(1, {
    error: "combined_embedding must contain at least one value.",
  }),

  embedding_text: NonEmptyTrimmedStringSchema,

  embedding_metadata: FeedbackMemoryEmbeddingMetadataSchema,

  source_interaction: FeedbackMemorySourceInteractionSchema,
});

export const FeedbackMemoryDecisionSchema = z
  .object({
    decision: z.enum(MEMORY_DECISION_VALUES),

    target_memory_id: UuidSchema.nullable(),

    reasoning: NonEmptyTrimmedStringSchema,

    recall_summary: NonEmptyTrimmedStringSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (
      value.decision === "APPEND_RECALL" &&
      value.target_memory_id === null
    ) {
      context.addIssue({
        code: "custom",
        message: "APPEND_RECALL requires target_memory_id.",
        path: ["target_memory_id"],
      });
    }

    if (
      value.decision === "APPEND_RECALL" &&
      value.recall_summary === null
    ) {
      context.addIssue({
        code: "custom",
        message: "APPEND_RECALL requires recall_summary.",
        path: ["recall_summary"],
      });
    }

    if (
      value.decision === "SUSPEND_AND_CREATE" &&
      value.target_memory_id === null
    ) {
      context.addIssue({
        code: "custom",
        message: "SUSPEND_AND_CREATE requires target_memory_id.",
        path: ["target_memory_id"],
      });
    }

    if (
      value.decision === "SUSPEND_AND_CREATE" &&
      value.recall_summary !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "SUSPEND_AND_CREATE must not have recall_summary.",
        path: ["recall_summary"],
      });
    }

    if (
      value.decision === "CREATE_NEW" &&
      value.target_memory_id !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "CREATE_NEW must not have target_memory_id.",
        path: ["target_memory_id"],
      });
    }

    if (
      value.decision === "CREATE_NEW" &&
      value.recall_summary !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "CREATE_NEW must not have recall_summary.",
        path: ["recall_summary"],
      });
    }
  });

export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export type MemoryState = z.infer<typeof MemoryStateSchema>;

export type FeedbackMemoryRecall = z.infer<
  typeof FeedbackMemoryRecallSchema
>;

export type FeedbackMemory = z.infer<typeof FeedbackMemorySchema>;

export type FeedbackMemoryDecision = z.infer<
  typeof FeedbackMemoryDecisionSchema
>;

export type SimilarFeedbackMemoryMatchForPrompt = {
  file_name: string;
  similarity_score: number;
  memory: FeedbackMemory;
};

export interface FeedbackAnalysisInput {
  user_request: string;
  agent_response: string;
  user_feedback: string;
}