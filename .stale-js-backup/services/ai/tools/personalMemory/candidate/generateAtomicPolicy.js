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
exports.generateAtomicPolicy = generateAtomicPolicy;
var prompts_1 = require("@langchain/core/prompts");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var atomicPolicySchema_1 = require("./atomicPolicySchema");
var atomicPolicyPrompt_1 = require("./atomicPolicyPrompt");
var POLICY_DIRECTORY_PATH = "feedback-memories/policy";
var POLICY_SIMILARITY_THRESHOLD = 0.8;
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("Atomic policy generation was aborted.", "AbortError");
    }
}
function getErrorMessage(error) {
    return error instanceof Error
        ? error.message
        : String(error);
}
function isAbortError(error) {
    return (error instanceof DOMException &&
        error.name === "AbortError");
}
function normalizeAtomicPolicies(atomicPolicies) {
    var uniquePolicies = new Map();
    for (var _i = 0, atomicPolicies_1 = atomicPolicies; _i < atomicPolicies_1.length; _i++) {
        var atomicPolicy = atomicPolicies_1[_i];
        var normalizedPolicy = atomicPolicy
            .trim()
            .replace(/\s+/g, " ");
        if (!normalizedPolicy) {
            continue;
        }
        var comparisonKey = normalizedPolicy.toLocaleLowerCase();
        if (!uniquePolicies.has(comparisonKey)) {
            uniquePolicies.set(comparisonKey, normalizedPolicy);
        }
    }
    return Array.from(uniquePolicies.values());
}
function isJsonFile(fileName) {
    return fileName.toLowerCase().endsWith(".json");
}
function joinRelativePath(parentPath, childName) {
    var normalizedParentPath = parentPath.replace(/\/+$/, "");
    var normalizedChildName = childName.replace(/^\/+/, "");
    return "".concat(normalizedParentPath, "/").concat(normalizedChildName);
}
function isRecord(value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value));
}
function isValidEmbedding(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.every(function (item) {
            return typeof item === "number" &&
                Number.isFinite(item);
        }));
}
function getStringValue(record, keys) {
    for (var _i = 0, keys_1 = keys; _i < keys_1.length; _i++) {
        var key = keys_1[_i];
        var value = record[key];
        if (typeof value === "string" &&
            value.trim().length > 0) {
            return value.trim();
        }
    }
    return null;
}
function getEmbeddingValue(record) {
    var directCandidates = [
        record.embedding,
        record.policyEmbedding,
        record.policy_embedding,
        record.combined_embedding,
    ];
    for (var _i = 0, directCandidates_1 = directCandidates; _i < directCandidates_1.length; _i++) {
        var candidate = directCandidates_1[_i];
        if (isValidEmbedding(candidate)) {
            return candidate;
        }
    }
    var nestedCandidates = [
        record.policy,
        record.data,
        record.memory,
    ];
    for (var _a = 0, nestedCandidates_1 = nestedCandidates; _a < nestedCandidates_1.length; _a++) {
        var candidate = nestedCandidates_1[_a];
        if (!isRecord(candidate)) {
            continue;
        }
        var nestedEmbedding = getEmbeddingValue(candidate);
        if (nestedEmbedding) {
            return nestedEmbedding;
        }
    }
    return null;
}
function parseStoredPolicyEmbedding(value) {
    if (!isRecord(value)) {
        return null;
    }
    var directId = getStringValue(value, [
        "id",
        "policyId",
        "policy_id",
    ]);
    var directEmbedding = getEmbeddingValue(value);
    if (directId && directEmbedding) {
        return {
            id: directId,
            embedding: directEmbedding,
        };
    }
    var nestedCandidates = [
        value.policy,
        value.data,
        value.memory,
    ];
    for (var _i = 0, nestedCandidates_2 = nestedCandidates; _i < nestedCandidates_2.length; _i++) {
        var candidate = nestedCandidates_2[_i];
        if (!isRecord(candidate)) {
            continue;
        }
        var nestedPolicy = parseStoredPolicyEmbedding(candidate);
        if (nestedPolicy) {
            return nestedPolicy;
        }
    }
    return null;
}
function extractStoredPolicyEmbeddings(value) {
    if (Array.isArray(value)) {
        return value.flatMap(function (item) {
            return extractStoredPolicyEmbeddings(item);
        });
    }
    if (!isRecord(value)) {
        return [];
    }
    var directPolicy = parseStoredPolicyEmbedding(value);
    if (directPolicy) {
        return [directPolicy];
    }
    var collectionKeys = [
        "policies",
        "atomic_policies",
        "items",
        "memories",
    ];
    for (var _i = 0, collectionKeys_1 = collectionKeys; _i < collectionKeys_1.length; _i++) {
        var key = collectionKeys_1[_i];
        var collection = value[key];
        if (Array.isArray(collection)) {
            return collection.flatMap(function (item) {
                return extractStoredPolicyEmbeddings(item);
            });
        }
    }
    return [];
}
/**
 * Recursively collects JSON files from the policy directory.
 * Every path is relative to BaseDirectory.AppData.
 */
