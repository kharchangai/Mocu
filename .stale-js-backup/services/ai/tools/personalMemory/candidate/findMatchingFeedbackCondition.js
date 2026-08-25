"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.findMatchingFeedbackCondition = findMatchingFeedbackCondition;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var zod_1 = require("zod");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var buildCandidate_1 = require("./buildCandidate");
var feedbackConditionSelection_prompt_1 = require("./feedbackConditionSelection.prompt");
var FEEDBACK_CONDITIONS_DIRECTORY = "feedback-memories/condition";
var DEFAULT_SIMILARITY_THRESHOLD = 0.5;
var DEFAULT_MAX_LLM_CANDIDATES = 5;
var NonEmptyStringSchema = zod_1.z
    .string()
    .trim()
    .min(1, {
    error: "Value cannot be empty.",
});
var EmbeddingSchema = zod_1.z
    .array(zod_1.z.number().finite())
    .min(1, {
    error: "Embedding must contain at least one number.",
});
var ConditionStateSchema = zod_1.z.enum([
    "active",
    "suspended",
    "superseded",
]);
/**
 * A reference from a condition to a separately stored policy file.
 */
var AtomicPolicyReferenceSchema = zod_1.z.object({
    atomic_policy: NonEmptyStringSchema,
    policy_id: NonEmptyStringSchema,
});
/**
 * This is the result returned by createMainAgentPolicies through
 * buildConditionCandidate.
 */
var MainAgentPoliciesResultSchema = zod_1.z.object({
    atomic_policies: zod_1.z.array(AtomicPolicyReferenceSchema),
});
/**
 * Old condition files may not contain atomic_policies.
 * The default value preserves backward compatibility.
 */
var StoredFeedbackConditionSchema = zod_1.z.looseObject({
    id: NonEmptyStringSchema,
    state: ConditionStateSchema.default("active"),
    activation_description: NonEmptyStringSchema,
    problem_summary: NonEmptyStringSchema.optional(),
    problem_category: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    scope: NonEmptyStringSchema.optional(),
    scope_description: NonEmptyStringSchema,
    atomic_policies: zod_1.z
        .array(AtomicPolicyReferenceSchema)
        .default([]),
    condition_embedding: EmbeddingSchema,
});
/**
 * The interaction fields are required because
 * buildConditionCandidate uses them to generate policies.
 */
var AnalyzeFeedbackConditionInputSchema = zod_1.z.looseObject({
    user_request: NonEmptyStringSchema,
    agent_response: NonEmptyStringSchema,
    user_feedback: NonEmptyStringSchema,
    problem_summary: NonEmptyStringSchema.optional(),
    problem_category: NonEmptyStringSchema,
    task_type: NonEmptyStringSchema,
    scope: NonEmptyStringSchema.optional(),
    scope_description: NonEmptyStringSchema,
    domain: NonEmptyStringSchema.optional(),
    topic: NonEmptyStringSchema.optional(),
    content_type: NonEmptyStringSchema.optional(),
    project_id: NonEmptyStringSchema.optional(),
    condition_embedding: EmbeddingSchema,
});
var LlmConditionSelectionSchema = zod_1.z.object({
    selected_condition_id: NonEmptyStringSchema,
    reasoning: NonEmptyStringSchema,
});
/**
 * The candidate now contains the output of
 * createMainAgentPolicies.
 */
