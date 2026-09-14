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
exports.StoredMemorySchema = exports.MemoryLinkSchema = void 0;
exports.findRelevantMemories = findRelevantMemories;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var zod_1 = require("zod");
var messages_1 = require("@langchain/core/messages");
var atomicMemoryExtractor_1 = require("./atomicMemoryExtractor");
var textSimilarity_1 = require("../textSimilarity");
var llm_1 = require("../../llm");
var prompts_1 = require("./prompts");
var MEMORY_DIRECTORY = "memory";
var TAGS_FILE_NAME = "tags.json";
var SIMILARITY_THRESHOLD = 0.5;
var TOP_CANDIDATES_PER_ATOMIC_MEMORY = 10;
var MAX_CANDIDATES_FOR_RERANKING = 25;
var MAX_NEIGHBORS_PER_MEMORY = 3;
exports.MemoryLinkSchema = zod_1.z.object({
    targetId: zod_1.z.string().trim().min(1),
    targetFileName: zod_1.z.string().trim().min(1),
    relationship: zod_1.z.enum([
        "COMPLEMENTS",
        "CONTRADICTS",
        "RELATED",
        "DUPLICATE",
    ]),
    similarity: zod_1.z.number(),
    confidence: zod_1.z.number(),
    reason: zod_1.z.string(),
    createdAt: zod_1.z.string(),
});
/**
 * This schema represents memory JSON files saved by createMemory().
 *
 * Unknown fields are allowed because MemoryNode may contain additional
 * fields such as createdAt, updatedAt, type, or other future fields.
 */
exports.StoredMemorySchema = zod_1.z.looseObject({
    id: zod_1.z.string().trim().min(1),
    content: zod_1.z.string().trim().min(1),
    context: zod_1.z.string().catch(""),
    key: zod_1.z.array(zod_1.z.string()).catch([]),
    tags: zod_1.z.array(zod_1.z.string()).catch([]),
    embedding: zod_1.z.array(zod_1.z.number()).min(1),
    links: zod_1.z.array(exports.MemoryLinkSchema).catch([]),
});
var MemoryRerankItemSchema = zod_1.z.object({
    memoryId: zod_1.z.string().trim().min(1),
    reason: zod_1.z.string().trim().min(1),
    includeNeighbors: zod_1.z.boolean(),
});
var MemoryRerankResultSchema = zod_1.z.object({
    selectedMemories: zod_1.z.array(MemoryRerankItemSchema),
});
/**
 * Raw JSON Schema for withStructuredOutput.
 *
 * Keep this schema simple because some OpenAI-compatible providers
 * reject unsupported JSON Schema keywords.
 */
var MemoryRerankJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        selectedMemories: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    memoryId: {
                        type: "string",
                    },
                    reason: {
                        type: "string",
                    },
                    includeNeighbors: {
                        type: "boolean",
                    },
                },
                required: ["memoryId", "reason", "includeNeighbors"],
            },
        },
    },
    required: ["selectedMemories"],
};
/**
 * Finds relevant long-term memories for one user message.
 *
 * Pipeline:
 * 1. Extract atomic statements from the user message.
 * 2. Read every memory/*.json file in AppData except tags.json.
 * 3. Create an embedding for every extracted atomic statement.
 * 4. Compare it with stored memory embeddings.
 * 5. Keep top 10 matches above similarity 0.5 for each atomic statement.
 * 6. Merge duplicate candidates.
 * 7. Ask the LLM to remove semantic false positives.
 * 8. Load direct linked neighbors only if the LLM requests them.
 * 9. Build final context for the main agent.
 */
