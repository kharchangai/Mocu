"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateMainAgentPoliciesResultSchema = exports.AtomicPolicyReferenceSchema = exports.StoredMainAgentPolicySchema = exports.MainAgentPolicyContentSchema = exports.AtomicPolicyMatchSchema = void 0;
var zod_1 = require("zod");
var RequiredTextSchema = zod_1.z
    .string()
    .trim()
    .min(1, "Value must not be empty.");
exports.AtomicPolicyMatchSchema = zod_1.z.object({
    policy: RequiredTextSchema,
    policy_id: zod_1.z.union([
        RequiredTextSchema,
        zod_1.z.literal(false),
    ]),
});
exports.MainAgentPolicyContentSchema = zod_1.z.object({
    title: RequiredTextSchema,
    activation_condition: RequiredTextSchema,
    instruction: RequiredTextSchema,
    constraints: zod_1.z.array(RequiredTextSchema),
    success_criteria: zod_1.z.array(RequiredTextSchema),
});
exports.StoredMainAgentPolicySchema = zod_1.z.object({
    id: RequiredTextSchema,
    atomic_policy: RequiredTextSchema,
    policy: exports.MainAgentPolicyContentSchema,
    embedding: zod_1.z
        .array(zod_1.z.number().finite())
        .min(1, "Policy embedding must not be empty."),
    created_at: RequiredTextSchema,
    updated_at: RequiredTextSchema,
});
exports.AtomicPolicyReferenceSchema = zod_1.z.object({
    atomic_policy: RequiredTextSchema,
    policy_id: RequiredTextSchema,
});
exports.CreateMainAgentPoliciesResultSchema = zod_1.z.object({
    atomic_policies: zod_1.z.array(exports.AtomicPolicyReferenceSchema),
});