var ConditionCandidateSchema = zod_1.z.looseObject({
    activationDescription: NonEmptyStringSchema,
    scope: NonEmptyStringSchema.optional(),
    mainAgentPolicies: MainAgentPoliciesResultSchema,
});
function isJsonFile(fileName) {
    return fileName
        .toLowerCase()
        .endsWith(".json");
}
function getConditionFilePath(fileName) {
    return "".concat(FEEDBACK_CONDITIONS_DIRECTORY, "/").concat(fileName);
}
function removeMarkdownCodeFence(value) {
    return value
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}
function validateSimilarityThreshold(threshold) {
    if (!Number.isFinite(threshold) ||
        threshold < -1 ||
        threshold > 1) {
        throw new Error("similarity_threshold must be a finite number between -1 and 1.");
    }
    return threshold;
}
function validateMaxLlmCandidates(maxCandidates) {
    if (!Number.isInteger(maxCandidates) ||
        maxCandidates < 1 ||
        maxCandidates > 5) {
        throw new Error("max_llm_candidates must be an integer between 1 and 5.");
    }
    return maxCandidates;
}
function haveSameEmbeddingDimensions(firstEmbedding, secondEmbedding) {
    return (firstEmbedding.length ===
        secondEmbedding.length);
}
function createConditionId() {
    if (typeof globalThis.crypto ===
        "undefined" ||
        typeof globalThis.crypto.randomUUID !==
            "function") {
        throw new Error("crypto.randomUUID is not available.");
    }
    return globalThis.crypto.randomUUID();
}
function ensureConditionDirectory() {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(FEEDBACK_CONDITIONS_DIRECTORY, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    directoryExists = _a.sent();
                    if (directoryExists) {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(FEEDBACK_CONDITIONS_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                            recursive: true,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function getStoredConditionFileNames() {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists, entries;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(FEEDBACK_CONDITIONS_DIRECTORY, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    directoryExists = _a.sent();
                    if (!directoryExists) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(FEEDBACK_CONDITIONS_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    entries = _a.sent();
                    return [2 /*return*/, entries
                            .filter(function (entry) {
                            return entry.isFile &&
                                isJsonFile(entry.name);
                        })
                            .map(function (entry) { return entry.name; })];
            }
        });
    });
}
function readStoredConditionFile(fileName) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, content, parsedJson, validationResult, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    filePath = getConditionFilePath(fileName);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    content = _a.sent();
                    parsedJson = JSON.parse(content);
                    validationResult = StoredFeedbackConditionSchema.safeParse(parsedJson);
                    if (!validationResult.success) {
                        console.warn("Skipping invalid feedback condition file: ".concat(fileName), zod_1.z.flattenError(validationResult.error));
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, {
                            file_name: fileName,
                            file_path: filePath,
                            condition: validationResult.data,
                        }];
                case 3:
                    error_1 = _a.sent();
                    console.warn("Failed to read feedback condition file: ".concat(fileName), error_1);
                    return [2 /*return*/, null];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function readAllStoredConditions() {
    return __awaiter(this, void 0, void 0, function () {
        var fileNames, loadedConditions;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getStoredConditionFileNames()];
                case 1:
                    fileNames = _a.sent();
                    if (fileNames.length === 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, Promise.all(fileNames.map(function (fileName) {
                            return readStoredConditionFile(fileName);
                        }))];
                case 2:
                    loadedConditions = _a.sent();
                    return [2 /*return*/, loadedConditions.filter(function (condition) {
                            return condition !== null;
                        })];
            }
        });
    });
}
function findSimilarConditions(input, loadedConditions, similarityThreshold) {
    var comparableConditions = loadedConditions.filter(function (_a) {
        var condition = _a.condition, fileName = _a.file_name;
        if (condition.state !==
            "active") {
            return false;
        }
        var dimensionsMatch = haveSameEmbeddingDimensions(input.condition_embedding, condition.condition_embedding);
        if (!dimensionsMatch) {
            console.warn("Skipping condition with incompatible embedding dimensions: ".concat(fileName));
        }
        return dimensionsMatch;
    });
    if (comparableConditions.length ===
        0) {
        return [];
    }
    var conditionsById = new Map();
    for (var _i = 0, comparableConditions_1 = comparableConditions; _i < comparableConditions_1.length; _i++) {
        var loadedCondition = comparableConditions_1[_i];
        var conditionId = loadedCondition.condition.id;
        if (conditionsById.has(conditionId)) {
            console.warn("Duplicate feedback condition ID detected: ".concat(conditionId));
            continue;
        }
        conditionsById.set(conditionId, loadedCondition);
    }
    var targetEmbeddings = Array.from(conditionsById.values()).map(function (_a) {
        var condition = _a.condition;
        return ({
            id: condition.id,
            embedding: condition.condition_embedding,
        });
    });
    if (targetEmbeddings.length === 0) {
        return [];
    }
    var comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(input.condition_embedding, targetEmbeddings);
    return comparison.matches
        .filter(function (match) {
        return match.score >
            similarityThreshold;
    })
        .map(function (match) {
        var loadedCondition = conditionsById.get(match.id);
        if (!loadedCondition) {
            throw new Error("Could not find the loaded condition for ID: ".concat(match.id));
        }
        return {
            condition_id: loadedCondition.condition.id,
            file_name: loadedCondition.file_name,
            file_path: loadedCondition.file_path,
            similarity_score: match.score,
            condition: loadedCondition.condition,
        };
    })
        .sort(function (first, second) {
        return second.similarity_score -
            first.similarity_score;
    });
}
function createFeedbackAnalysisForPrompt(input) {
    var _a, _b;
    return {
        problem_summary: (_a = input.problem_summary) !== null && _a !== void 0 ? _a : null,
        problem_category: input.problem_category,
        task_type: input.task_type,
        scope: (_b = input.scope) !== null && _b !== void 0 ? _b : null,
        scope_description: input.scope_description,
    };
}
function createConditionCandidateForPrompt(match) {
    var _a, _b;
    return {
        condition_id: match.condition_id,
        similarity_score: Math.round(match.similarity_score *
            10000) / 10000,
        problem_summary: (_a = match.condition
            .problem_summary) !== null && _a !== void 0 ? _a : null,
        problem_category: match.condition
            .problem_category,
        task_type: match.condition.task_type,
        scope: (_b = match.condition.scope) !== null && _b !== void 0 ? _b : null,
        scope_description: match.condition
            .scope_description,
    };
}
function parseLlmConditionSelection(rawResponse, candidateIds) {
    var cleanedResponse = removeMarkdownCodeFence(rawResponse);
    var parsedResponse;
    try {
        parsedResponse = JSON.parse(cleanedResponse);
    }
    catch (_a) {
        throw new Error("The LLM returned invalid JSON while selecting a feedback condition.");
    }
    var selection = LlmConditionSelectionSchema.parse(parsedResponse);
    if (!candidateIds.has(selection.selected_condition_id)) {
        throw new Error("The LLM selected a condition ID outside the candidate list: ".concat(selection.selected_condition_id));
    }
    return selection;
}
function selectConditionWithLlm(input, candidates) {
    return __awaiter(this, void 0, void 0, function () {
        var feedbackAnalysisForPrompt, candidateConditionsForPrompt, prompt, llm, response, rawResponse, candidateIds;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    feedbackAnalysisForPrompt = createFeedbackAnalysisForPrompt(input);
                    candidateConditionsForPrompt = candidates.map(createConditionCandidateForPrompt);
                    prompt = (0, feedbackConditionSelection_prompt_1.buildFeedbackConditionSelectionPrompt)({
                        feedback_analysis: feedbackAnalysisForPrompt,
                        candidate_conditions: candidateConditionsForPrompt,
                    });
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 1:
                    llm = _a.sent();
                    return [4 /*yield*/, llm.invoke(prompt)];
                case 2:
                    response = _a.sent();
                    rawResponse = typeof response.content ===
                        "string"
                        ? response.content
                        : JSON.stringify(response.content);
                    candidateIds = new Set(candidates.map(function (candidate) {
                        return candidate.condition_id;
                    }));
                    return [2 /*return*/, parseLlmConditionSelection(rawResponse, candidateIds)];
            }
        });
    });
}
/**
 * Creates a condition candidate, creates and stores its missing
 * policy files, and stores references to all policies in the
 * condition file.
 */