function findRelevantMemories(userText) {
    return __awaiter(this, void 0, void 0, function () {
        var text, atomicMemories, loadedMemories, candidates, candidatesForReranking, rerankedMemories, selectedMemories, neighborMemories, context, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    text = userText === null || userText === void 0 ? void 0 : userText.trim();
                    if (!text) {
                        return [2 /*return*/, createEmptyResult("")];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    return [4 /*yield*/, (0, atomicMemoryExtractor_1.extractAtomicMemories)(text)];
                case 2:
                    atomicMemories = _a.sent();
                    if (atomicMemories.length === 0) {
                        return [2 /*return*/, __assign(__assign({}, createEmptyResult(text)), { atomicMemories: atomicMemories })];
                    }
                    return [4 /*yield*/, loadAllMemories()];
                case 3:
                    loadedMemories = _a.sent();
                    if (loadedMemories.length === 0) {
                        return [2 /*return*/, __assign(__assign({}, createEmptyResult(text)), { atomicMemories: atomicMemories })];
                    }
                    return [4 /*yield*/, findSemanticCandidates(atomicMemories, loadedMemories)];
                case 4:
                    candidates = _a.sent();
                    if (candidates.length === 0) {
                        return [2 /*return*/, __assign(__assign({}, createEmptyResult(text)), { atomicMemories: atomicMemories })];
                    }
                    candidatesForReranking = candidates.slice(0, MAX_CANDIDATES_FOR_RERANKING);
                    return [4 /*yield*/, rerankMemoryCandidates(text, atomicMemories, candidatesForReranking)];
                case 5:
                    rerankedMemories = _a.sent();
                    selectedMemories = getSelectedMemories(rerankedMemories, candidatesForReranking);
                    neighborMemories = getRequestedNeighbors(rerankedMemories, selectedMemories, loadedMemories);
                    context = buildMemoryContext(rerankedMemories, selectedMemories, neighborMemories);
                    return [2 /*return*/, {
                            userText: text,
                            atomicMemories: atomicMemories,
                            candidates: candidatesForReranking,
                            selectedMemories: selectedMemories,
                            neighborMemories: neighborMemories,
                            context: context,
                        }];
                case 6:
                    error_1 = _a.sent();
                    console.error("[Find relevant memories] Failed:", error_1);
                    return [2 /*return*/, createEmptyResult(text)];
                case 7: return [2 /*return*/];
            }
        });
    });
}
/**
 * Reads all JSON files from AppData/memory except tags.json.
 *
 * This uses the same BaseDirectory.AppData approach as createMemory().
 */
function loadAllMemories() {
    return __awaiter(this, void 0, void 0, function () {
        var memoryDirectoryExists, entries, memoryFileNames, results, loadedMemories, _i, results_1, result;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    memoryDirectoryExists = _a.sent();
                    if (!memoryDirectoryExists) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    entries = _a.sent();
                    memoryFileNames = entries
                        .filter(function (entry) {
                        if (entry.isDirectory) {
                            return false;
                        }
                        var fileName = entry.name.toLowerCase();
                        return fileName.endsWith(".json") && fileName !== TAGS_FILE_NAME;
                    })
                        .map(function (entry) { return entry.name; });
                    return [4 /*yield*/, Promise.allSettled(memoryFileNames.map(function (fileName) { return __awaiter(_this, void 0, void 0, function () {
                            var filePath, fileContent, rawMemory, parsedMemory;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        filePath = "".concat(MEMORY_DIRECTORY, "/").concat(fileName);
                                        return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                                                baseDir: plugin_fs_1.BaseDirectory.AppData,
                                            })];
                                    case 1:
                                        fileContent = _a.sent();
                                        rawMemory = JSON.parse(fileContent);
                                        parsedMemory = exports.StoredMemorySchema.safeParse(rawMemory);
                                        if (!parsedMemory.success) {
                                            throw new Error("Invalid memory file \"".concat(filePath, "\": ").concat(parsedMemory.error.message));
                                        }
                                        return [2 /*return*/, {
                                                fileName: fileName,
                                                filePath: filePath,
                                                memory: parsedMemory.data,
                                            }];
                                }
                            });
                        }); }))];
                case 3:
                    results = _a.sent();
                    loadedMemories = [];
                    for (_i = 0, results_1 = results; _i < results_1.length; _i++) {
                        result = results_1[_i];
                        if (result.status === "fulfilled") {
                            loadedMemories.push(result.value);
                            continue;
                        }
                        console.warn("[Find relevant memories] Failed to load a memory file:", result.reason);
                    }
                    return [2 /*return*/, loadedMemories];
            }
        });
    });
}
/**
 * Finds semantic candidates for all extracted atomic memories.
 *
 * The stored memory embedding already represents:
 * content + context + key + tags.
 *
 * The new atomic memory has only content at this point, so it is embedded
 * with embedText() and compared directly against saved embeddings.
 */
