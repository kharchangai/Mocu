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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeFeedback = analyzeFeedback;
var messages_1 = require("@langchain/core/messages");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var findMatchingFeedbackCondition_1 = require("../candidate/findMatchingFeedbackCondition");
var findSimilarFeedbackMemories_1 = require("./findSimilarFeedbackMemories");
var prompts_1 = require("./prompts");
var feedbackAnalysis_types_1 = require("./feedbackAnalysis.types");
var FEEDBACK_MEMORIES_DIRECTORY = "feedback-memories/memory";
var SIMILARITY_THRESHOLD = 0.7;
var MAX_SIMILAR_MEMORIES = 10;
var EMBEDDING_REPETITIONS = {
    scope_description: 5,
    problem_category: 3,
    task_type: 2,
    scope: 1,
};
var CONDITION_EMBEDDING_REPETITIONS = {
    scope_description: 5,
    problem_category: 3,
    task_type: 2,
};
/**
 * This instruction is appended to the main prompt so the model returns raw JSON only.
 *
 * withStructuredOutput is intentionally not used because some OpenAI-compatible
 * providers do not support tools or json_schema response formats.
 */
var JSON_OUTPUT_INSTRUCTION = "\nIMPORTANT OUTPUT RULES:\n- Return exactly one valid JSON object.\n- Do not wrap the JSON in Markdown code fences.\n- Do not write any explanation before or after the JSON.\n- Use exactly the fields requested in the system prompt.\n- Do not omit required fields.\n- Make sure the response can be parsed directly with JSON.parse().\n".trim();
function validateInput(input) {
    var _a, _b, _c;
    if (!((_a = input.user_request) === null || _a === void 0 ? void 0 : _a.trim())) {
        throw new Error("user_request cannot be empty.");
    }
    if (!((_b = input.agent_response) === null || _b === void 0 ? void 0 : _b.trim())) {
        throw new Error("agent_response cannot be empty.");
    }
    if (!((_c = input.user_feedback) === null || _c === void 0 ? void 0 : _c.trim())) {
        throw new Error("user_feedback cannot be empty.");
    }
}
function buildUserMessage(input) {
    return JSON.stringify({
        user_request: input.user_request.trim(),
        agent_response: input.agent_response.trim(),
        user_feedback: input.user_feedback.trim(),
    }, null, 2);
}
function buildSystemMessage() {
    return "".concat(prompts_1.FEEDBACK_ANALYSIS_SYSTEM_PROMPT.trim(), "\n\n").concat(JSON_OUTPUT_INSTRUCTION);
}
function createTimestamps() {
    var now = new Date().toISOString();
    return {
        createdAt: now,
        activatedAt: now,
    };
}
function normalizeText(value) {
    return (value === null || value === void 0 ? void 0 : value.trim().replace(/\s+/g, " ")) || "Not specified";
}
function repeatEmbeddingField(label, value, repetitions) {
    return Array.from({ length: repetitions }, function () { return "".concat(label, ": ").concat(value); });
}
/**
 * Creates the embedding text used for feedback-memory similarity,
 * duplicate detection, and memory relationship analysis.
 */
function createFeedbackMemoryEmbeddingText(input) {
    var problemCategory = normalizeText(input.problemCategory);
    var taskType = normalizeText(input.taskType);
    var scope = normalizeText(input.scope);
    var scopeDescription = normalizeText(input.scopeDescription);
    return __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([
        "Memory retrieval profile:",
        "",
        "Primary activation context:"
    ], repeatEmbeddingField("Scope description", scopeDescription, EMBEDDING_REPETITIONS.scope_description), true), [
        "",
        "Problem classification:"
    ], false), repeatEmbeddingField("Problem category", problemCategory, EMBEDDING_REPETITIONS.problem_category), true), [
        "",
        "Task classification:"
    ], false), repeatEmbeddingField("Task type", taskType, EMBEDDING_REPETITIONS.task_type), true), [
        "",
        "Scope classification:"
    ], false), repeatEmbeddingField("Scope", scope, EMBEDDING_REPETITIONS.scope), true).join("\n");
}
/**
 * Creates the embedding text used to retrieve memories by activation condition.
 *
 * This embedding intentionally excludes scope and focuses on:
 * task type, problem category, and scope description.
 */
