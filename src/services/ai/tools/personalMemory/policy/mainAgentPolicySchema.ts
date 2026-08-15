import { z } from "zod";

const RequiredTextSchema = z
  .string()
  .trim()
  .min(1, "Value must not be empty.");

export const AtomicPolicyMatchSchema = z.object({
  policy: RequiredTextSchema,
  policy_id: z.union([
    RequiredTextSchema,
    z.literal(false),
  ]),
});

export const MainAgentPolicyContentSchema = z.object({
  title: RequiredTextSchema,

  activation_condition:
    RequiredTextSchema,

  instruction:
    RequiredTextSchema,

  constraints: z.array(
    RequiredTextSchema,
  ),

  success_criteria: z.array(
    RequiredTextSchema,
  ),
});

export const StoredMainAgentPolicySchema = z.object({
  id: RequiredTextSchema,

  atomic_policy:
    RequiredTextSchema,

  policy: MainAgentPolicyContentSchema,

  embedding: z
    .array(
      z.number().finite(),
    )
    .min(
      1,
      "Policy embedding must not be empty.",
    ),

  created_at:
    RequiredTextSchema,

  updated_at:
    RequiredTextSchema,
});

export const AtomicPolicyReferenceSchema = z.object({
  atomic_policy:
    RequiredTextSchema,

  policy_id:
    RequiredTextSchema,
});

export const CreateMainAgentPoliciesResultSchema =
  z.object({
    atomic_policies: z.array(
      AtomicPolicyReferenceSchema,
    ),
  });

export type AtomicPolicyMatch = z.infer<
  typeof AtomicPolicyMatchSchema
>;

export type MainAgentPolicyContent = z.infer<
  typeof MainAgentPolicyContentSchema
>;

export type StoredMainAgentPolicy = z.infer<
  typeof StoredMainAgentPolicySchema
>;

export type AtomicPolicyReference = z.infer<
  typeof AtomicPolicyReferenceSchema
>;

export type CreateMainAgentPoliciesResult = z.infer<
  typeof CreateMainAgentPoliciesResultSchema
>;