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
exports.createMemory = createMemory;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var analyzeMemoryRelationships_1 = require("./analyzeMemoryRelationships");
var enrichMemory_1 = require("./enrichMemory");
var findSimilarMemories_1 = require("./findSimilarMemories");
var evolveNeighborContext_1 = require("./evolveNeighborContext");
var MEMORY_DIRECTORY = "memory";
var MINIMUM_RELATIONSHIP_CONFIDENCE = 0.5;
var MEMORY_RELATIONSHIPS = [
    "COMPLEMENTS",
    "CONTRADICTS",
    "RELATED",
    "DUPLICATE",
];
var NON_LINK_RELATIONSHIP = "UNRELATED";
function createAbortError() {
    return new DOMException("The operation was cancelled.", "AbortError");
}
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw createAbortError();
    }
}
/**
 * Creates a memory from an atomic memory statement.
 *
 * Pipeline:
 * 1. Enrich the atomic memory.
 * 2. Find similar stored memories.
 * 3. Analyze relationships.
 * 4. Exclude UNRELATED analyses from graph links.
 * 5. Create valid memory links.
 * 6. Check whether an existing duplicate should be reused.
 * 7. Save the new memory only when no readable duplicate was reused.
 *
 * Duplicate behavior:
 * - The existing memory remains the canonical memory.
 * - The existing memory is updated by evolveNeighborContext.
 * - The prepared new memory is not saved.
 * - No duplicate file is deleted.
 * - No references are redirected.
 *
 * UNRELATED behavior:
 * - UNRELATED remains available in relationshipAnalyses for diagnostics.
 * - It is not treated as an unsupported relationship.
 * - It is not converted into a MemoryLink.
 * - It is never stored inside the links array.
 *
 * Cancellation is cooperative. A Tauri file operation that has already
 * started cannot necessarily be interrupted or rolled back.
 */