function createAndStoreCondition(input) {
    return __awaiter(this, void 0, void 0, function () {
        var rawCandidate, candidate, atomicPolicies, conditionId, conditionEmbedding, storedCondition, fileName, filePath, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, buildCandidate_1.buildConditionCandidate)(__assign(__assign(__assign(__assign(__assign(__assign(__assign(__assign({ user_request: input.user_request, agent_response: input.agent_response, user_feedback: input.user_feedback }, (input.problem_summary
                        ? {
                            problem_summary: input.problem_summary,
                        }
                        : {})), { problem_category: input.problem_category, task_type: input.task_type }), (input.scope
                        ? {
                            scope: input.scope,
                        }
                        : {})), { scope_description: input.scope_description }), (input.domain
                        ? {
                            domain: input.domain,
                        }
                        : {})), (input.topic
                        ? {
                            topic: input.topic,
                        }
                        : {})), (input.content_type
                        ? {
                            content_type: input.content_type,
                        }
                        : {})), (input.project_id
                        ? {
                            project_id: input.project_id,
                        }
                        : {})))];
                case 1:
                    rawCandidate = _a.sent();
                    candidate = ConditionCandidateSchema.parse(rawCandidate);
                    atomicPolicies = candidate
                        .mainAgentPolicies
                        .atomic_policies;
                    conditionId = createConditionId();
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedMemory({
                            content: candidate.activationDescription,
                            context: input.scope_description,
                            key: [
                                input.task_type,
                            ],
                            tags: [
                                input.problem_category,
                            ],
                        })];
                case 2:
                    conditionEmbedding = _a.sent();
                    storedCondition = StoredFeedbackConditionSchema.parse(__assign(__assign(__assign(__assign({ id: conditionId, state: "active", activation_description: candidate.activationDescription }, (input.problem_summary
                        ? {
                            problem_summary: input.problem_summary,
                        }
                        : {})), { problem_category: input.problem_category, task_type: input.task_type }), (candidate.scope
                        ? {
                            scope: candidate.scope,
                        }
                        : input.scope
                            ? {
                                scope: input.scope,
                            }
                            : {})), { scope_description: input.scope_description, 
                        /*
                         * These references connect this condition to the policy
                         * files stored in feedback-memories/policy.
                         */
                        atomic_policies: atomicPolicies, condition_embedding: conditionEmbedding }));
                    return [4 /*yield*/, ensureConditionDirectory()];
                case 3:
                    _a.sent();
                    fileName = "".concat(conditionId, ".json");
                    filePath = getConditionFilePath(fileName);
                    _a.label = 4;
                case 4:
                    _a.trys.push([4, 6, , 7]);
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, "".concat(JSON.stringify(storedCondition, null, 2), "\n"), {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 6:
                    error_2 = _a.sent();
                    throw new Error("Failed to store feedback condition file \"".concat(fileName, "\"."));
                case 7:
                    console.log("Stored feedback condition:", JSON.stringify(storedCondition, null, 2));
                    return [2 /*return*/, conditionId];
            }
        });
    });
}
/**
 * Returns an existing matching condition ID.
 *
 * If no matching condition exists, this function:
 * 1. Builds a new condition candidate.
 * 2. Generates and resolves its policies.
 * 3. Stores missing policy files.
 * 4. Stores policy references inside the condition file.
 * 5. Returns the new condition ID.
 */
