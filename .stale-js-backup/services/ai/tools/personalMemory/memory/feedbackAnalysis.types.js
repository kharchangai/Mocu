"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackMemoryDecisionSchema = exports.FeedbackMemorySchema = exports.FeedbackAnalysisModelResultSchema = exports.FeedbackMemoryConditionEmbeddingMetadataSchema = exports.FeedbackMemoryEmbeddingMetadataSchema = exports.FeedbackMemorySourceInteractionSchema = exports.EmbeddingVectorSchema = exports.NonEmptyTrimmedStringSchema = exports.UuidSchema = exports.IsoDateTimeSchema = exports.MemoryStateSchema = exports.MemoryScopeSchema = void 0;
var zod_1 = require("zod");
var MAX_SHORT_LABEL_WORDS = 2;
var MEMORY_SCOPE_VALUES = [
    "single_request",
    "topic",
    "task_type",
    "domain",
    "global",
];
var MEMORY_STATE_VALUES = [
    "active",
    "suspended",
    "superseded",
];
var EMBEDDING_FIELD_PRIORITY_VALUES = [
    "scope_description",
    "problem_category",
    "task_type",
    "scope",
];
var CONDITION_EMBEDDING_FIELD_PRIORITY_VALUES = [
    "scope_description",
    "problem_category",
    "task_type",
];
var MEMORY_DECISION_VALUES = [
    "APPEND_RECALL",
    "SUSPEND_AND_CREATE",
    "CREATE_NEW",
];
function hasAtMostTwoWords(value) {
    var words = value.trim().split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= MAX_SHORT_LABEL_WORDS;
}
function hasExactlyValuesInOrder(values, expected) {
    return (values.length === expected.length &&
        values.every(function (value, index) { return value === expected[index]; }));
}
exports.MemoryScopeSchema = zod_1.z.enum(MEMORY_SCOPE_VALUES);
exports.MemoryStateSchema = zod_1.z.enum(MEMORY_STATE_VALUES);
/**
 * Requires Zod v4.
 * z.iso.datetime() validates ISO 8601 datetime strings.
 */
exports.IsoDateTimeSchema = zod_1.z.iso.datetime({
    error: "Value must be a valid ISO 8601 datetime string.",
});
exports.UuidSchema = zod_1.z.uuid({
    error: "Value must be a valid UUID.",
});
exports.NonEmptyTrimmedStringSchema = zod_1.z
    .string()
    .trim()
    .min(1, {
    error: "Value cannot be empty.",
});
exports.EmbeddingVectorSchema = zod_1.z
    .array(zod_1.z.number().finite())
    .min(1, {
    error: "Embedding must contain at least one finite numeric value.",
});
exports.FeedbackMemorySourceInteractionSchema = zod_1.z.object({
    user_request: exports.NonEmptyTrimmedStringSchema,
    agent_response: exports.NonEmptyTrimmedStringSchema,
    user_feedback: exports.NonEmptyTrimmedStringSchema,
});
/**
 * Metadata for the main memory embedding.
 *
 * This embedding is used for:
 * - Memory similarity
 * - Duplicate detection
 * - Relationship analysis
 * - Memory-management operations
 */
exports.FeedbackMemoryEmbeddingMetadataSchema = zod_1.z
    .object({
    strategy: zod_1.z.literal("weighted_text_repetition"),
    field_priority: zod_1.z
        .array(zod_1.z.enum(EMBEDDING_FIELD_PRIORITY_VALUES))
        .length(EMBEDDING_FIELD_PRIORITY_VALUES.length, {
        error: "field_priority must contain exactly four fields.",
    }),
    repetitions: zod_1.z.object({
        scope_description: zod_1.z.number().int().positive(),
        problem_category: zod_1.z.number().int().positive(),
        task_type: zod_1.z.number().int().positive(),
        scope: zod_1.z.number().int().positive(),
    }),
    generated_at: exports.IsoDateTimeSchema,
})
    .superRefine(function (value, context) {
    if (!hasExactlyValuesInOrder(value.field_priority, EMBEDDING_FIELD_PRIORITY_VALUES)) {
        context.addIssue({
            code: "custom",
            message: "field_priority must contain the expected fields in the required order: " +
                "scope_description, problem_category, task_type, scope.",
            path: ["field_priority"],
        });
    }
});
/**
 * Metadata for the condition embedding.
 *
 * This embedding is only used to retrieve active memories that should
 * be injected for a new request under a similar activation condition.
 */