function createMemory(atomicMemory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var content, enrichedMemory, preparedMemoryId, similarMemories, relationshipAnalyses, initialLinks, preparedMemory, evolutionResult, memoryToSave, filePath, duplicateFileName, existingFilePath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    content = atomicMemory === null || atomicMemory === void 0 ? void 0 : atomicMemory.trim();
                    if (!content) {
                        throw new Error("Atomic memory content cannot be empty.");
                    }
                    return [4 /*yield*/, (0, enrichMemory_1.enrichAtomicMemory)(content, signal)];
                case 1:
                    enrichedMemory = _a.sent();
                    throwIfAborted(signal);
                    validatePreparedMemory(enrichedMemory);
                    preparedMemoryId = enrichedMemory.id.trim();
                    return [4 /*yield*/, (0, findSimilarMemories_1.findSimilarMemories)(enrichedMemory, signal)];
                case 2:
                    similarMemories = _a.sent();
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, analyzeMemoryRelationships_1.analyzeMemoryRelationships)(enrichedMemory, similarMemories, signal)];
                case 3:
                    relationshipAnalyses = _a.sent();
                    throwIfAborted(signal);
                    initialLinks = createMemoryLinks(relationshipAnalyses);
                    preparedMemory = __assign(__assign({}, enrichedMemory), { id: preparedMemoryId, links: initialLinks });
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, evolveNeighborContext_1.evolveNeighborContext)(preparedMemory, signal)];
                case 4:
                    evolutionResult = _a.sent();
                    throwIfAborted(signal);
                    if (!evolutionResult.shouldSaveNewMemory) return [3 /*break*/, 6];
                    memoryToSave = normalizeMemoryForSaving(evolutionResult.memory);
                    return [4 /*yield*/, saveMemoryFile(memoryToSave, signal)];
                case 5:
                    filePath = _a.sent();
                    throwIfAborted(signal);
                    console.log("[Memory creation] New memory saved.", {
                        memoryId: memoryToSave.id,
                        filePath: filePath,
                        similarMemoriesCount: similarMemories.length,
                        relationshipCount: relationshipAnalyses.length,
                        unrelatedRelationshipCount: countUnrelatedRelationships(relationshipAnalyses),
                        storedLinkCount: memoryToSave.links.length,
                    });
                    return [2 /*return*/, {
                            memory: memoryToSave,
                            wasNewMemorySaved: true,
                            action: "CREATED_NEW",
                            similarMemoriesCount: similarMemories.length,
                            relationshipAnalyses: relationshipAnalyses,
                            filePath: filePath,
                            finalMemoryId: memoryToSave.id,
                            preparedMemoryId: preparedMemoryId,
                            duplicate: null,
                        }];
                case 6:
                    duplicateFileName = validateMemoryFileName(evolutionResult.duplicateFileName);
                    existingFilePath = createMemoryFilePath(duplicateFileName);
                    console.log("[Memory creation] Existing duplicate memory reused. The prepared new memory was not saved.", {
                        preparedMemoryId: preparedMemoryId,
                        existingMemoryId: evolutionResult.duplicateMemoryId,
                        existingFileName: duplicateFileName,
                        existingFilePath: existingFilePath,
                        similarMemoriesCount: similarMemories.length,
                        relationshipCount: relationshipAnalyses.length,
                        unrelatedRelationshipCount: countUnrelatedRelationships(relationshipAnalyses),
                    });
                    return [2 /*return*/, {
                            memory: evolutionResult.memory,
                            wasNewMemorySaved: false,
                            action: "REUSED_EXISTING",
                            similarMemoriesCount: similarMemories.length,
                            relationshipAnalyses: relationshipAnalyses,
                            filePath: existingFilePath,
                            finalMemoryId: evolutionResult.duplicateMemoryId,
                            preparedMemoryId: preparedMemoryId,
                            duplicate: {
                                memoryId: evolutionResult.duplicateMemoryId,
                                fileName: duplicateFileName,
                            },
                        }];
            }
        });
    });
}
/**
 * Converts valid relationship analyses into memory links.
 *
 * A relationship is excluded when:
 * - It is UNRELATED.
 * - Its relationship type is unsupported.
 * - Its target ID is invalid.
 * - Its target file name is invalid.
 * - Its confidence is not finite.
 * - Its confidence is below the configured threshold.
 *
 * UNRELATED is a valid analysis result, but it does not represent
 * a graph edge and therefore must not be stored as a MemoryLink.
 *
 * Duplicate links are retained at this stage because
 * evolveNeighborContext needs them to detect existing memories.
 */
function createMemoryLinks(relationshipAnalyses) {
    var createdAt = new Date().toISOString();
    var links = [];
    for (var _i = 0, relationshipAnalyses_1 = relationshipAnalyses; _i < relationshipAnalyses_1.length; _i++) {
        var relationshipAnalysis = relationshipAnalyses_1[_i];
        var targetFileName = relationshipAnalysis.targetFileName, targetMemoryId = relationshipAnalysis.targetMemoryId, similarity = relationshipAnalysis.similarity, analysis = relationshipAnalysis.analysis;
        var relationship = analysis.relationship;
        /*
         * UNRELATED is a valid classification result, not an error.
         *
         * It is intentionally ignored without producing a warning because
         * unrelated memories must not create graph links.
         */
        if (isUnrelatedRelationship(relationship)) {
            continue;
        }
        if (!isMemoryRelationship(relationship)) {
            console.warn("[Memory creation] A relationship analysis was ignored because its relationship type is unsupported.", {
                relationship: relationship,
                targetMemoryId: targetMemoryId,
                targetFileName: targetFileName,
            });
            continue;
        }
        var confidence = Number(analysis.confidence);
        if (!Number.isFinite(confidence) ||
            confidence <
                MINIMUM_RELATIONSHIP_CONFIDENCE) {
            continue;
        }
        var normalizedTargetId = normalizeMemoryId(targetMemoryId);
        var normalizedTargetFileName = getSafeMemoryFileName(targetFileName);
        if (!normalizedTargetId ||
            !normalizedTargetFileName) {
            console.warn("[Memory creation] A relationship analysis was ignored because its target is invalid.", {
                targetMemoryId: targetMemoryId,
                targetFileName: targetFileName,
            });
            continue;
        }
        var reason = typeof analysis.reason ===
            "string"
            ? analysis.reason.trim()
            : "";
        links.push({
            targetId: normalizedTargetId,
            targetFileName: normalizedTargetFileName,
            relationship: relationship,
            similarity: normalizeScore(similarity),
            confidence: normalizeScore(confidence),
            reason: reason,
            createdAt: createdAt,
        });
    }
    return mergeCreatedLinks(links);
}
/**
 * Checks whether an analysis result means that no graph link should
 * be created.
 *
 * The comparison is case-insensitive and ignores surrounding whitespace
 * so values such as " unrelated " are also handled safely.
 */
