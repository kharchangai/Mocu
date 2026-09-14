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
exports.findSimilarFeedbackMemories = findSimilarFeedbackMemories;
exports.analyzeFeedbackMemoryDecision = analyzeFeedbackMemoryDecision;
exports.analyzeFeedbackMemoryAction = analyzeFeedbackMemoryAction;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var zod_1 = require("zod");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var feedbackMemoryDecision_prompt_1 = require("./feedbackMemoryDecision.prompt");
var feedbackAnalysis_types_1 = require("./feedbackAnalysis.types");
var FEEDBACK_MEMORIES_DIRECTORY = "feedback-memories/memory";
var DEFAULT_SIMILARITY_THRESHOLD = 0.7;
var DEFAULT_MAX_RESULTS = 10;
function validateOptions(options) {
    var _a, _b;
    var similarityThreshold = (_a = options.similarity_threshold) !== null && _a !== void 0 ? _a : DEFAULT_SIMILARITY_THRESHOLD;
    var maxResults = (_b = options.max_results) !== null && _b !== void 0 ? _b : DEFAULT_MAX_RESULTS;
    if (!Number.isFinite(similarityThreshold) ||
        similarityThreshold < -1 ||
        similarityThreshold > 1) {
        throw new Error("similarity_threshold must be a finite number between -1 and 1.");
    }
    if (!Number.isInteger(maxResults) || maxResults < 1) {
        throw new Error("max_results must be a positive integer.");
    }
    return {
        similarity_threshold: similarityThreshold,
        max_results: maxResults,
    };
}
function isJsonFile(fileName) {
    return fileName.toLowerCase().endsWith(".json");
}
function getFilePath(fileName) {
    return "".concat(FEEDBACK_MEMORIES_DIRECTORY, "/").concat(fileName);
}
function removeMarkdownCodeFence(value) {
    return value
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}
function createMemoryForDecisionPrompt(memory) {
    return {
        id: memory.id,
        state: memory.state,
        problem_category: memory.problem_category,
        task_type: memory.task_type,
        scope: memory.scope,
        scope_description: memory.scope_description,
        created_at: memory.created_at,
        activated_at: memory.activated_at,
        suspended_at: memory.suspended_at,
        suspension_reason: memory.suspension_reason,
        replaced_by_memory_id: memory.replaced_by_memory_id,
        source_interaction: {
            user_request: memory.source_interaction.user_request,
            agent_response: memory.source_interaction.agent_response,
            user_feedback: memory.source_interaction.user_feedback,
        },
    };
}
function readFeedbackMemoryFromFile(fileName) {
    return __awaiter(this, void 0, void 0, function () {
        var content, parsedJson, validationResult, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(getFilePath(fileName), {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    content = _a.sent();
                    parsedJson = JSON.parse(content);
                    validationResult = feedbackAnalysis_types_1.FeedbackMemorySchema.safeParse(parsedJson);
                    if (!validationResult.success) {
                        console.warn("Skipping invalid feedback memory file: ".concat(fileName), zod_1.z.flattenError(validationResult.error));
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, validationResult.data];
                case 2:
                    error_1 = _a.sent();
                    console.warn("Failed to read feedback memory file: ".concat(fileName), error_1);
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function getStoredFeedbackMemoryFiles() {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists, entries;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(FEEDBACK_MEMORIES_DIRECTORY, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    directoryExists = _a.sent();
                    if (!directoryExists) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(FEEDBACK_MEMORIES_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    entries = _a.sent();
                    return [2 /*return*/, entries
                            .filter(function (entry) { return entry.isFile && isJsonFile(entry.name); })
                            .map(function (entry) { return entry.name; })];
            }
        });
    });
}
function parseLlmDecision(rawResponse, candidateMemoryIds) {
    var cleanedResponse = removeMarkdownCodeFence(rawResponse);
    var parsedResponse;
    try {
        parsedResponse = JSON.parse(cleanedResponse);
    }
    catch (_a) {
        throw new Error("The LLM returned invalid JSON for the feedback memory decision.");
    }
    var decision = feedbackAnalysis_types_1.FeedbackMemoryDecisionSchema.parse(parsedResponse);
    if (decision.target_memory_id !== null &&
        !candidateMemoryIds.has(decision.target_memory_id)) {
        throw new Error("The LLM selected a memory ID that was not in the candidate list: ".concat(decision.target_memory_id));
    }
    return decision;
}
function createFallbackCreateNewDecision() {
    return {
        decision: "CREATE_NEW",
        target_memory_id: null,
        reasoning: "No active stored feedback memory passed the similarity threshold.",
        recall_summary: null,
    };
}
function createActionPlan(decision, targetMatch) {
    if (decision.decision === "CREATE_NEW") {
        return {
            action: "CREATE_NEW",
            reasoning: decision.reasoning,
            recall_summary: null,
            target_memory_id: null,
            target_file_name: null,
            target_file_path: null,
            target_memory: null,
            new_memory_should_be_saved: true,
            target_memory_should_receive_recall: false,
            target_memory_should_be_suspended: false,
        };
    }
    if (!targetMatch) {
        throw new Error("A target memory is required for decision: ".concat(decision.decision));
    }
    if (decision.decision === "APPEND_RECALL") {
        return {
            action: "APPEND_RECALL",
            reasoning: decision.reasoning,
            recall_summary: decision.recall_summary,
            target_memory_id: targetMatch.memory.id,
            target_file_name: targetMatch.file_name,
            target_file_path: targetMatch.file_path,
            target_memory: targetMatch.memory,
            new_memory_should_be_saved: false,
            target_memory_should_receive_recall: true,
            target_memory_should_be_suspended: false,
        };
    }
    return {
        action: "SUSPEND_AND_CREATE",
        reasoning: decision.reasoning,
        recall_summary: null,
        target_memory_id: targetMatch.memory.id,
        target_file_name: targetMatch.file_name,
        target_file_path: targetMatch.file_path,
        target_memory: targetMatch.memory,
        new_memory_should_be_saved: true,
        target_memory_should_receive_recall: false,
        target_memory_should_be_suspended: true,
    };
}
function findSimilarFeedbackMemories(newMemory_1) {
    return __awaiter(this, arguments, void 0, function (newMemory, options) {
        var validatedNewMemory, normalizedOptions, fileNames, storedMemoryEntries, validMemoryEntries, excludedMemoryId, targetEmbeddings, comparison, entriesByMemoryId, matches;
        var _this = this;
        var _a;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    validatedNewMemory = feedbackAnalysis_types_1.FeedbackMemorySchema.parse(newMemory);
                    normalizedOptions = validateOptions(options);
                    return [4 /*yield*/, getStoredFeedbackMemoryFiles()];
                case 1:
                    fileNames = _b.sent();
                    if (fileNames.length === 0) {
                        return [2 /*return*/, {
                                matches: [],
                                scanned_files_count: 0,
                                valid_memories_count: 0,
                            }];
                    }
                    return [4 /*yield*/, Promise.all(fileNames.map(function (fileName) { return __awaiter(_this, void 0, void 0, function () {
                            var memory;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0: return [4 /*yield*/, readFeedbackMemoryFromFile(fileName)];
                                    case 1:
                                        memory = _a.sent();
                                        if (!memory) {
                                            return [2 /*return*/, null];
                                        }
                                        return [2 /*return*/, {
                                                fileName: fileName,
                                                memory: memory,
                                            }];
                                }
                            });
                        }); }))];
                case 2:
                    storedMemoryEntries = _b.sent();
                    validMemoryEntries = storedMemoryEntries.filter(function (entry) { return entry !== null; });
                    excludedMemoryId = (_a = options.exclude_memory_id) !== null && _a !== void 0 ? _a : validatedNewMemory.id;
                    targetEmbeddings = validMemoryEntries
                        .filter(function (entry) {
                        return entry.memory.id !== excludedMemoryId &&
                            entry.memory.state === "active";
                    })
                        .map(function (entry) { return ({
                        id: entry.memory.id,
                        embedding: entry.memory.combined_embedding,
                    }); });
                    if (targetEmbeddings.length === 0) {
                        return [2 /*return*/, {
                                matches: [],
                                scanned_files_count: fileNames.length,
                                valid_memories_count: validMemoryEntries.length,
                            }];
                    }
                    comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(validatedNewMemory.combined_embedding, targetEmbeddings);
                    entriesByMemoryId = new Map(validMemoryEntries.map(function (entry) { return [entry.memory.id, entry]; }));
                    matches = comparison.matches
                        .filter(function (match) { return match.score >= normalizedOptions.similarity_threshold; })
                        .slice(0, normalizedOptions.max_results)
                        .map(function (match) {
                        var entry = entriesByMemoryId.get(match.id);
                        if (!entry) {
                            throw new Error("Could not find loaded memory for ID: ".concat(match.id));
                        }
                        return {
                            file_name: entry.fileName,
                            file_path: getFilePath(entry.fileName),
                            score: match.score,
                            memory: entry.memory,
                        };
                    });
                    return [2 /*return*/, {
                            matches: matches,
                            scanned_files_count: fileNames.length,
                            valid_memories_count: validMemoryEntries.length,
                        }];
            }
        });
    });
}
function analyzeFeedbackMemoryDecision(newMemory, matches) {
    return __awaiter(this, void 0, void 0, function () {
        var newMemoryForPrompt, similarMemoriesForPrompt, prompt, llm, response, rawResponse, candidateMemoryIds;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (matches.length === 0) {
                        return [2 /*return*/, createFallbackCreateNewDecision()];
                    }
                    newMemoryForPrompt = createMemoryForDecisionPrompt(newMemory);
                    similarMemoriesForPrompt = matches.map(function (match) { return ({
                        file_name: match.file_name,
                        similarity_score: match.score,
                        memory: createMemoryForDecisionPrompt(match.memory),
                    }); });
                    prompt = (0, feedbackMemoryDecision_prompt_1.buildFeedbackMemoryDecisionPrompt)({
                        new_memory: newMemoryForPrompt,
                        similar_memories: similarMemoriesForPrompt,
                    });
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 1:
                    llm = _a.sent();
                    return [4 /*yield*/, llm.invoke(prompt)];
                case 2:
                    response = _a.sent();
                    rawResponse = typeof response.content === "string"
                        ? response.content
                        : JSON.stringify(response.content);
                    candidateMemoryIds = new Set(matches.map(function (match) { return match.memory.id; }));
                    return [2 /*return*/, parseLlmDecision(rawResponse, candidateMemoryIds)];
            }
        });
    });
}
function analyzeFeedbackMemoryAction(newMemory_1) {
    return __awaiter(this, arguments, void 0, function (newMemory, options) {
        var validatedNewMemory, similarMemoriesResult, decision, targetMatch, actionPlan;
        var _a;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    validatedNewMemory = feedbackAnalysis_types_1.FeedbackMemorySchema.parse(newMemory);
                    return [4 /*yield*/, findSimilarFeedbackMemories(validatedNewMemory, options)];
                case 1:
                    similarMemoriesResult = _b.sent();
                    return [4 /*yield*/, analyzeFeedbackMemoryDecision(validatedNewMemory, similarMemoriesResult.matches)];
                case 2:
                    decision = _b.sent();
                    targetMatch = decision.target_memory_id === null
                        ? null
                        : (_a = similarMemoriesResult.matches.find(function (match) { return match.memory.id === decision.target_memory_id; })) !== null && _a !== void 0 ? _a : null;
                    actionPlan = createActionPlan(decision, targetMatch);
                    return [2 /*return*/, {
                            action_plan: actionPlan,
                            decision: decision,
                            similar_memories: similarMemoriesResult.matches,
                            scanned_files_count: similarMemoriesResult.scanned_files_count,
                            valid_memories_count: similarMemoriesResult.valid_memories_count,
                        }];
            }
        });
    });
}