function collectJsonFilePaths(directoryPath, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists, error_1, entries, error_2, filePaths, _i, entries_1, entry, entryPath, nestedFilePaths;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(directoryPath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    directoryExists = _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    throw new Error("Failed to check policy directory \"".concat(directoryPath, "\": ").concat(getErrorMessage(error_1)));
                case 4:
                    throwIfAborted(signal);
                    if (!directoryExists) {
                        return [2 /*return*/, []];
                    }
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(directoryPath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 6:
                    entries = _a.sent();
                    return [3 /*break*/, 8];
                case 7:
                    error_2 = _a.sent();
                    throw new Error("Failed to read policy directory \"".concat(directoryPath, "\": ").concat(getErrorMessage(error_2)));
                case 8:
                    filePaths = [];
                    _i = 0, entries_1 = entries;
                    _a.label = 9;
                case 9:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 13];
                    entry = entries_1[_i];
                    throwIfAborted(signal);
                    entryPath = joinRelativePath(directoryPath, entry.name);
                    if (!entry.isDirectory) return [3 /*break*/, 11];
                    return [4 /*yield*/, collectJsonFilePaths(entryPath, signal)];
                case 10:
                    nestedFilePaths = _a.sent();
                    filePaths.push.apply(filePaths, nestedFilePaths);
                    return [3 /*break*/, 12];
                case 11:
                    if (entry.isFile &&
                        isJsonFile(entry.name)) {
                        filePaths.push(entryPath);
                    }
                    _a.label = 12;
                case 12:
                    _i++;
                    return [3 /*break*/, 9];
                case 13: return [2 /*return*/, filePaths];
            }
        });
    });
}
/**
 * Reads one policy file and extracts its policy embeddings.
 * Invalid files are skipped without interrupting other files.
 */
function readStoredPoliciesFromFile(filePath, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var fileContent, parsedFile, storedPolicies, error_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    fileContent = _a.sent();
                    throwIfAborted(signal);
                    parsedFile = JSON.parse(fileContent);
                    storedPolicies = extractStoredPolicyEmbeddings(parsedFile);
                    if (storedPolicies.length === 0) {
                        console.warn("Skipping policy file without a valid policy ID and embedding: ".concat(filePath));
                    }
                    return [2 /*return*/, storedPolicies];
                case 3:
                    error_3 = _a.sent();
                    if (isAbortError(error_3)) {
                        throw error_3;
                    }
                    console.warn("Failed to process policy file \"".concat(filePath, "\":"), error_3);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
/**
 * Loads all unique policy embeddings stored in AppData.
 */
function readStoredPolicyEmbeddings(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var filePaths, loadedPolicyGroups, policiesById, _i, loadedPolicyGroups_1, storedPolicies, _a, storedPolicies_1, storedPolicy;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, collectJsonFilePaths(POLICY_DIRECTORY_PATH, signal)];
                case 1:
                    filePaths = _b.sent();
                    if (filePaths.length === 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, Promise.all(filePaths.map(function (filePath) {
                            return readStoredPoliciesFromFile(filePath, signal);
                        }))];
                case 2:
                    loadedPolicyGroups = _b.sent();
                    throwIfAborted(signal);
                    policiesById = new Map();
                    for (_i = 0, loadedPolicyGroups_1 = loadedPolicyGroups; _i < loadedPolicyGroups_1.length; _i++) {
                        storedPolicies = loadedPolicyGroups_1[_i];
                        for (_a = 0, storedPolicies_1 = storedPolicies; _a < storedPolicies_1.length; _a++) {
                            storedPolicy = storedPolicies_1[_a];
                            if (!policiesById.has(storedPolicy.id)) {
                                policiesById.set(storedPolicy.id, storedPolicy);
                            }
                        }
                    }
                    return [2 /*return*/, Array.from(policiesById.values())];
            }
        });
    });
}
/**
 * Keeps only stored embeddings with the same dimensions as
 * the generated policy embedding.
 */
