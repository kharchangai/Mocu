"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSingleMainAgentPolicy = createSingleMainAgentPolicy;
exports.createMainAgentPolicies = createMainAgentPolicies;
var prompts_1 = require("@langchain/core/prompts");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var mainAgentPolicySchema_1 = require("./mainAgentPolicySchema");
var mainAgentPolicyPrompt_1 = require("./mainAgentPolicyPrompt");
var mainAgentPolicyStorage_1 = require("./mainAgentPolicyStorage");
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("Main agent policy generation was aborted.", "AbortError");
    }
}
function normalizeRequiredText(value, fieldName) {
    var normalizedValue = value
        .trim()
        .replace(/\s+/g, " ");
    if (!normalizedValue) {
        throw new Error("".concat(fieldName, " must not be empty."));
    }
    return normalizedValue;
}
function normalizeMultilineText(value, fieldName) {
    var normalizedValue = value.trim();
    if (!normalizedValue) {
        throw new Error("".concat(fieldName, " must not be empty."));
    }
    return normalizedValue;
}
function createAtomicPolicyComparisonKey(atomicPolicy) {
    return normalizeRequiredText(atomicPolicy, "atomic_policy").toLocaleLowerCase();
}
/**
 * Generates a UUID compatible with Tauri frontend environments.
 */
function createPolicyId() {
    if (typeof globalThis.crypto !==
        "undefined" &&
        typeof globalThis.crypto.randomUUID ===
            "function") {
        return globalThis.crypto.randomUUID();
    }
    throw new Error("crypto.randomUUID is not available in this environment.");
}
function validateGeneratedEmbedding(embedding, atomicPolicy) {
    if (!Array.isArray(embedding) ||
        embedding.length === 0) {
        throw new Error("Generated embedding is empty for atomic policy \"".concat(atomicPolicy, "\"."));
    }
    var hasInvalidValue = embedding.some(function (value) {
        return typeof value !== "number" ||
            !Number.isFinite(value);
    });
    if (hasInvalidValue) {
        throw new Error("Generated embedding contains an invalid numeric value for atomic policy \"".concat(atomicPolicy, "\"."));
    }
    return embedding;
}
/**
 * Creates the stable text representation used for policy embedding.
 *
 * The same format should be used in the future when comparing
 * generated policies against stored policy files.
 */
function createMainAgentPolicyEmbeddingText(atomicPolicy, policy) {
    var constraints = policy.constraints.length > 0
        ? policy.constraints
            .map(function (constraint) {
            return "- ".concat(constraint);
        })
            .join("\n")
        : "- None";
    var successCriteria = policy.success_criteria.length > 0
        ? policy.success_criteria
            .map(function (criterion) {
            return "- ".concat(criterion);
        })
            .join("\n")
        : "- None";
    return [
        "Atomic Policy: ".concat(atomicPolicy),
        "Title: ".concat(policy.title),
        "Activation Condition: ".concat(policy.activation_condition),
        "Instruction: ".concat(policy.instruction),
        "Constraints:",
        constraints,
        "Success Criteria:",
        successCriteria,
    ].join("\n");
}
/**
 * Generates the detailed policy content for one atomic policy.
 *
 * ID creation, embedding creation, and file storage are handled
 * separately after the LLM output has been validated.
 */
