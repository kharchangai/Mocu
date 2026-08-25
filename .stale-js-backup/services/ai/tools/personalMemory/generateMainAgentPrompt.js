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
exports.generateMainAgentPolicyPrompt = generateMainAgentPolicyPrompt;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var messages_1 = require("@langchain/core/messages");
var llm_1 = require("../../llm");
var textSimilarity_1 = require("../textSimilarity");
var mainAgentPolicyPrompt_1 = require("./mainAgentPolicyPrompt");
var CONDITION_DIRECTORY = "feedback-memories/condition";
var POLICY_DIRECTORY = "feedback-memories/policy";
var DEFAULT_SIMILARITY_THRESHOLD = 0.5;
var DEFAULT_MAX_MATCHED_CONDITIONS = 3;
var DEFAULT_LLM_TIER = "medium";
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
    }
}
function isRecord(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value));
}
function isNonEmptyString(value) {
    return (typeof value === "string" &&
        value.trim().length > 0);
}
function getOptionalString(value) {
    return isNonEmptyString(value)
        ? value.trim()
        : "";
}
function isValidEmbedding(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.every(function (item) {
            return typeof item === "number" &&
                Number.isFinite(item);
        }));
}
function normalizeStringArray(value) {
    if (isNonEmptyString(value)) {
        return [value.trim()];
    }
    if (!Array.isArray(value)) {
        return [];
    }
    return __spreadArray([], new Set(value
        .filter(isNonEmptyString)
        .map(function (item) { return item.trim(); })), true);
}
function normalizePolicyReferences(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    var policyIds = new Set();
    for (var _i = 0, value_1 = value; _i < value_1.length; _i++) {
        var item = value_1[_i];
        if (isNonEmptyString(item)) {
            policyIds.add(item.trim());
            continue;
        }
        if (!isRecord(item)) {
            continue;
        }
        if (isNonEmptyString(item.policy_id)) {
            policyIds.add(item.policy_id.trim());
            continue;
        }
        if (isNonEmptyString(item.policyId)) {
            policyIds.add(item.policyId.trim());
        }
    }
    return __spreadArray([], policyIds, true).map(function (policyId) { return ({
        policy_id: policyId,
    }); });
}
function parseConditionDocument(value, fileName) {
    var _a, _b, _c, _d, _e;
    if (!isRecord(value)) {
        throw new Error("Condition file \"".concat(fileName, "\" must contain a JSON object."));
    }
    if (!isNonEmptyString(value.id)) {
        throw new Error("Condition file \"".concat(fileName, "\" does not contain a valid id."));
    }
    var embedding = (_b = (_a = value.condition_embedding) !== null && _a !== void 0 ? _a : value.conditionEmbedding) !== null && _b !== void 0 ? _b : value.embedding;
    if (!isValidEmbedding(embedding)) {
        throw new Error("Condition file \"".concat(fileName, "\" does not contain a valid embedding."));
    }
    return {
        id: value.id.trim(),
        condition_embedding: __spreadArray([], embedding, true),
        atomic_policies: normalizePolicyReferences((_e = (_d = (_c = value.atomic_policies) !== null && _c !== void 0 ? _c : value.atomicPolicies) !== null && _d !== void 0 ? _d : value.policy_ids) !== null && _e !== void 0 ? _e : value.policyIds),
        state: isNonEmptyString(value.state)
            ? value.state.trim().toLowerCase()
            : undefined,
    };
}
function parsePolicyDocument(value, fileName) {
    var _a, _b, _c, _d;
    if (!isRecord(value)) {
        throw new Error("Policy file \"".concat(fileName, "\" must contain a JSON object."));
    }
    if (!isNonEmptyString(value.id)) {
        throw new Error("Policy file \"".concat(fileName, "\" does not contain a valid id."));
    }
    if (!isRecord(value.policy)) {
        throw new Error("Policy file \"".concat(fileName, "\" does not contain a valid \"policy\" object."));
    }
    var policy = value.policy;
    var instruction = normalizeStringArray((_a = policy.instruction) !== null && _a !== void 0 ? _a : policy.instructions);
    var constraints = normalizeStringArray(policy.constraints);
    var successCriteria = normalizeStringArray((_b = policy.success_criteria) !== null && _b !== void 0 ? _b : policy.successCriteria);
    if (instruction.length === 0 &&
        constraints.length === 0 &&
        successCriteria.length === 0) {
        throw new Error("Policy file \"".concat(fileName, "\" does not contain policy requirements inside \"policy\"."));
    }
    var embedding = isValidEmbedding(value.embedding)
        ? __spreadArray([], value.embedding, true) : [];
    return {
        id: value.id.trim(),
        atomic_policy: getOptionalString((_c = value.atomic_policy) !== null && _c !== void 0 ? _c : value.atomicPolicy),
        title: getOptionalString(policy.title),
        activation_condition: getOptionalString((_d = policy.activation_condition) !== null && _d !== void 0 ? _d : policy.activationCondition),
        instruction: instruction,
        constraints: constraints,
        success_criteria: successCriteria,
        embedding: embedding,
    };
}
function isJsonFile(entry) {
    return (entry.isFile === true &&
        entry.name.toLowerCase().endsWith(".json"));
}
/**
 * Reads directory entries, treating a missing directory as an empty
 * result instead of throwing. On a fresh install the feedback-memory
 * directories do not exist yet, so this lets the caller behave as if
 * there are simply no conditions or policies stored.
 */