function createConditionEmbeddingText(input) {
    var problemCategory = normalizeText(input.problemCategory);
    var taskType = normalizeText(input.taskType);
    var scopeDescription = normalizeText(input.scopeDescription);
    return __spreadArray(__spreadArray(__spreadArray(__spreadArray(__spreadArray([
        "Feedback memory activation condition:",
        "",
        "Activation context:"
    ], repeatEmbeddingField("Scope description", scopeDescription, CONDITION_EMBEDDING_REPETITIONS.scope_description), true), [
        "",
        "Problem classification:"
    ], false), repeatEmbeddingField("Problem category", problemCategory, CONDITION_EMBEDDING_REPETITIONS.problem_category), true), [
        "",
        "Task classification:"
    ], false), repeatEmbeddingField("Task type", taskType, CONDITION_EMBEDDING_REPETITIONS.task_type), true).join("\n");
}
function validateEmbeddingVector(vector, errorMessage) {
    if (!Array.isArray(vector) ||
        vector.length === 0 ||
        vector.some(function (value) { return !Number.isFinite(value); })) {
        throw new Error(errorMessage);
    }
}
function createFeedbackMemoryEmbedding(input) {
    return __awaiter(this, void 0, void 0, function () {
        var text, vector;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    text = createFeedbackMemoryEmbeddingText(input);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(text)];
                case 1:
                    vector = _a.sent();
                    validateEmbeddingVector(vector, "Failed to create a valid feedback memory embedding.");
                    return [2 /*return*/, {
                            text: text,
                            vector: vector,
                        }];
            }
        });
    });
}
function createConditionEmbedding(input) {
    return __awaiter(this, void 0, void 0, function () {
        var text, vector;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    text = createConditionEmbeddingText(input);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(text)];
                case 1:
                    vector = _a.sent();
                    validateEmbeddingVector(vector, "Failed to create a valid feedback memory condition embedding.");
                    return [2 /*return*/, {
                            text: text,
                            vector: vector,
                        }];
            }
        });
    });
}
/**
 * Converts supported LangChain message content into plain text.
 */
function messageContentToText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        throw new Error("The feedback analysis model returned an unsupported content format.");
    }
    var text = content
        .map(function (item) {
        if (typeof item === "string") {
            return item;
        }
        if (!item || typeof item !== "object") {
            return "";
        }
        var contentBlock = item;
        if (typeof contentBlock.text === "string") {
            return contentBlock.text;
        }
        return "";
    })
        .join("")
        .trim();
    if (!text) {
        throw new Error("The feedback analysis model returned an empty response.");
    }
    return text;
}
function removeMarkdownCodeFence(value) {
    var trimmed = value.trim();
    var fencedJsonMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fencedJsonMatch === null || fencedJsonMatch === void 0 ? void 0 : fencedJsonMatch[1]) {
        return fencedJsonMatch[1].trim();
    }
    return trimmed;
}
/**
 * Extracts the first balanced JSON object from a string.
 * Braces inside JSON string values are ignored.
 */
function extractFirstJsonObject(value) {
    var firstOpeningBrace = value.indexOf("{");
    if (firstOpeningBrace === -1) {
        throw new Error("No JSON object was found in the model response.");
    }
    var depth = 0;
    var insideString = false;
    var escaped = false;
    for (var index = firstOpeningBrace; index < value.length; index += 1) {
        var character = value[index];
        if (insideString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === "\\") {
                escaped = true;
                continue;
            }
            if (character === '"') {
                insideString = false;
            }
            continue;
        }
        if (character === '"') {
            insideString = true;
            continue;
        }
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return value.slice(firstOpeningBrace, index + 1);
            }
        }
    }
    throw new Error("An incomplete JSON object was returned by the model.");
}
function parseModelJsonResponse(responseText) {
    var normalizedResponse = removeMarkdownCodeFence(responseText);
    if (!normalizedResponse) {
        throw new Error("The feedback analysis model returned an empty response.");
    }
    try {
        return JSON.parse(normalizedResponse);
    }
    catch (_a) {
        // Continue by attempting to extract the first JSON object.
    }
    var extractedJson;
    try {
        extractedJson = extractFirstJsonObject(normalizedResponse);
    }
    catch (error) {
        console.error("Feedback analysis raw response:", responseText);
        throw new Error("The feedback analysis model did not return a JSON object. ".concat(error instanceof Error ? error.message : String(error)));
    }
    try {
        return JSON.parse(extractedJson);
    }
    catch (error) {
        console.error("Feedback analysis raw response:", responseText);
        console.error("Extracted feedback analysis JSON:", extractedJson);
        throw new Error("The feedback analysis model returned invalid JSON. ".concat(error instanceof Error ? error.message : String(error)));
    }
}
/**
 * Invokes the model without LangChain structured output.
 *
 * This avoids sending tools, function calling, or response_format=json_schema
 * to the provider.
 */