exports.FeedbackMemoryConditionEmbeddingMetadataSchema = zod_1.z
    .object({
    strategy: zod_1.z.literal("weighted_text_repetition"),
    field_priority: zod_1.z
        .array(zod_1.z.enum(CONDITION_EMBEDDING_FIELD_PRIORITY_VALUES))
        .length(CONDITION_EMBEDDING_FIELD_PRIORITY_VALUES.length, {
        error: "field_priority must contain exactly three fields.",
    }),
    repetitions: zod_1.z.object({
        scope_description: zod_1.z.number().int().positive(),
        problem_category: zod_1.z.number().int().positive(),
        task_type: zod_1.z.number().int().positive(),
    }),
    generated_at: exports.IsoDateTimeSchema,
})
    .superRefine(function (value, context) {
    if (!hasExactlyValuesInOrder(value.field_priority, CONDITION_EMBEDDING_FIELD_PRIORITY_VALUES)) {
        context.addIssue({
            code: "custom",
            message: "field_priority must contain the expected fields in the required order: " +
                "scope_description, problem_category, task_type.",
            path: ["field_priority"],
        });
    }
});
exports.FeedbackAnalysisModelResultSchema = zod_1.z.object({
    problem_summary: exports.NonEmptyTrimmedStringSchema,
    problem_category: exports.NonEmptyTrimmedStringSchema.refine(hasAtMostTwoWords, {
        error: "problem_category must contain one or two words.",
    }),
    task_type: exports.NonEmptyTrimmedStringSchema.refine(hasAtMostTwoWords, {
        error: "task_type must contain one or two words.",
    }),
    scope: exports.MemoryScopeSchema,
    scope_description: exports.NonEmptyTrimmedStringSchema,
    confidence: zod_1.z.number().finite().min(0).max(1),
});
/**
 * Persistent feedback memory.
 *
 * `condition_id` is nullable only for backward compatibility with
 * memory files created before feedback conditions were introduced.
 *
 * Every newly created memory should always receive a non-null condition_id.
 */