function findSemanticCandidates(atomicMemories, loadedMemories) {
    return __awaiter(this, void 0, void 0, function () {
        var storedEmbeddings, loadedMemoryById, candidateMap, _i, atomicMemories_1, atomicMemory, atomicEmbedding, comparison, topMatches, _a, topMatches_1, match, loadedMemory, existingCandidate;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    storedEmbeddings = loadedMemories.map(function (_a) {
                        var memory = _a.memory;
                        return ({
                            id: memory.id,
                            embedding: memory.embedding,
                        });
                    });
                    loadedMemoryById = new Map(loadedMemories.map(function (item) { return [item.memory.id, item]; }));
                    candidateMap = new Map();
                    _i = 0, atomicMemories_1 = atomicMemories;
                    _b.label = 1;
                case 1:
                    if (!(_i < atomicMemories_1.length)) return [3 /*break*/, 4];
                    atomicMemory = atomicMemories_1[_i];
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(atomicMemory.content)];
                case 2:
                    atomicEmbedding = _b.sent();
                    comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(atomicEmbedding, storedEmbeddings);
                    topMatches = comparison.matches
                        .filter(function (match) { return match.score >= SIMILARITY_THRESHOLD; })
                        .slice(0, TOP_CANDIDATES_PER_ATOMIC_MEMORY);
                    for (_a = 0, topMatches_1 = topMatches; _a < topMatches_1.length; _a++) {
                        match = topMatches_1[_a];
                        loadedMemory = loadedMemoryById.get(match.id);
                        if (!loadedMemory) {
                            continue;
                        }
                        existingCandidate = candidateMap.get(match.id);
                        if (!existingCandidate) {
                            candidateMap.set(match.id, {
                                memoryId: match.id,
                                fileName: loadedMemory.fileName,
                                filePath: loadedMemory.filePath,
                                score: match.score,
                                matchedAtomicContents: [atomicMemory.content],
                                memory: loadedMemory.memory,
                            });
                            continue;
                        }
                        if (!existingCandidate.matchedAtomicContents.includes(atomicMemory.content)) {
                            existingCandidate.matchedAtomicContents.push(atomicMemory.content);
                        }
                        if (match.score > existingCandidate.score) {
                            existingCandidate.score = match.score;
                        }
                    }
                    _b.label = 3;
                case 3:
                    _i++;
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/, __spreadArray([], candidateMap.values(), true).sort(function (first, second) { return second.score - first.score; })];
            }
        });
    });
}
/**
 * Lets the LLM evaluate semantic relevance of candidates.
 *
 * It receives only candidates found by embedding search and can select
 * only IDs from that candidate list.
 */