function readDirectoryEntries(directory, baseDirectory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var error_1, message, isMissingDirectory;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(directory, {
                            baseDir: baseDirectory,
                        })];
                case 2: return [2 /*return*/, _a.sent()];
                case 3:
                    error_1 = _a.sent();
                    message = error_1 instanceof Error
                        ? error_1.message
                        : String(error_1);
                    isMissingDirectory = message.includes("system cannot find the path") ||
                        message.includes("os error 3") ||
                        message.includes("ENOENT") ||
                        message.includes("No such file") ||
                        message.includes("no such file");
                    if (isMissingDirectory) {
                        console.warn("[Memory retrieval] Directory not found: ".concat(directory, ". Treating as empty."));
                        return [2 /*return*/, []];
                    }
                    throw error_1;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function readJsonFile(path, baseDirectory) {
    return __awaiter(this, void 0, void 0, function () {
        var content, message;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(path, {
                        baseDir: baseDirectory,
                    })];
                case 1:
                    content = _a.sent();
                    try {
                        return [2 /*return*/, JSON.parse(content)];
                    }
                    catch (error) {
                        message = error instanceof Error
                            ? error.message
                            : String(error);
                        throw new Error("Could not parse JSON file \"".concat(path, "\": ").concat(message));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function readConditionFiles(baseDirectory, includeInactiveConditions, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, files, _i, entries_1, entry, path, value, document_1, isActive, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, readDirectoryEntries(CONDITION_DIRECTORY, baseDirectory, signal)];
                case 1:
                    entries = _a.sent();
                    files = [];
                    _i = 0, entries_1 = entries;
                    _a.label = 2;
                case 2:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 7];
                    entry = entries_1[_i];
                    throwIfAborted(signal);
                    if (!isJsonFile(entry)) {
                        return [3 /*break*/, 6];
                    }
                    path = "".concat(CONDITION_DIRECTORY, "/").concat(entry.name);
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, readJsonFile(path, baseDirectory)];
                case 4:
                    value = _a.sent();
                    throwIfAborted(signal);
                    document_1 = parseConditionDocument(value, entry.name);
                    isActive = document_1.state === undefined ||
                        document_1.state === "active";
                    if (!includeInactiveConditions &&
                        !isActive) {
                        return [3 /*break*/, 6];
                    }
                    files.push({
                        fileName: entry.name,
                        document: document_1,
                    });
                    return [3 /*break*/, 6];
                case 5:
                    error_2 = _a.sent();
                    if (error_2 instanceof DOMException &&
                        error_2.name === "AbortError") {
                        throw error_2;
                    }
                    console.warn("[Condition retrieval] Skipped \"".concat(entry.name, "\"."), error_2);
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7: return [2 /*return*/, files];
            }
        });
    });
}
function readPolicyFiles(baseDirectory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, files, _i, entries_2, entry, path, value, document_2, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, readDirectoryEntries(POLICY_DIRECTORY, baseDirectory, signal)];
                case 1:
                    entries = _a.sent();
                    files = [];
                    _i = 0, entries_2 = entries;
                    _a.label = 2;
                case 2:
                    if (!(_i < entries_2.length)) return [3 /*break*/, 7];
                    entry = entries_2[_i];
                    throwIfAborted(signal);
                    if (!isJsonFile(entry)) {
                        return [3 /*break*/, 6];
                    }
                    path = "".concat(POLICY_DIRECTORY, "/").concat(entry.name);
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, readJsonFile(path, baseDirectory)];
                case 4:
                    value = _a.sent();
                    throwIfAborted(signal);
                    document_2 = parsePolicyDocument(value, entry.name);
                    files.push({
                        fileName: entry.name,
                        document: document_2,
                    });
                    return [3 /*break*/, 6];
                case 5:
                    error_3 = _a.sent();
                    if (error_3 instanceof DOMException &&
                        error_3.name === "AbortError") {
                        throw error_3;
                    }
                    console.warn("[Policy retrieval] Skipped \"".concat(entry.name, "\"."), error_3);
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7: return [2 /*return*/, files];
            }
        });
    });
}
function validateOptions(threshold, maxConditions) {
    if (!Number.isFinite(threshold) ||
        threshold < -1 ||
        threshold > 1) {
        throw new Error("similarityThreshold must be between -1 and 1.");
    }
    if (!Number.isInteger(maxConditions) ||
        maxConditions < 1) {
        throw new Error("maxMatchedConditions must be a positive integer.");
    }
}
function findMatchingConditions(userEmbedding, conditionFiles, threshold, maxConditions) {
    var embeddingItems = [];
    var conditionById = new Map();
    for (var _i = 0, conditionFiles_1 = conditionFiles; _i < conditionFiles_1.length; _i++) {
        var conditionFile = conditionFiles_1[_i];
        var condition = conditionFile.document;
        if (conditionById.has(condition.id)) {
            console.warn("[Condition retrieval] Duplicate condition ID ignored: ".concat(condition.id));
            continue;
        }
        if (condition.condition_embedding.length !==
            userEmbedding.length) {
            console.warn("[Condition retrieval] Incompatible embedding dimension: ".concat(condition.id));
            continue;
        }
        conditionById.set(condition.id, conditionFile);
        embeddingItems.push({
            id: condition.id,
            embedding: condition.condition_embedding,
        });
    }
    if (embeddingItems.length === 0) {
        return [];
    }
    var comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(userEmbedding, embeddingItems);
    return comparison.matches
        .filter(function (match) {
        return match.score >= threshold;
    })
        .sort(function (left, right) {
        return right.score - left.score;
    })
        .slice(0, maxConditions)
        .map(function (match) {
        var conditionFile = conditionById.get(match.id);
        if (!conditionFile) {
            throw new Error("Condition \"".concat(match.id, "\" was not found."));
        }
        return {
            condition_id: conditionFile.document.id,
            file_name: conditionFile.fileName,
            similarity_score: match.score,
            policy_ids: conditionFile.document
                .atomic_policies
                .map(function (policy) {
                return policy.policy_id;
            }),
        };
    });
}
function retrieveReferencedPolicies(matchedConditions, policyFiles) {
    var _a;
    var policyById = new Map();
    for (var _i = 0, policyFiles_1 = policyFiles; _i < policyFiles_1.length; _i++) {
        var file = policyFiles_1[_i];
        if (policyById.has(file.document.id)) {
            console.warn("[Policy retrieval] Duplicate policy ID ignored: ".concat(file.document.id));
            continue;
        }
        policyById.set(file.document.id, file);
    }
    var sourceConditionsByPolicyId = new Map();
    for (var _b = 0, matchedConditions_1 = matchedConditions; _b < matchedConditions_1.length; _b++) {
        var condition = matchedConditions_1[_b];
        for (var _c = 0, _d = condition.policy_ids; _c < _d.length; _c++) {
            var policyId = _d[_c];
            var conditionIds = (_a = sourceConditionsByPolicyId.get(policyId)) !== null && _a !== void 0 ? _a : new Set();
            conditionIds.add(condition.condition_id);
            sourceConditionsByPolicyId.set(policyId, conditionIds);
        }
    }
    var results = [];
    for (var _e = 0, sourceConditionsByPolicyId_1 = sourceConditionsByPolicyId; _e < sourceConditionsByPolicyId_1.length; _e++) {
        var _f = sourceConditionsByPolicyId_1[_e], policyId = _f[0], sourceConditionIds = _f[1];
        var policyFile = policyById.get(policyId);
        if (!policyFile) {
            console.warn("[Policy retrieval] Policy not found: ".concat(policyId));
            continue;
        }
        var document_3 = policyFile.document;
        results.push({
            policy_id: document_3.id,
            file_name: policyFile.fileName,
            atomic_policy: document_3.atomic_policy,
            title: document_3.title,
            activation_condition: document_3.activation_condition,
            instruction: document_3.instruction,
            constraints: document_3.constraints,
            success_criteria: document_3.success_criteria,
            embedding: document_3.embedding,
            source_condition_ids: __spreadArray([], sourceConditionIds, true),
        });
    }
    return results;
}
function modelContentToString(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return String(content !== null && content !== void 0 ? content : "");
    }
    return content
        .map(function (item) {
        if (typeof item === "string") {
            return item;
        }
        if (isRecord(item) &&
            typeof item.text === "string") {
            return item.text;
        }
        return "";
    })
        .filter(Boolean)
        .join("\n");
}
function generatePromptWithLLM(userRequest, policies, tier, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, userPrompt, response, generatedPrompt;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)(tier)];
                case 1:
                    llm = _a.sent();
                    throwIfAborted(signal);
                    userPrompt = (0, mainAgentPolicyPrompt_1.createMainAgentPolicyUserPrompt)({
                        userRequest: userRequest,
                        policies: policies.map(function (policy) { return ({
                            instruction: policy.instruction,
                            constraints: policy.constraints,
                            successCriteria: policy.success_criteria,
                        }); }),
                    });
                    return [4 /*yield*/, llm.invoke([
                            new messages_1.SystemMessage(mainAgentPolicyPrompt_1.MAIN_AGENT_POLICY_SYSTEM_PROMPT),
                            new messages_1.HumanMessage(userPrompt),
                        ], {
                            signal: signal,
                        })];
                case 2:
                    response = _a.sent();
                    throwIfAborted(signal);
                    generatedPrompt = modelContentToString(response.content).trim();
                    if (!generatedPrompt) {
                        throw new Error("The language model returned an empty prompt.");
                    }
                    return [2 /*return*/, generatedPrompt];
            }
        });
    });
}
function generateMainAgentPolicyPrompt(userRequest_1) {
    return __awaiter(this, arguments, void 0, function (userRequest, options) {
        var normalizedUserRequest, threshold, maxConditions, tier, baseDirectory, userEmbedding, conditionFiles, matchedConditions, policyFiles, retrievedPolicies, mainAgentPrompt;
        var _a, _b, _c, _d, _e;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    normalizedUserRequest = userRequest.trim();
                    if (!normalizedUserRequest) {
                        throw new Error("userRequest cannot be empty.");
                    }
                    threshold = (_a = options.similarityThreshold) !== null && _a !== void 0 ? _a : DEFAULT_SIMILARITY_THRESHOLD;
                    maxConditions = (_b = options.maxMatchedConditions) !== null && _b !== void 0 ? _b : DEFAULT_MAX_MATCHED_CONDITIONS;
                    tier = (_c = options.llmTier) !== null && _c !== void 0 ? _c : DEFAULT_LLM_TIER;
                    baseDirectory = (_d = options.baseDirectory) !== null && _d !== void 0 ? _d : plugin_fs_1.BaseDirectory.AppData;
                    validateOptions(threshold, maxConditions);
                    throwIfAborted(options.abortSignal);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(normalizedUserRequest)];
                case 1:
                    userEmbedding = _f.sent();
                    throwIfAborted(options.abortSignal);
                    return [4 /*yield*/, readConditionFiles(baseDirectory, (_e = options.includeInactiveConditions) !== null && _e !== void 0 ? _e : false, options.abortSignal)];
                case 2:
                    conditionFiles = _f.sent();
                    matchedConditions = findMatchingConditions(userEmbedding, conditionFiles, threshold, maxConditions);
                    console.log("[Main agent policy] Matched conditions:", matchedConditions);
                    if (matchedConditions.length === 0) {
                        return [2 /*return*/, {
                                user_request: normalizedUserRequest,
                                user_embedding: userEmbedding,
                                matched_conditions: [],
                                retrieved_policies: [],
                                main_agent_prompt: null,
                                should_create_condition: true,
                                used_language_model: false,
                            }];
                    }
                    throwIfAborted(options.abortSignal);
                    return [4 /*yield*/, readPolicyFiles(baseDirectory, options.abortSignal)];
                case 3:
                    policyFiles = _f.sent();
                    retrievedPolicies = retrieveReferencedPolicies(matchedConditions, policyFiles);
                    console.log("[Main agent policy] Retrieved policies:", retrievedPolicies);
                    if (retrievedPolicies.length === 0) {
                        return [2 /*return*/, {
                                user_request: normalizedUserRequest,
                                user_embedding: userEmbedding,
                                matched_conditions: matchedConditions,
                                retrieved_policies: [],
                                main_agent_prompt: null,
                                should_create_condition: false,
                                used_language_model: false,
                            }];
                    }
                    throwIfAborted(options.abortSignal);
                    return [4 /*yield*/, generatePromptWithLLM(normalizedUserRequest, retrievedPolicies, tier, options.abortSignal)];
                case 4:
                    mainAgentPrompt = _f.sent();
                    console.log("[Main agent policy] Generated prompt:", mainAgentPrompt);
                    return [2 /*return*/, {
                            user_request: normalizedUserRequest,
                            user_embedding: userEmbedding,
                            matched_conditions: matchedConditions,
                            retrieved_policies: retrievedPolicies,
                            main_agent_prompt: mainAgentPrompt,
                            should_create_condition: false,
                            used_language_model: true,
                        }];
            }
        });
    });
}
