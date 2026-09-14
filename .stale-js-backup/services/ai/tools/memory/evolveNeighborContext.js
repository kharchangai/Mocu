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
exports.evolveNeighborContext = evolveNeighborContext;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var MEMORY_DIRECTORY = "memory";
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("The operation was cancelled.", "AbortError");
    }
}
function isAbortError(error) {
    return (error instanceof DOMException &&
        error.name === "AbortError");
}
/**
 * Prepares the memory graph for a new memory.
 *
 * If no readable duplicate exists, the caller must save the new memory.
 *
 * If a readable duplicate exists:
 * - The existing memory remains the canonical memory.
 * - The new memory must not be saved.
 * - No existing memory file is deleted.
 * - No references are redirected.
 * - The existing memory metadata is updated.
 * - Useful non-duplicate links are transferred to the existing memory.
 *
 * The caller must always inspect shouldSaveNewMemory before saving the
 * originally prepared memory.
 */
function evolveNeighborContext(memoryToSave, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var originalLinks, duplicateLinks, nonDuplicateLinks, duplicateCandidates, canonicalCandidate, canonicalMemory, canonicalFileName, duplicateIds, duplicateFileNames, transferredLinks;
        var _a, _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    throwIfAborted(signal);
                    validateMemoryId(memoryToSave.id);
                    originalLinks = Array.isArray(memoryToSave.links)
                        ? memoryToSave.links
                        : [];
                    duplicateLinks = originalLinks.filter(function (link) {
                        return link.relationship === "DUPLICATE" &&
                            isValidMemoryLink(link);
                    });
                    nonDuplicateLinks = originalLinks.filter(function (link) {
                        return link.relationship !== "DUPLICATE" &&
                            isValidMemoryLink(link);
                    });
                    if (duplicateLinks.length === 0) {
                        return [2 /*return*/, prepareNewMemoryResult(memoryToSave, nonDuplicateLinks)];
                    }
                    return [4 /*yield*/, readDuplicateCandidates(duplicateLinks, signal)];
                case 1:
                    duplicateCandidates = _c.sent();
                    throwIfAborted(signal);
                    if (duplicateCandidates.length === 0) {
                        console.warn("[Memory] Duplicate relationships were found, but no readable duplicate memory file was available. The new memory will be saved.");
                        return [2 /*return*/, prepareNewMemoryResult(memoryToSave, nonDuplicateLinks)];
                    }
                    canonicalCandidate = selectCanonicalDuplicate(duplicateCandidates);
                    canonicalMemory = canonicalCandidate.memory;
                    canonicalFileName = canonicalCandidate.fileName;
                    assertMemoryMatchesFileName(canonicalMemory, canonicalFileName);
                    duplicateIds = collectDuplicateIds(duplicateCandidates);
                    duplicateFileNames = collectDuplicateFileNames(duplicateCandidates);
                    transferredLinks = collectTransferableLinks(memoryToSave, duplicateCandidates, canonicalMemory, canonicalFileName, duplicateIds, duplicateFileNames);
                    canonicalMemory.links =
                        sanitizeLinksForMemory(__spreadArray(__spreadArray([], ((_a = canonicalMemory.links) !== null && _a !== void 0 ? _a : []), true), transferredLinks, true), canonicalMemory.id, canonicalFileName);
                    updateDuplicateMetadata(canonicalMemory);
                    throwIfAborted(signal);
                    return [4 /*yield*/, writeMemoryFile(canonicalFileName, canonicalMemory, signal)];
                case 2:
                    _c.sent();
                    throwIfAborted(signal);
                    console.log("[Memory] Existing duplicate memory reused.", {
                        existingMemoryId: canonicalMemory.id,
                        existingFileName: canonicalFileName,
                        ignoredNewMemoryId: memoryToSave.id,
                        repetitionCount: canonicalMemory.repetitionCount,
                        lastSeenAt: canonicalMemory.lastSeenAt,
                    });
                    return [2 /*return*/, {
                            action: "REUSE_EXISTING",
                            shouldSaveNewMemory: false,
                            memory: canonicalMemory,
                            links: (_b = canonicalMemory.links) !== null && _b !== void 0 ? _b : [],
                            duplicateMemoryId: canonicalMemory.id,
                            duplicateFileName: canonicalFileName,
                        }];
            }
        });
    });
}
function prepareNewMemoryResult(memoryToSave, links) {
    var fileName = createMemoryFileName(memoryToSave.id);
    var finalLinks = sanitizeLinksForMemory(links, memoryToSave.id, fileName);
    memoryToSave.links = finalLinks;
    return {
        action: "SAVE_NEW",
        shouldSaveNewMemory: true,
        memory: memoryToSave,
        links: finalLinks,
        duplicateMemoryId: null,
        duplicateFileName: null,
    };
}
function readDuplicateCandidates(duplicateLinks, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var strongestLinkByFileName, _i, duplicateLinks_1, link, safeFileName, existingLink, candidates, _a, _b, _c, fileName, link, memory, error_1;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    throwIfAborted(signal);
                    strongestLinkByFileName = new Map();
                    for (_i = 0, duplicateLinks_1 = duplicateLinks; _i < duplicateLinks_1.length; _i++) {
                        link = duplicateLinks_1[_i];
                        throwIfAborted(signal);
                        safeFileName = getSafeMemoryFileName(link.targetFileName);
                        if (!safeFileName) {
                            console.warn("[Memory] A duplicate link with an invalid file name was ignored.", {
                                targetId: link.targetId,
                                targetFileName: link.targetFileName,
                            });
                            continue;
                        }
                        existingLink = strongestLinkByFileName.get(safeFileName);
                        if (!existingLink ||
                            isLinkStronger(link, existingLink)) {
                            strongestLinkByFileName.set(safeFileName, __assign(__assign({}, link), { targetFileName: safeFileName }));
                        }
                    }
                    candidates = [];
                    _a = 0, _b = strongestLinkByFileName.entries();
                    _d.label = 1;
                case 1:
                    if (!(_a < _b.length)) return [3 /*break*/, 6];
                    _c = _b[_a], fileName = _c[0], link = _c[1];
                    throwIfAborted(signal);
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, readMemoryFile(fileName, signal)];
                case 3:
                    memory = _d.sent();
                    throwIfAborted(signal);
                    if (link.targetId !== memory.id) {
                        console.error("[Memory] The duplicate link ID does not match the memory ID stored in the target file.", {
                            fileName: fileName,
                            linkTargetId: link.targetId,
                            storedMemoryId: memory.id,
                        });
                        return [3 /*break*/, 5];
                    }
                    candidates.push({
                        link: link,
                        memory: memory,
                        fileName: fileName,
                    });
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _d.sent();
                    if (isAbortError(error_1)) {
                        throw error_1;
                    }
                    console.error("[Memory] Failed to read duplicate memory file \"".concat(fileName, "\"."), error_1);
                    return [3 /*break*/, 5];
                case 5:
                    _a++;
                    return [3 /*break*/, 1];
                case 6: return [2 /*return*/, candidates];
            }
        });
    });
}
function selectCanonicalDuplicate(candidates) {
    if (candidates.length === 0) {
        throw new Error("No duplicate candidate was provided.");
    }
    var sortedCandidates = __spreadArray([], candidates, true).sort(function (first, second) {
        var similarityDifference = normalizeNumber(second.link.similarity) -
            normalizeNumber(first.link.similarity);
        if (similarityDifference !== 0) {
            return similarityDifference;
        }
        var confidenceDifference = normalizeNumber(second.link.confidence) -
            normalizeNumber(first.link.confidence);
        if (confidenceDifference !== 0) {
            return confidenceDifference;
        }
        return first.fileName.localeCompare(second.fileName);
    });
    return sortedCandidates[0];
}
function collectDuplicateIds(candidates) {
    var ids = new Set();
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var candidate = candidates_1[_i];
        if (candidate.memory.id) {
            ids.add(candidate.memory.id);
        }
        if (candidate.link.targetId) {
            ids.add(candidate.link.targetId);
        }
    }
    return ids;
}
function collectDuplicateFileNames(candidates) {
    var fileNames = new Set();
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var candidate = candidates_2[_i];
        fileNames.add(candidate.fileName);
        var safeTargetFileName = getSafeMemoryFileName(candidate.link.targetFileName);
        if (safeTargetFileName) {
            fileNames.add(safeTargetFileName);
        }
    }
    return fileNames;
}
function collectTransferableLinks(newMemory, duplicateCandidates, canonicalMemory, canonicalFileName, duplicateIds, duplicateFileNames) {
    var _a, _b;
    var transferredLinks = [];
    var newMemoryFileName = createMemoryFileName(newMemory.id);
    for (var _i = 0, _c = (_a = newMemory.links) !== null && _a !== void 0 ? _a : []; _i < _c.length; _i++) {
        var link = _c[_i];
        if (shouldTransferLink(link, canonicalMemory.id, canonicalFileName, newMemory.id, newMemoryFileName, duplicateIds, duplicateFileNames)) {
            transferredLinks.push(link);
        }
    }
    for (var _d = 0, duplicateCandidates_1 = duplicateCandidates; _d < duplicateCandidates_1.length; _d++) {
        var candidate = duplicateCandidates_1[_d];
        var isCanonicalCandidate = candidate.memory.id ===
            canonicalMemory.id &&
            candidate.fileName ===
                canonicalFileName;
        if (isCanonicalCandidate) {
            continue;
        }
        for (var _e = 0, _f = (_b = candidate.memory.links) !== null && _b !== void 0 ? _b : []; _e < _f.length; _e++) {
            var link = _f[_e];
            if (shouldTransferLink(link, canonicalMemory.id, canonicalFileName, candidate.memory.id, candidate.fileName, duplicateIds, duplicateFileNames)) {
                transferredLinks.push(link);
            }
        }
    }
    return transferredLinks;
}
function shouldTransferLink(link, canonicalMemoryId, canonicalFileName, sourceMemoryId, sourceFileName, duplicateIds, duplicateFileNames) {
    if (!isValidMemoryLink(link)) {
        return false;
    }
    if (link.relationship === "DUPLICATE") {
        return false;
    }
    var safeTargetFileName = getSafeMemoryFileName(link.targetFileName);
    if (!safeTargetFileName) {
        return false;
    }
    var pointsToCanonicalMemory = link.targetId ===
        canonicalMemoryId ||
        safeTargetFileName ===
            canonicalFileName;
    var pointsToSourceMemory = link.targetId === sourceMemoryId ||
        safeTargetFileName ===
            sourceFileName;
    var pointsToDuplicateMemory = duplicateIds.has(link.targetId) ||
        duplicateFileNames.has(safeTargetFileName);
    return (!pointsToCanonicalMemory &&
        !pointsToSourceMemory &&
        !pointsToDuplicateMemory);
}
function updateDuplicateMetadata(memory) {
    var currentRepetitionCount = getCurrentRepetitionCount(memory.repetitionCount);
    memory.repetitionCount =
        currentRepetitionCount + 1;
    memory.lastSeenAt =
        new Date().toISOString();
}
function getCurrentRepetitionCount(value) {
    if (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 1) {
        return 1;
    }
    return Math.floor(value);
}
function sanitizeLinksForMemory(links, memoryId, memoryFileName) {
    var sanitizedLinks = links.filter(function (link) {
        if (!isValidMemoryLink(link)) {
            return false;
        }
        if (link.relationship ===
            "DUPLICATE") {
            return false;
        }
        var safeTargetFileName = getSafeMemoryFileName(link.targetFileName);
        if (!safeTargetFileName) {
            return false;
        }
        var pointsToItself = link.targetId === memoryId ||
            safeTargetFileName ===
                memoryFileName;
        return !pointsToItself;
    });
    return mergeMemoryLinks(sanitizedLinks);
}
function mergeMemoryLinks(links) {
    var linksByTarget = new Map();
    for (var _i = 0, links_1 = links; _i < links_1.length; _i++) {
        var link = links_1[_i];
        if (!isValidMemoryLink(link)) {
            continue;
        }
        var safeTargetFileName = getSafeMemoryFileName(link.targetFileName);
        if (!safeTargetFileName) {
            continue;
        }
        var normalizedLink = __assign(__assign({}, link), { targetId: link.targetId.trim(), targetFileName: safeTargetFileName, similarity: normalizeNumber(link.similarity), confidence: normalizeNumber(link.confidence) });
        var targetKey = "".concat(normalizedLink.targetId, "::") +
            normalizedLink.targetFileName;
        var existingLink = linksByTarget.get(targetKey);
        if (!existingLink ||
            isLinkStronger(normalizedLink, existingLink)) {
            linksByTarget.set(targetKey, normalizedLink);
        }
    }
    return __spreadArray([], linksByTarget.values(), true).sort(compareMemoryLinks);
}
function isLinkStronger(candidate, existing) {
    var candidateSimilarity = normalizeNumber(candidate.similarity);
    var existingSimilarity = normalizeNumber(existing.similarity);
    if (candidateSimilarity !==
        existingSimilarity) {
        return (candidateSimilarity >
            existingSimilarity);
    }
    var candidateConfidence = normalizeNumber(candidate.confidence);
    var existingConfidence = normalizeNumber(existing.confidence);
    if (candidateConfidence !==
        existingConfidence) {
        return (candidateConfidence >
            existingConfidence);
    }
    return (toTimestamp(candidate.createdAt) >
        toTimestamp(existing.createdAt));
}
function compareMemoryLinks(first, second) {
    var idComparison = first.targetId.localeCompare(second.targetId);
    if (idComparison !== 0) {
        return idComparison;
    }
    var fileNameComparison = first.targetFileName.localeCompare(second.targetFileName);
    if (fileNameComparison !== 0) {
        return fileNameComparison;
    }
    return first.relationship.localeCompare(second.relationship);
}
function isValidMemoryLink(link) {
    if (!link) {
        return false;
    }
    if (typeof link.targetId !==
        "string" ||
        !link.targetId.trim()) {
        return false;
    }
    if (typeof link.targetFileName !==
        "string" ||
        !getSafeMemoryFileName(link.targetFileName)) {
        return false;
    }
    return isMemoryRelationship(link.relationship);
}
function isMemoryRelationship(value) {
    return (value === "COMPLEMENTS" ||
        value === "CONTRADICTS" ||
        value === "RELATED" ||
        value === "DUPLICATE");
}
function normalizeNumber(value) {
    if (typeof value !== "number" ||
        !Number.isFinite(value)) {
        return 0;
    }
    return value;
}
function toTimestamp(value) {
    if (typeof value !== "string") {
        return 0;
    }
    var timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
        ? timestamp
        : 0;
}
function readMemoryFile(fileName, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, fileExists, fileContent, parsedValue, memory;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    filePath = createMemoryFilePath(fileName);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    fileExists = _a.sent();
                    throwIfAborted(signal);
                    if (!fileExists) {
                        throw new Error("Memory file does not exist: ".concat(fileName));
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    fileContent = _a.sent();
                    throwIfAborted(signal);
                    try {
                        parsedValue =
                            JSON.parse(fileContent);
                    }
                    catch (_b) {
                        throw new Error("Memory file contains invalid JSON: ".concat(fileName));
                    }
                    if (!parsedValue ||
                        typeof parsedValue !== "object" ||
                        Array.isArray(parsedValue)) {
                        throw new Error("Memory file contains an invalid memory object: ".concat(fileName));
                    }
                    memory = parsedValue;
                    if (typeof memory.id !== "string" ||
                        !memory.id.trim()) {
                        throw new Error("Memory file contains an invalid memory ID: ".concat(fileName));
                    }
                    validateMemoryId(memory.id);
                    if (memory.links !== undefined &&
                        !Array.isArray(memory.links)) {
                        console.warn("[Memory] Invalid links were removed from memory file \"".concat(fileName, "\"."));
                        memory.links = [];
                    }
                    return [2 /*return*/, memory];
            }
        });
    });
}
function writeMemoryFile(fileName, memory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, serializedMemory;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    filePath = createMemoryFilePath(fileName);
                    serializedMemory = JSON.stringify(memory, null, 2);
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, serializedMemory, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/];
            }
        });
    });
}
function assertMemoryMatchesFileName(memory, fileName) {
    var expectedFileName = createMemoryFileName(memory.id);
    if (expectedFileName !== fileName) {
        throw new Error("Memory ID and file name do not match. Expected \"".concat(expectedFileName, "\", received \"").concat(fileName, "\"."));
    }
}
function validateMemoryId(memoryId) {
    if (typeof memoryId !== "string" ||
        !memoryId.trim()) {
        throw new Error("Memory ID is invalid.");
    }
    var normalizedMemoryId = memoryId.trim();
    if (normalizedMemoryId.includes("/") ||
        normalizedMemoryId.includes("\\") ||
        normalizedMemoryId === "." ||
        normalizedMemoryId === "..") {
        throw new Error("Memory ID contains invalid characters.");
    }
}
function createMemoryFileName(memoryId) {
    validateMemoryId(memoryId);
    return "".concat(memoryId.trim(), ".json");
}
function getSafeMemoryFileName(fileName) {
    if (typeof fileName !== "string" ||
        !fileName.trim()) {
        return null;
    }
    var trimmedFileName = fileName.trim();
    var extractedFileName = trimmedFileName
        .split(/[\\/]/)
        .pop();
    if (!extractedFileName ||
        extractedFileName !==
            trimmedFileName ||
        !extractedFileName.endsWith(".json") ||
        extractedFileName === ".json") {
        return null;
    }
    return extractedFileName;
}
function createMemoryFilePath(fileName) {
    var safeFileName = getSafeMemoryFileName(fileName);
    if (!safeFileName) {
        throw new Error("Memory file name is invalid.");
    }
    return "".concat(MEMORY_DIRECTORY, "/").concat(safeFileName);
}