function findMatchingFeedbackCondition(analyzeFeedbackResult_1) {
    return __awaiter(this, arguments, void 0, function (analyzeFeedbackResult, options) {
        var validatedInput, similarityThreshold, maxLlmCandidates, loadedConditions, similarConditions, topCandidates, selection, error_3;
        var _a, _b;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    validatedInput = AnalyzeFeedbackConditionInputSchema.parse(analyzeFeedbackResult);
                    similarityThreshold = validateSimilarityThreshold((_a = options.similarity_threshold) !== null && _a !== void 0 ? _a : DEFAULT_SIMILARITY_THRESHOLD);
                    maxLlmCandidates = validateMaxLlmCandidates((_b = options.max_llm_candidates) !== null && _b !== void 0 ? _b : DEFAULT_MAX_LLM_CANDIDATES);
                    return [4 /*yield*/, readAllStoredConditions()];
                case 1:
                    loadedConditions = _c.sent();
                    if (loadedConditions.length === 0) {
                        return [2 /*return*/, createAndStoreCondition(validatedInput)];
                    }
                    similarConditions = findSimilarConditions(validatedInput, loadedConditions, similarityThreshold);
                    if (similarConditions.length === 0) {
                        return [2 /*return*/, createAndStoreCondition(validatedInput)];
                    }
                    if (similarConditions.length === 1) {
                        return [2 /*return*/, similarConditions[0]
                                .condition_id];
                    }
                    topCandidates = similarConditions.slice(0, maxLlmCandidates);
                    _c.label = 2;
                case 2:
                    _c.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, selectConditionWithLlm(validatedInput, topCandidates)];
                case 3:
                    selection = _c.sent();
                    return [2 /*return*/, selection
                            .selected_condition_id];
                case 4:
                    error_3 = _c.sent();
                    console.warn("The LLM condition selection failed. Falling back to the candidate with the highest similarity score.", error_3);
                    return [2 /*return*/, topCandidates[0]
                            .condition_id];
                case 5: return [2 /*return*/];
            }
        });
    });
}