function invokeFeedbackAnalysisModel(input) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, response, responseText, parsedResponse, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    llm = _a.sent();
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, llm.invoke([
                            new messages_1.SystemMessage(buildSystemMessage()),
                            new messages_1.HumanMessage(buildUserMessage(input)),
                        ])];
                case 3:
                    response = _a.sent();
                    responseText = messageContentToText(response.content);
                    parsedResponse = parseModelJsonResponse(responseText);
                    return [2 /*return*/, feedbackAnalysis_types_1.FeedbackAnalysisModelResultSchema.parse(parsedResponse)];
                case 4:
                    error_1 = _a.sent();
                    console.error("Feedback analysis model invocation failed:", error_1);
                    throw error_1;
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Ensures that AppData/feedback-memories/memory exists.
 */
function ensureFeedbackMemoriesDirectory() {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(FEEDBACK_MEMORIES_DIRECTORY, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    directoryExists = _a.sent();
                    if (directoryExists) {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(FEEDBACK_MEMORIES_DIRECTORY, {
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
/**
 * Saves a feedback memory in AppData/feedback-memories/memory.
 */
function saveFeedbackMemory(memory) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureFeedbackMemoriesDirectory()];
                case 1:
                    _a.sent();
                    filePath = "".concat(FEEDBACK_MEMORIES_DIRECTORY, "/").concat(memory.id, ".json");
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, JSON.stringify(memory, null, 2), {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Extracts condition_id from the condition lookup result.
 *
 * Both a raw string result and an object containing condition_id
 * are supported.
 */
function extractConditionId(conditionResult) {
    if (typeof conditionResult === "string" &&
        conditionResult.trim()) {
        return conditionResult.trim();
    }
    if (!conditionResult || typeof conditionResult !== "object") {
        throw new Error("findMatchingFeedbackCondition returned an invalid result.");
    }
    var result = conditionResult;
    if (typeof result.condition_id === "string" &&
        result.condition_id.trim()) {
        return result.condition_id.trim();
    }
    if (typeof result.conditionId === "string" &&
        result.conditionId.trim()) {
        return result.conditionId.trim();
    }
    if (result.condition &&
        typeof result.condition === "object") {
        var condition = result.condition;
        if (typeof condition.id === "string" &&
            condition.id.trim()) {
            return condition.id.trim();
        }
    }
    throw new Error("findMatchingFeedbackCondition did not return a valid condition_id.");
}
/**
 * Increments and persists recall_count for the selected existing memory.
 */
function incrementTargetMemoryRecallCount(actionResult) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, target_memory_id, target_memory_should_receive_recall, targetMatch, updatedTargetMemory;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = actionResult.action_plan, target_memory_id = _a.target_memory_id, target_memory_should_receive_recall = _a.target_memory_should_receive_recall;
                    if (!target_memory_should_receive_recall ||
                        !target_memory_id) {
                        return [2 /*return*/];
                    }
                    targetMatch = actionResult.similar_memories.find(function (match) { return match.memory.id === target_memory_id; });
                    if (!targetMatch) {
                        throw new Error("Could not find the recall target memory: ".concat(target_memory_id));
                    }
                    updatedTargetMemory = feedbackAnalysis_types_1.FeedbackMemorySchema.parse(__assign(__assign({}, targetMatch.memory), { recall_count: targetMatch.memory.recall_count + 1 }));
                    return [4 /*yield*/, saveFeedbackMemory(updatedTargetMemory)];
                case 1:
                    _b.sent();
                    console.log("Feedback memory recall count updated:", {
                        memory_id: updatedTargetMemory.id,
                        recall_count: updatedTargetMemory.recall_count,
                    });
                    return [2 /*return*/];
            }
        });
    });
}
function logFeedbackMemoryAction(actionResult) {
    if (actionResult.similar_memories.length === 0) {
        console.log("No similar feedback memories were found.");
        console.log("Feedback memory action plan:", {
            action: actionResult.action_plan.action,
            reasoning: actionResult.action_plan.reasoning,
            target_memory_id: actionResult.action_plan.target_memory_id,
            new_memory_should_be_saved: actionResult.action_plan.new_memory_should_be_saved,
            target_memory_should_receive_recall: actionResult.action_plan
                .target_memory_should_receive_recall,
            target_memory_should_be_suspended: actionResult.action_plan
                .target_memory_should_be_suspended,
        });
        return;
    }
    console.log("Similar feedback memories:", actionResult.similar_memories.map(function (match) { return ({
        file_name: match.file_name,
        score: match.score,
        memory_id: match.memory.id,
        problem_category: match.memory.problem_category,
        task_type: match.memory.task_type,
        scope_description: match.memory.scope_description,
        recall_count: match.memory.recall_count,
    }); }));
    console.log("Feedback memory action plan:", {
        action: actionResult.action_plan.action,
        reasoning: actionResult.action_plan.reasoning,
        target_memory_id: actionResult.action_plan.target_memory_id,
        new_memory_should_be_saved: actionResult.action_plan.new_memory_should_be_saved,
        target_memory_should_receive_recall: actionResult.action_plan
            .target_memory_should_receive_recall,
        target_memory_should_be_suspended: actionResult.action_plan
            .target_memory_should_be_suspended,
    });
}
function analyzeFeedback(input) {
    return __awaiter(this, void 0, void 0, function () {
        var result, timestamps, _a, embedding, conditionEmbedding, memoryData, conditionResult, conditionId, memory, actionResult;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    validateInput(input);
                    return [4 /*yield*/, invokeFeedbackAnalysisModel(input)];
                case 1:
                    result = _b.sent();
                    timestamps = createTimestamps();
                    return [4 /*yield*/, Promise.all([
                            createFeedbackMemoryEmbedding({
                                problemCategory: result.problem_category,
                                taskType: result.task_type,
                                scope: result.scope,
                                scopeDescription: result.scope_description,
                            }),
                            createConditionEmbedding({
                                problemCategory: result.problem_category,
                                taskType: result.task_type,
                                scopeDescription: result.scope_description,
                            }),
                        ])];
                case 2:
                    _a = _b.sent(), embedding = _a[0], conditionEmbedding = _a[1];
                    memoryData = __assign(__assign({}, result), { id: crypto.randomUUID(), state: "active", recall_count: 0, created_at: timestamps.createdAt, activated_at: timestamps.activatedAt, suspended_at: null, suspension_reason: null, replaced_by_memory_id: null, combined_embedding: embedding.vector, embedding_text: embedding.text, embedding_metadata: {
                            strategy: "weighted_text_repetition",
                            field_priority: [
                                "scope_description",
                                "problem_category",
                                "task_type",
                                "scope",
                            ],
                            repetitions: EMBEDDING_REPETITIONS,
                            generated_at: timestamps.createdAt,
                        }, condition_embedding: conditionEmbedding.vector, condition_embedding_text: conditionEmbedding.text, condition_embedding_metadata: {
                            strategy: "weighted_text_repetition",
                            field_priority: [
                                "scope_description",
                                "problem_category",
                                "task_type",
                            ],
                            repetitions: CONDITION_EMBEDDING_REPETITIONS,
                            generated_at: timestamps.createdAt,
                        }, source_interaction: {
                            user_request: input.user_request.trim(),
                            agent_response: input.agent_response.trim(),
                            user_feedback: input.user_feedback.trim(),
                        } });
                    return [4 /*yield*/, (0, findMatchingFeedbackCondition_1.findMatchingFeedbackCondition)({
                            user_request: input.user_request.trim(),
                            agent_response: input.agent_response.trim(),
                            user_feedback: input.user_feedback.trim(),
                            feedback_analysis: result,
                            problem_category: result.problem_category,
                            task_type: result.task_type,
                            scope: result.scope,
                            scope_description: result.scope_description,
                            condition_embedding: conditionEmbedding.vector,
                            condition_embedding_text: conditionEmbedding.text,
                        })];
                case 3:
                    conditionResult = _b.sent();
                    conditionId = extractConditionId(conditionResult);
                    memory = feedbackAnalysis_types_1.FeedbackMemorySchema.parse(__assign(__assign({}, memoryData), { condition_id: conditionId }));
                    return [4 /*yield*/, (0, findSimilarFeedbackMemories_1.analyzeFeedbackMemoryAction)(memory, {
                            similarity_threshold: SIMILARITY_THRESHOLD,
                            max_results: MAX_SIMILAR_MEMORIES,
                        })];
                case 4:
                    actionResult = _b.sent();
                    logFeedbackMemoryAction(actionResult);
                    if (!actionResult.action_plan.new_memory_should_be_saved) return [3 /*break*/, 6];
                    return [4 /*yield*/, saveFeedbackMemory(memory)];
                case 5:
                    _b.sent();
                    console.log("New feedback memory saved:", {
                        memory_id: memory.id,
                        condition_id: memory.condition_id,
                    });
                    _b.label = 6;
                case 6: return [4 /*yield*/, incrementTargetMemoryRecallCount(actionResult)];
                case 7:
                    _b.sent();
                    return [2 /*return*/, memory];
            }
        });
    });
}