exports.FeedbackMemorySchema = exports.FeedbackAnalysisModelResultSchema.extend({
    id: exports.UuidSchema,
    /**
     * The ID of the feedback condition that activates this memory.
     *
     * This must be explicitly declared because Zod strips unknown keys
     * by default. Without this field, condition_id would be removed by
     * FeedbackMemorySchema.parse(...) before the memory is saved.
     */
    condition_id: exports.UuidSchema.nullable().default(null),
    state: exports.MemoryStateSchema,
    created_at: exports.IsoDateTimeSchema,
    activated_at: exports.IsoDateTimeSchema.nullable(),
    /**
     * These fields must be null while the memory is active.
     * They receive real values only after suspension or supersession.
     */
    suspended_at: exports.IsoDateTimeSchema.nullable(),
    suspension_reason: exports.NonEmptyTrimmedStringSchema.nullable(),
    replaced_by_memory_id: exports.UuidSchema.nullable(),
    /**
     * The number of times this memory has been recalled.
     */
    recall_count: zod_1.z.number().int().nonnegative().default(0),
    /**
     * The primary embedding used for memory-to-memory comparison.
     */
    combined_embedding: exports.EmbeddingVectorSchema,
    embedding_text: exports.NonEmptyTrimmedStringSchema,
    embedding_metadata: exports.FeedbackMemoryEmbeddingMetadataSchema,
    /**
     * The dedicated embedding used for condition-based memory retrieval.
     *
     * Its source text is built from:
     * - scope_description
     * - problem_category
     * - task_type
     */
    condition_embedding: exports.EmbeddingVectorSchema,
    condition_embedding_text: exports.NonEmptyTrimmedStringSchema,
    condition_embedding_metadata: exports.FeedbackMemoryConditionEmbeddingMetadataSchema,
    source_interaction: exports.FeedbackMemorySourceInteractionSchema,
}).superRefine(function (memory, context) {
    var isActive = memory.state === "active";
    var isSuspended = memory.state === "suspended";
    var isSuperseded = memory.state === "superseded";
    if (isActive && memory.activated_at === null) {
        context.addIssue({
            code: "custom",
            message: "Active memories must have activated_at.",
            path: ["activated_at"],
        });
    }
    if (isActive &&
        (memory.suspended_at !== null ||
            memory.suspension_reason !== null ||
            memory.replaced_by_memory_id !== null)) {
        context.addIssue({
            code: "custom",
            message: "Active memories must have null suspended_at, suspension_reason, and replaced_by_memory_id.",
            path: ["state"],
        });
    }
    if (isSuspended && memory.suspended_at === null) {
        context.addIssue({
            code: "custom",
            message: "Suspended memories must have suspended_at.",
            path: ["suspended_at"],
        });
    }
    if (isSuspended &&
        memory.suspension_reason === null) {
        context.addIssue({
            code: "custom",
            message: "Suspended memories must have suspension_reason.",
            path: ["suspension_reason"],
        });
    }
    if (isSuspended &&
        memory.replaced_by_memory_id !== null) {
        context.addIssue({
            code: "custom",
            message: "Suspended memories must not have replaced_by_memory_id. Use superseded state instead.",
            path: ["replaced_by_memory_id"],
        });
    }
    if (isSuperseded &&
        memory.suspended_at === null) {
        context.addIssue({
            code: "custom",
            message: "Superseded memories must have suspended_at.",
            path: ["suspended_at"],
        });
    }
    if (isSuperseded &&
        memory.suspension_reason === null) {
        context.addIssue({
            code: "custom",
            message: "Superseded memories must have suspension_reason.",
            path: ["suspension_reason"],
        });
    }
    if (isSuperseded &&
        memory.replaced_by_memory_id === null) {
        context.addIssue({
            code: "custom",
            message: "Superseded memories must have replaced_by_memory_id.",
            path: ["replaced_by_memory_id"],
        });
    }
});
exports.FeedbackMemoryDecisionSchema = zod_1.z
    .object({
    decision: zod_1.z.enum(MEMORY_DECISION_VALUES),
    target_memory_id: exports.UuidSchema.nullable(),
    reasoning: exports.NonEmptyTrimmedStringSchema,
    recall_summary: exports.NonEmptyTrimmedStringSchema.nullable(),
})
    .superRefine(function (value, context) {
    switch (value.decision) {
        case "APPEND_RECALL": {
            if (value.target_memory_id === null) {
                context.addIssue({
                    code: "custom",
                    message: "APPEND_RECALL requires target_memory_id.",
                    path: ["target_memory_id"],
                });
            }
            if (value.recall_summary === null) {
                context.addIssue({
                    code: "custom",
                    message: "APPEND_RECALL requires recall_summary.",
                    path: ["recall_summary"],
                });
            }
            break;
        }
        case "SUSPEND_AND_CREATE": {
            if (value.target_memory_id === null) {
                context.addIssue({
                    code: "custom",
                    message: "SUSPEND_AND_CREATE requires target_memory_id.",
                    path: ["target_memory_id"],
                });
            }
            if (value.recall_summary !== null) {
                context.addIssue({
                    code: "custom",
                    message: "SUSPEND_AND_CREATE must not have recall_summary.",
                    path: ["recall_summary"],
                });
            }
            break;
        }
        case "CREATE_NEW": {
            if (value.target_memory_id !== null) {
                context.addIssue({
                    code: "custom",
                    message: "CREATE_NEW must not have target_memory_id.",
                    path: ["target_memory_id"],
                });
            }
            if (value.recall_summary !== null) {
                context.addIssue({
                    code: "custom",
                    message: "CREATE_NEW must not have recall_summary.",
                    path: ["recall_summary"],
                });
            }
            break;
        }
    }
});
