import { z } from "zod";

function countWords(value: string): number {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return 0;
  }

  return normalizedValue.split(/\s+/).length;
}

const AtomicPolicyItemSchema = z
  .string()
  .trim()
  .min(1, {
    error: "atomic policy cannot be empty.",
  })
  .superRefine((value, context) => {
    const wordCount = countWords(value);

    if (wordCount < 2 || wordCount > 8) {
      context.addIssue({
        code: "custom",
        message:
          "Each atomic policy must contain between 2 and 8 words.",
      });
    }
  });

export const AtomicPolicyModelResultSchema = z.object({
  atomic_policies: z.array(AtomicPolicyItemSchema),
});

export type AtomicPolicyModelResult = z.infer<
  typeof AtomicPolicyModelResultSchema
>;