function isUnrelatedRelationship(relationship) {
    return (typeof relationship ===
        "string" &&
        relationship
            .trim()
            .toUpperCase() ===
            NON_LINK_RELATIONSHIP);
}
/**
 * Counts UNRELATED analyses for diagnostic logging.
 *
 * These analyses remain in relationshipAnalyses but never enter
 * the stored links array.
 */
function countUnrelatedRelationships(relationshipAnalyses) {
    var count = 0;
    for (var _i = 0, relationshipAnalyses_2 = relationshipAnalyses; _i < relationshipAnalyses_2.length; _i++) {
        var relationshipAnalysis = relationshipAnalyses_2[_i];
        if (isUnrelatedRelationship(relationshipAnalysis
            .analysis
            .relationship)) {
            count += 1;
        }
    }
    return count;
}
/**
 * Removes duplicate relationship links that point to the same target.
 *
 * The strongest link is selected by:
 * 1. Relationship priority.
 * 2. Similarity.
 * 3. Confidence.
 */
function mergeCreatedLinks(links) {
    var linksByTarget = new Map();
    for (var _i = 0, links_1 = links; _i < links_1.length; _i++) {
        var link = links_1[_i];
        var targetKey = "".concat(link.targetId, "::").concat(link.targetFileName);
        var existingLink = linksByTarget.get(targetKey);
        if (!existingLink ||
            shouldReplaceLink(link, existingLink)) {
            linksByTarget.set(targetKey, link);
        }
    }
    return __spreadArray([], linksByTarget.values(), true).sort(compareMemoryLinks);
}
function shouldReplaceLink(candidate, existing) {
    var candidatePriority = getRelationshipPriority(candidate.relationship);
    var existingPriority = getRelationshipPriority(existing.relationship);
    if (candidatePriority !==
        existingPriority) {
        return (candidatePriority >
            existingPriority);
    }
    if (candidate.similarity !==
        existing.similarity) {
        return (candidate.similarity >
            existing.similarity);
    }
    return (candidate.confidence >
        existing.confidence);
}
function getRelationshipPriority(relationship) {
    switch (relationship) {
        case "DUPLICATE":
            return 4;
        case "CONTRADICTS":
            return 3;
        case "COMPLEMENTS":
            return 2;
        case "RELATED":
            return 1;
        default:
            return 0;
    }
}
function compareMemoryLinks(first, second) {
    var relationshipPriorityDifference = getRelationshipPriority(second.relationship) -
        getRelationshipPriority(first.relationship);
    if (relationshipPriorityDifference !== 0) {
        return relationshipPriorityDifference;
    }
    var similarityDifference = second.similarity -
        first.similarity;
    if (similarityDifference !== 0) {
        return similarityDifference;
    }
    var confidenceDifference = second.confidence -
        first.confidence;
    if (confidenceDifference !== 0) {
        return confidenceDifference;
    }
    return first.targetId.localeCompare(second.targetId);
}
/**
 * Checks whether a relationship can be stored as a memory link.
 *
 * UNRELATED intentionally returns false because it is not included
 * in MEMORY_RELATIONSHIPS.
 */