function createSingleMainAgentPolicy(input) {
    return __awaiter(this, void 0, void 0, function () {
        var userRequest, agentResponse, userFeedback, atomicPolicy, llm, structuredLlm, prompt, chain, response, validationResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(input.signal);
                    userRequest = normalizeMultilineText(input.user_request, "user_request");
                    agentResponse = normalizeMultilineText(input.agent_response, "agent_response");
                    userFeedback = normalizeMultilineText(input.user_feedback, "user_feedback");
                    atomicPolicy = normalizeRequiredText(input.atomic_policy, "atomic_policy");
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    llm = _a.sent();
                    throwIfAborted(input.signal);
                    structuredLlm = llm.withStructuredOutput(mainAgentPolicySchema_1.MainAgentPolicyContentSchema);
                    prompt = prompts_1.ChatPromptTemplate.fromMessages([
                        [
                            "system",
                            mainAgentPolicyPrompt_1.MAIN_AGENT_POLICY_SYSTEM_PROMPT,
                        ],
                        [
                            "human",
                            "{userPrompt}",
                        ],
                    ]);
                    chain = prompt.pipe(structuredLlm);
                    return [4 /*yield*/, chain.invoke({
                            userPrompt: (0, mainAgentPolicyPrompt_1.buildMainAgentPolicyUserPrompt)({
                                user_request: userRequest,
                                agent_response: agentResponse,
                                user_feedback: userFeedback,
                                atomic_policy: atomicPolicy,
                            }),
                        }, {
                            signal: input.signal,
                        })];
                case 2:
                    response = _a.sent();
                    throwIfAborted(input.signal);
                    validationResult = mainAgentPolicySchema_1.MainAgentPolicyContentSchema.safeParse(response);
                    if (!validationResult.success) {
                        throw new Error("Main agent policy output validation failed for atomic policy \"".concat(atomicPolicy, "\": ").concat(validationResult.error.message));
                    }
                    return [2 /*return*/, validationResult.data];
            }
        });
    });
}
/**
 * Creates a detailed policy, generates its embedding with
 * textSimilarity, and saves it as a JSON file.
 */
function createAndSaveMainAgentPolicy(input) {
    return __awaiter(this, void 0, void 0, function () {
        var atomicPolicy, generatedPolicy, embeddingText, generatedEmbedding, embedding, policyId, timestamp, storedPolicy, policyValidationResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(input.signal);
                    atomicPolicy = normalizeRequiredText(input.atomic_policy, "atomic_policy");
                    return [4 /*yield*/, createSingleMainAgentPolicy({
                            user_request: input.user_request,
                            agent_response: input.agent_response,
                            user_feedback: input.user_feedback,
                            atomic_policy: atomicPolicy,
                            signal: input.signal,
                        })];
                case 1:
                    generatedPolicy = _a.sent();
                    throwIfAborted(input.signal);
                    embeddingText = createMainAgentPolicyEmbeddingText(atomicPolicy, generatedPolicy);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(embeddingText)];
                case 2:
                    generatedEmbedding = _a.sent();
                    throwIfAborted(input.signal);
                    embedding = validateGeneratedEmbedding(generatedEmbedding, atomicPolicy);
                    policyId = createPolicyId();
                    timestamp = new Date().toISOString();
                    storedPolicy = {
                        id: policyId,
                        atomic_policy: atomicPolicy,
                        policy: generatedPolicy,
                        embedding: embedding,
                        created_at: timestamp,
                        updated_at: timestamp,
                    };
                    policyValidationResult = mainAgentPolicySchema_1.StoredMainAgentPolicySchema.safeParse(storedPolicy);
                    if (!policyValidationResult.success) {
                        throw new Error("Stored main agent policy validation failed for atomic policy \"".concat(atomicPolicy, "\": ").concat(policyValidationResult.error.message));
                    }
                    throwIfAborted(input.signal);
                    return [4 /*yield*/, (0, mainAgentPolicyStorage_1.saveMainAgentPolicyFile)(policyValidationResult.data, input.signal)];
                case 3:
                    _a.sent();
                    throwIfAborted(input.signal);
                    return [2 /*return*/, {
                            atomic_policy: atomicPolicy,
                            policy_id: policyId,
                        }];
            }
        });
    });
}
/**
 * Registers all existing policy IDs before creating new policies.
 *
 * This allows a missing duplicate to reuse an existing policy ID
 * even if the existing entry appears later in the input array.
 */
