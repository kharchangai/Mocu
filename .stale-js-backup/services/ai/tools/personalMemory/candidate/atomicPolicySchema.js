"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtomicPolicyModelResultSchema = void 0;
var zod_1 = require("zod");
function countWords(value) {
    var normalizedValue = value.trim();
    if (!normalizedValue) {
        return 0;
    }
    return normalizedValue.split(/\s+/).length;
}
var AtomicPolicyItemSchema = zod_1.z
    .string()
    .trim()
    .min(1, {
    error: "atomic policy cannot be empty.",
})
    .superRefine(function (value, context) {
    var wordCount = countWords(value);
    if (wordCount < 2 || wordCount > 8) {
        context.addIssue({
            code: "custom",
            message: "Each atomic policy must contain between 2 and 8 words.",
        });
    }
});
exports.AtomicPolicyModelResultSchema = zod_1.z.object({
    atomic_policies: zod_1.z.array(AtomicPolicyItemSchema),
});