function isMemoryRelationship(relationship) {
    return (typeof relationship ===
        "string" &&
        MEMORY_RELATIONSHIPS.includes(relationship));
}
/**
 * Normalizes a numeric similarity or confidence score.
 *
 * Invalid values become zero. Values outside the zero-to-one range
 * are clamped to keep stored memory files consistent.
 */
function normalizeScore(value) {
    var numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }
    return Math.min(1, Math.max(0, numericValue));
}
function normalizeMemoryId(value) {
    if (typeof value !== "string") {
        return null;
    }
    var normalizedValue = value.trim();
    if (!normalizedValue) {
        return null;
    }
    if (!isSafeMemoryId(normalizedValue)) {
        return null;
    }
    return normalizedValue;
}
/**
 * Validates the memory created by enrichAtomicMemory before any
 * graph or file operation begins.
 */
function validatePreparedMemory(memory) {
    if (!memory ||
        typeof memory !== "object") {
        throw new Error("The enrichment stage returned an invalid memory.");
    }
    if (typeof memory.id !== "string" ||
        !memory.id.trim()) {
        throw new Error("The enriched memory has no valid ID.");
    }
    validateMemoryId(memory.id);
}
/**
 * Ensures the memory has a valid ID and a valid links array before saving.
 *
 * This provides a second protection layer. Even if an invalid or
 * UNRELATED link somehow enters memory.links, it will not be saved.
 */
function normalizeMemoryForSaving(memory) {
    if (!memory ||
        typeof memory !== "object") {
        throw new Error("The memory cannot be saved because it is invalid.");
    }
    validateMemoryId(memory.id);
    var memoryId = memory.id.trim();
    var memoryFileName = createMemoryFileName(memoryId);
    var links = Array.isArray(memory.links)
        ? mergeCreatedLinks(memory.links.filter(function (link) {
            return isValidLinkForSaving(link, memoryId, memoryFileName);
        }))
        : [];
    return __assign(__assign({}, memory), { id: memoryId, links: links });
}
function isValidLinkForSaving(link, memoryId, memoryFileName) {
    if (!link ||
        typeof link !== "object") {
        return false;
    }
    /*
     * This explicitly blocks UNRELATED if malformed external data
     * somehow reaches the final saving stage.
     */
    if (isUnrelatedRelationship(link.relationship)) {
        return false;
    }
    if (!isMemoryRelationship(link.relationship)) {
        return false;
    }
    var targetId = normalizeMemoryId(link.targetId);
    var targetFileName = getSafeMemoryFileName(link.targetFileName);
    if (!targetId ||
        !targetFileName) {
        return false;
    }
    var confidence = Number(link.confidence);
    if (!Number.isFinite(confidence) ||
        confidence <
            MINIMUM_RELATIONSHIP_CONFIDENCE) {
        return false;
    }
    var pointsToItself = targetId === memoryId ||
        targetFileName ===
            memoryFileName;
    return !pointsToItself;
}
/**
 * Saves a new memory as memory/{memory.id}.json inside AppData.
 *
 * This function must only be called when evolveNeighborContext returns
 * shouldSaveNewMemory as true.
 */
