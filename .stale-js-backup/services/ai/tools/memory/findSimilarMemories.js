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
exports.findSimilarMemories = findSimilarMemories;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var textSimilarity_1 = require("../textSimilarity");
var MEMORY_DIRECTORY = "memory";
var TAGS_FILE_NAME = "tags.json";
var SIMILARITY_THRESHOLD = 0.5;
var MAX_SIMILAR_MEMORIES = 10;
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
 * Finds stored memories with embeddings similar to the provided memory.
 *
 * This method does not generate embeddings again. It compares the embedding
 * already present on the enriched memory against embeddings read from files.
 *
 * Tauri file-system operations cannot necessarily be interrupted once they
 * have started. Abort checks prevent the pipeline from continuing before and
 * after each async operation.
 */
function findSimilarMemories(enrichedMemory, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var memoryDirectoryExists, storedMemories, compatibleMemories, memoriesByFileName, comparisonResult;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    if (!hasValidEmbedding(enrichedMemory)) {
                        throw new Error("The provided enriched memory does not contain a valid embedding.");
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    memoryDirectoryExists = _a.sent();
                    throwIfAborted(signal);
                    if (!memoryDirectoryExists) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, readStoredMemories(signal)];
                case 2:
                    storedMemories = _a.sent();
                    throwIfAborted(signal);
                    if (storedMemories.length === 0) {
                        return [2 /*return*/, []];
                    }
                    compatibleMemories = storedMemories.filter(function (_a) {
                        var memory = _a.memory;
                        return memory.embedding.length === enrichedMemory.embedding.length;
                    });
                    if (compatibleMemories.length === 0) {
                        return [2 /*return*/, []];
                    }
                    memoriesByFileName = new Map(compatibleMemories.map(function (storedMemory) { return [
                        storedMemory.fileName,
                        storedMemory.memory,
                    ]; }));
                    throwIfAborted(signal);
                    comparisonResult = textSimilarity_1.textSimilarity.compareEmbeddingToList(enrichedMemory.embedding, compatibleMemories.map(function (storedMemory) { return ({
                        id: storedMemory.fileName,
                        embedding: storedMemory.memory.embedding,
                    }); }));
                    throwIfAborted(signal);
                    return [2 /*return*/, comparisonResult.matches
                            .filter(function (match) { return match.score >= SIMILARITY_THRESHOLD; })
                            .slice(0, MAX_SIMILAR_MEMORIES)
                            .flatMap(function (match) {
                            var memory = memoriesByFileName.get(match.id);
                            if (!memory) {
                                return [];
                            }
                            return [
                                {
                                    fileName: match.id,
                                    similarity: match.score,
                                    memory: memory,
                                },
                            ];
                        })];
            }
        });
    });
}
function readStoredMemories(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var entries, storedMemories, _i, entries_1, entry, storedMemory;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    entries = _a.sent();
                    throwIfAborted(signal);
                    storedMemories = [];
                    _i = 0, entries_1 = entries;
                    _a.label = 2;
                case 2:
                    if (!(_i < entries_1.length)) return [3 /*break*/, 5];
                    entry = entries_1[_i];
                    throwIfAborted(signal);
                    if (!entry.isFile) {
                        return [3 /*break*/, 4];
                    }
                    if (!entry.name.endsWith(".json")) {
                        return [3 /*break*/, 4];
                    }
                    if (entry.name === TAGS_FILE_NAME) {
                        return [3 /*break*/, 4];
                    }
                    return [4 /*yield*/, readMemory(entry.name, signal)];
                case 3:
                    storedMemory = _a.sent();
                    throwIfAborted(signal);
                    if (storedMemory) {
                        storedMemories.push(storedMemory);
                    }
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, storedMemories];
            }
        });
    });
}
function readMemory(fileName, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, fileContent, parsedMemory, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    filePath = "".concat(MEMORY_DIRECTORY, "/").concat(fileName);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    fileContent = _a.sent();
                    throwIfAborted(signal);
                    parsedMemory = JSON.parse(fileContent);
                    if (!hasValidEmbedding(parsedMemory)) {
                        console.warn("Skipping memory file because it has no valid embedding: ".concat(fileName));
                        return [2 /*return*/, null];
                    }
                    return [2 /*return*/, {
                            fileName: fileName,
                            memory: parsedMemory,
                        }];
                case 3:
                    error_1 = _a.sent();
                    /*
                     * Cancellation is not a file-read failure. It must propagate upward so
                     * the complete memory-creation pipeline stops.
                     */
                    if (isAbortError(error_1)) {
                        throw error_1;
                    }
                    console.warn("Unable to read memory file: ".concat(fileName), error_1);
                    return [2 /*return*/, null];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function hasValidEmbedding(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    var memory = value;
    return (Array.isArray(memory.embedding) &&
        memory.embedding.length > 0 &&
        memory.embedding.every(function (item) { return typeof item === "number" && Number.isFinite(item); }));
}