function collectExistingPolicyIds(atomicPolicies) {
    var resolvedPolicyIds = new Map();
    for (var index = 0; index < atomicPolicies.length; index += 1) {
        var atomicPolicyMatch = atomicPolicies[index];
        var atomicPolicy = normalizeRequiredText(atomicPolicyMatch.policy, "atomic_policies[".concat(index, "].policy"));
        if (atomicPolicyMatch.policy_id ===
            false) {
            continue;
        }
        var policyId = normalizeRequiredText(atomicPolicyMatch.policy_id, "atomic_policies[".concat(index, "].policy_id"));
        var comparisonKey = createAtomicPolicyComparisonKey(atomicPolicy);
        var existingId = resolvedPolicyIds.get(comparisonKey);
        if (existingId &&
            existingId !== policyId) {
            throw new Error("Atomic policy \"".concat(atomicPolicy, "\" has conflicting policy IDs: \"").concat(existingId, "\" and \"").concat(policyId, "\"."));
        }
        resolvedPolicyIds.set(comparisonKey, policyId);
    }
    return resolvedPolicyIds;
}
/**
 * Creates a policy only for atomic policies that do not already
 * have a resolved policy ID.
 *
 * Existing policy IDs are preserved.
 * Duplicate atomic policies share one policy file and one ID.
 *
 * The returned object contains only atomic policy references so
 * it can be stored directly inside the condition file.
 */
function createMainAgentPolicies(input) {
    return __awaiter(this, void 0, void 0, function () {
        var userRequest, agentResponse, userFeedback, resolvedPolicyIds, index, atomicPolicyMatch, atomicPolicy, comparisonKey, createdReference, atomicPolicyReferences, result, validationResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(input.signal);
                    userRequest = normalizeMultilineText(input.user_request, "user_request");
                    agentResponse = normalizeMultilineText(input.agent_response, "agent_response");
                    userFeedback = normalizeMultilineText(input.user_feedback, "user_feedback");
                    if (!Array.isArray(input.atomic_policies)) {
                        throw new Error("atomic_policies must be an array.");
                    }
                    if (input.atomic_policies.length === 0) {
                        return [2 /*return*/, {
                                atomic_policies: [],
                            }];
                    }
                    resolvedPolicyIds = collectExistingPolicyIds(input.atomic_policies);
                    index = 0;
                    _a.label = 1;
                case 1:
                    if (!(index <
                        input.atomic_policies.length)) return [3 /*break*/, 4];
                    throwIfAborted(input.signal);
                    atomicPolicyMatch = input.atomic_policies[index];
                    atomicPolicy = normalizeRequiredText(atomicPolicyMatch.policy, "atomic_policies[".concat(index, "].policy"));
                    comparisonKey = createAtomicPolicyComparisonKey(atomicPolicy);
                    if (resolvedPolicyIds.has(comparisonKey)) {
                        return [3 /*break*/, 3];
                    }
                    return [4 /*yield*/, createAndSaveMainAgentPolicy({
                            user_request: userRequest,
                            agent_response: agentResponse,
                            user_feedback: userFeedback,
                            atomic_policy: atomicPolicy,
                            signal: input.signal,
                        })];
                case 2:
                    createdReference = _a.sent();
                    resolvedPolicyIds.set(comparisonKey, createdReference.policy_id);
                    _a.label = 3;
                case 3:
                    index += 1;
                    return [3 /*break*/, 1];
                case 4:
                    throwIfAborted(input.signal);
                    atomicPolicyReferences = input.atomic_policies.map(function (atomicPolicyMatch, index) {
                        var atomicPolicy = normalizeRequiredText(atomicPolicyMatch.policy, "atomic_policies[".concat(index, "].policy"));
                        var comparisonKey = createAtomicPolicyComparisonKey(atomicPolicy);
                        var policyId = resolvedPolicyIds.get(comparisonKey);
                        if (!policyId) {
                            throw new Error("No policy ID was resolved for atomic policy \"".concat(atomicPolicy, "\"."));
                        }
                        return {
                            atomic_policy: atomicPolicy,
                            policy_id: policyId,
                        };
                    });
                    result = {
                        atomic_policies: atomicPolicyReferences,
                    };
                    validationResult = mainAgentPolicySchema_1.CreateMainAgentPoliciesResultSchema.safeParse(result);
                    if (!validationResult.success) {
                        throw new Error("Main agent policy references validation failed: ".concat(validationResult.error.message));
                    }
                    return [2 /*return*/, validationResult.data];
            }
        });
    });
}