function rerankMemoryCandidates(userText, atomicMemories, candidates) {
    return __awaiter(this, void 0, void 0, function () {
        var model, structuredModel, result, validatedResult, allowedMemoryIds_1, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (candidates.length === 0) {
                        return [2 /*return*/, []];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 2:
                    model = _a.sent();
                    structuredModel = model.withStructuredOutput(MemoryRerankJsonSchema, {
                        name: "memory_retrieval_rerank",
                    });
                    return [4 /*yield*/, structuredModel.invoke([
                            new messages_1.SystemMessage(prompts_1.MEMORY_RETRIEVAL_RERANK_PROMPT),
                            new messages_1.HumanMessage(createMemoryRerankInput(userText, atomicMemories, candidates)),
                        ])];
                case 3:
                    result = _a.sent();
                    validatedResult = MemoryRerankResultSchema.safeParse(result);
                    if (!validatedResult.success) {
                        console.error("[Find relevant memories] Invalid rerank response:", validatedResult.error);
                        return [2 /*return*/, []];
                    }
                    allowedMemoryIds_1 = new Set(candidates.map(function (candidate) { return candidate.memoryId; }));
                    return [2 /*return*/, validatedResult.data.selectedMemories.filter(function (item) {
                            return allowedMemoryIds_1.has(item.memoryId);
                        })];
                case 4:
                    error_2 = _a.sent();
                    console.error("[Find relevant memories] Reranking failed:", error_2);
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
/**
 * Creates the input given to the memory retrieval evaluator.
 */
function createMemoryRerankInput(userText, atomicMemories, candidates) {
    var atomicMemoriesText = atomicMemories
        .map(function (memory, index) { return "".concat(index + 1, ". ").concat(memory.content); })
        .join("\n");
    var candidatesText = candidates
        .map(function (candidate, index) {
        var memory = candidate.memory;
        return [
            "Candidate ".concat(index + 1),
            "Memory ID: ".concat(memory.id),
            "File name: ".concat(candidate.fileName),
            "Similarity score: ".concat(candidate.score),
            "Matched atomic statements: ".concat(candidate.matchedAtomicContents.join(" | ")),
            "Content: ".concat(memory.content),
            "Context: ".concat(memory.context),
            "Key: ".concat(memory.key.join(", ")),
            "Tags: ".concat(memory.tags.join(", ")),
            "Direct link count: ".concat(memory.links.length),
        ].join("\n");
    })
        .join("\n\n---\n\n");
    return [
        "Current user message:",
        userText,
        "",
        "Atomic statements extracted from the message:",
        atomicMemoriesText,
        "",
        "Memory candidates retrieved by embeddings:",
        candidatesText,
    ].join("\n");
}
/**
 * Gets full selected memory objects from IDs selected by the LLM.
 */
function getSelectedMemories(rerankedMemories, candidates) {
    var candidateById = new Map(candidates.map(function (candidate) { return [candidate.memoryId, candidate]; }));
    var selectedMemoryMap = new Map();
    for (var _i = 0, rerankedMemories_1 = rerankedMemories; _i < rerankedMemories_1.length; _i++) {
        var item = rerankedMemories_1[_i];
        var candidate = candidateById.get(item.memoryId);
        if (candidate) {
            selectedMemoryMap.set(candidate.memoryId, candidate.memory);
        }
    }
    return __spreadArray([], selectedMemoryMap.values(), true);
}
/**
 * Loads direct linked neighbors requested by the LLM.
 *
 * The memory link format is:
 * {
 *   targetId,
 *   targetFileName,
 *   relationship,
 *   similarity,
 *   confidence,
 *   reason,
 *   createdAt
 * }
 *
 * Only link.targetId is required here because all loaded memories are
 * indexed by their actual memory.id.
 */
function getRequestedNeighbors(rerankedMemories, selectedMemories, loadedMemories) {
    var memoryById = new Map(loadedMemories.map(function (item) { return [item.memory.id, item.memory]; }));
    var selectedMemoryIds = new Set(selectedMemories.map(function (memory) { return memory.id; }));
    var neighborMap = new Map();
    for (var _i = 0, rerankedMemories_2 = rerankedMemories; _i < rerankedMemories_2.length; _i++) {
        var rerankedMemory = rerankedMemories_2[_i];
        if (!rerankedMemory.includeNeighbors) {
            continue;
        }
        var selectedMemory = memoryById.get(rerankedMemory.memoryId);
        if (!selectedMemory || selectedMemory.links.length === 0) {
            continue;
        }
        var directLinks = selectedMemory.links.slice(0, MAX_NEIGHBORS_PER_MEMORY);
        for (var _a = 0, directLinks_1 = directLinks; _a < directLinks_1.length; _a++) {
            var link = directLinks_1[_a];
            if (selectedMemoryIds.has(link.targetId)) {
                continue;
            }
            var neighborMemory = memoryById.get(link.targetId);
            if (!neighborMemory) {
                console.warn("[Find relevant memories] Linked memory was not found: ".concat(link.targetId));
                continue;
            }
            neighborMap.set(neighborMemory.id, neighborMemory);
        }
    }
    return __spreadArray([], neighborMap.values(), true);
}
/**
 * Builds the final long-term-memory context passed to the main agent.
 */
function buildMemoryContext(rerankedMemories, selectedMemories, neighborMemories) {
    if (selectedMemories.length === 0 && neighborMemories.length === 0) {
        return "";
    }
    var reasonByMemoryId = new Map(rerankedMemories.map(function (item) { return [item.memoryId, item.reason]; }));
    var selectedMemoryText = selectedMemories
        .map(function (memory, index) {
        var reason = reasonByMemoryId.get(memory.id);
        return formatMemoryForAgent("Relevant Memory ".concat(index + 1), memory, reason);
    })
        .join("\n\n");
    var neighborMemoryText = neighborMemories
        .map(function (memory, index) {
        return formatMemoryForAgent("Supporting Linked Memory ".concat(index + 1), memory);
    })
        .join("\n\n");
    return [
        "Relevant long-term memories:",
        selectedMemoryText,
        neighborMemoryText
            ? "Supporting linked memories:\n".concat(neighborMemoryText)
            : "",
    ]
        .filter(Boolean)
        .join("\n\n");
}
/**
 * Formats one memory for inclusion in the main agent context.
 */
function formatMemoryForAgent(label, memory, retrievalReason) {
    return [
        "[".concat(label, "]"),
        "ID: ".concat(memory.id),
        "Content: ".concat(memory.content),
        memory.context ? "Context: ".concat(memory.context) : "",
        memory.key.length > 0 ? "Key: ".concat(memory.key.join(", ")) : "",
        memory.tags.length > 0 ? "Tags: ".concat(memory.tags.join(", ")) : "",
        retrievalReason ? "Retrieval reason: ".concat(retrievalReason) : "",
    ]
        .filter(Boolean)
        .join("\n");
}
function createEmptyResult(userText) {
    return {
        userText: userText,
        atomicMemories: [],
        candidates: [],
        selectedMemories: [],
        neighborMemories: [],
        context: "",
    };
}