function saveMemoryFile(memory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var fileName, filePath, serializedMemory, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    validateMemoryId(memory.id);
                    return [4 /*yield*/, ensureMemoryDirectoryExists(signal)];
                case 1:
                    _a.sent();
                    throwIfAborted(signal);
                    fileName = createMemoryFileName(memory.id);
                    filePath = createMemoryFilePath(fileName);
                    serializedMemory = JSON.stringify(memory, null, 2);
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, serializedMemory, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _a.sent();
                    console.error("[Memory creation] Failed to save the new memory file.", {
                        memoryId: memory.id,
                        filePath: filePath,
                        error: error_1,
                    });
                    throw new Error("Failed to save memory \"".concat(memory.id, "\": ").concat(getErrorMessage(error_1)));
                case 5:
                    throwIfAborted(signal);
                    return [2 /*return*/, filePath];
            }
        });
    });
}
/**
 * Creates the memory directory when it does not already exist.
 */
function ensureMemoryDirectoryExists(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var memoryDirectoryExists, error_2, error_3, directoryNowExists, existsError_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    memoryDirectoryExists =
                        _a.sent();
                    return [3 /*break*/, 4];
                case 3:
                    error_2 = _a.sent();
                    throw new Error("Failed to check the memory directory: ".concat(getErrorMessage(error_2)));
                case 4:
                    throwIfAborted(signal);
                    if (memoryDirectoryExists) {
                        return [2 /*return*/];
                    }
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 12]);
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                            recursive: true,
                        })];
                case 6:
                    _a.sent();
                    return [3 /*break*/, 12];
                case 7:
                    error_3 = _a.sent();
                    /*
                     * Another concurrent operation may have created the directory after
                     * the exists check. Check it once more before treating mkdir as failed.
                     */
                    throwIfAborted(signal);
                    directoryNowExists = void 0;
                    _a.label = 8;
                case 8:
                    _a.trys.push([8, 10, , 11]);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 9:
                    directoryNowExists =
                        _a.sent();
                    return [3 /*break*/, 11];
                case 10:
                    existsError_1 = _a.sent();
                    throw new Error("Failed to create or recheck the memory directory: ".concat(getErrorMessage(existsError_1)));
                case 11:
                    throwIfAborted(signal);
                    if (!directoryNowExists) {
                        throw new Error("Failed to create the memory directory: ".concat(getErrorMessage(error_3)));
                    }
                    return [3 /*break*/, 12];
                case 12:
                    throwIfAborted(signal);
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Validates an internally generated memory ID.
 *
 * IDs are not silently modified because changing an ID here would make
 * memory IDs and link target file names inconsistent.
 */
function validateMemoryId(memoryId) {
    if (typeof memoryId !== "string" ||
        !memoryId.trim()) {
        throw new Error("Memory ID is invalid.");
    }
    var normalizedMemoryId = memoryId.trim();
    if (!isSafeMemoryId(normalizedMemoryId)) {
        throw new Error("Memory ID contains unsupported characters: \"".concat(normalizedMemoryId, "\"."));
    }
}
function isSafeMemoryId(memoryId) {
    return /^[a-zA-Z0-9_-]+$/.test(memoryId);
}
function createMemoryFileName(memoryId) {
    validateMemoryId(memoryId);
    return "".concat(memoryId.trim(), ".json");
}
function validateMemoryFileName(fileName) {
    var safeFileName = getSafeMemoryFileName(fileName);
    if (!safeFileName) {
        throw new Error("Memory file name is invalid: \"".concat(fileName, "\"."));
    }
    return safeFileName;
}
function getSafeMemoryFileName(fileName) {
    if (typeof fileName !== "string" ||
        !fileName.trim()) {
        return null;
    }
    var normalizedFileName = fileName.trim();
    if (normalizedFileName.includes("/") ||
        normalizedFileName.includes("\\")) {
        return null;
    }
    if (!/^[a-zA-Z0-9_-]+\.json$/.test(normalizedFileName)) {
        return null;
    }
    return normalizedFileName;
}
function createMemoryFilePath(fileName) {
    var safeFileName = validateMemoryFileName(fileName);
    return "".concat(MEMORY_DIRECTORY, "/").concat(safeFileName);
}
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    try {
        return JSON.stringify(error);
    }
    catch (_a) {
        return String(error);
    }
}