function filterCompatibleEmbeddings(sourceEmbedding, storedEmbeddings) {
    return storedEmbeddings.filter(function (storedPolicy) {
        return storedPolicy.embedding.length ===
            sourceEmbedding.length;
    });
}
/**
 * Embeds each generated policy and returns either the best
 * matching stored policy ID or false.
 */
function findPolicyMatches(atomicPolicies, storedPolicyEmbeddings, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var matchedPolicies, _i, atomicPolicies_2, atomicPolicy, generatedEmbedding, compatibleStoredEmbeddings, comparison, bestMatch;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    matchedPolicies = [];
                    _i = 0, atomicPolicies_2 = atomicPolicies;
                    _a.label = 1;
                case 1:
                    if (!(_i < atomicPolicies_2.length)) return [3 /*break*/, 4];
                    atomicPolicy = atomicPolicies_2[_i];
                    throwIfAborted(signal);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(atomicPolicy)];
                case 2:
                    generatedEmbedding = _a.sent();
                    throwIfAborted(signal);
                    compatibleStoredEmbeddings = filterCompatibleEmbeddings(generatedEmbedding, storedPolicyEmbeddings);
                    if (compatibleStoredEmbeddings.length === 0) {
                        matchedPolicies.push({
                            policy: atomicPolicy,
                            policy_id: false,
                        });
                        return [3 /*break*/, 3];
                    }
                    comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(generatedEmbedding, compatibleStoredEmbeddings);
                    bestMatch = comparison.bestMatch;
                    if (bestMatch !== null &&
                        bestMatch.score >
                            POLICY_SIMILARITY_THRESHOLD) {
                        matchedPolicies.push({
                            policy: atomicPolicy,
                            policy_id: bestMatch.id,
                        });
                        return [3 /*break*/, 3];
                    }
                    matchedPolicies.push({
                        policy: atomicPolicy,
                        policy_id: false,
                    });
                    _a.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, matchedPolicies];
            }
        });
    });
}
/**
 * Generates reusable atomic policies and matches each policy
 * against policy embeddings stored in AppData.
 */
function generateAtomicPolicy(input) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, structuredLlm, prompt, chain, response, validationResult, normalizedPolicies, storedPolicyEmbeddings, policyMatches;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(input.signal);
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    llm = _a.sent();
                    throwIfAborted(input.signal);
                    structuredLlm = llm.withStructuredOutput(atomicPolicySchema_1.AtomicPolicyModelResultSchema);
                    prompt = prompts_1.ChatPromptTemplate.fromMessages([
                        [
                            "system",
                            atomicPolicyPrompt_1.ATOMIC_POLICY_SYSTEM_PROMPT,
                        ],
                        [
                            "human",
                            "{userPrompt}",
                        ],
                    ]);
                    chain = prompt.pipe(structuredLlm);
                    return [4 /*yield*/, chain.invoke({
                            userPrompt: (0, atomicPolicyPrompt_1.buildAtomicPolicyUserPrompt)(input),
                        }, {
                            signal: input.signal,
                        })];
                case 2:
                    response = _a.sent();
                    throwIfAborted(input.signal);
                    validationResult = atomicPolicySchema_1.AtomicPolicyModelResultSchema.safeParse(response);
                    if (!validationResult.success) {
                        throw new Error("Atomic policy output validation failed: ".concat(validationResult.error.message));
                    }
                    normalizedPolicies = normalizeAtomicPolicies(validationResult.data.atomic_policies);
                    if (normalizedPolicies.length === 0) {
                        return [2 /*return*/, {
                                atomic_policies: [],
                            }];
                    }
                    return [4 /*yield*/, readStoredPolicyEmbeddings(input.signal)];
                case 3:
                    storedPolicyEmbeddings = _a.sent();
                    throwIfAborted(input.signal);
                    return [4 /*yield*/, findPolicyMatches(normalizedPolicies, storedPolicyEmbeddings, input.signal)];
                case 4:
                    policyMatches = _a.sent();
                    throwIfAborted(input.signal);
                    return [2 /*return*/, {
                            atomic_policies: policyMatches,
                        }];
            }
        });
    });
}
