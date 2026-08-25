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
exports.enrichAtomicMemory = enrichAtomicMemory;
var output_parsers_1 = require("@langchain/core/output_parsers");
var prompts_1 = require("@langchain/core/prompts");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var llm_1 = require("../../llm");
var textSimilarity_1 = require("../textSimilarity");
var prompts_2 = require("./prompts");
var MEMORY_DIRECTORY = "memory";
var TAGS_FILE_PATH = "".concat(MEMORY_DIRECTORY, "/tags.json");
var TAG_SIMILARITY_THRESHOLD = 0.7;
var memoryEnrichmentParser = new output_parsers_1.JsonOutputParser();
var memoryEnrichmentPrompt = prompts_1.ChatPromptTemplate.fromMessages([
    ["system", prompts_2.MEMORY_ENRICHMENT_SYSTEM_PROMPT],
    [
        "human",
        "\nAtomic memory:\n\n{content}\n\n{formatInstructions}\n",
    ],
]);
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("The operation was cancelled.", "AbortError");
    }
}
/**
 * Enriches an atomic memory, synchronizes its tags and creates its embedding.
 *
 * The operation is cancelled by calling:
 *
 * controller.abort()
 *
 * The AbortError is intentionally not caught here and must propagate to the
 * caller, so createMemory can stop before writing the final memory file.
 */
function enrichAtomicMemory(content, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var normalizedContent, llm, chain, enrichment, tags, embeddingText, embedding;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    normalizedContent = content.trim();
                    if (!normalizedContent) {
                        throw new Error("Atomic memory content cannot be empty.");
                    }
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 1:
                    llm = _a.sent();
                    throwIfAborted(signal);
                    chain = memoryEnrichmentPrompt
                        .pipe(llm)
                        .pipe(memoryEnrichmentParser);
                    return [4 /*yield*/, chain.invoke({
                            content: normalizedContent,
                            formatInstructions: memoryEnrichmentParser.getFormatInstructions(),
                        }, {
                            signal: signal,
                        })];
                case 2:
                    enrichment = _a.sent();
                    throwIfAborted(signal);
                    return [4 /*yield*/, synchronizeTags(enrichment.tags, signal)];
                case 3:
                    tags = _a.sent();
                    throwIfAborted(signal);
                    embeddingText = createEmbeddingText({
                        content: normalizedContent,
                        context: enrichment.context,
                        key: enrichment.key,
                        tags: tags,
                    });
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(embeddingText, signal)];
                case 4:
                    embedding = _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, {
                            id: crypto.randomUUID(),
                            content: normalizedContent,
                            createdAt: new Date().toISOString(),
                            type: enrichment.type,
                            context: enrichment.context,
                            key: enrichment.key,
                            tags: tags,
                            embedding: embedding,
                        }];
            }
        });
    });
}
function createEmbeddingText(_a) {
    var content = _a.content, context = _a.context, key = _a.key, tags = _a.tags;
    return [
        "Content: ".concat(content),
        "Context: ".concat(context),
        "Key: ".concat(key.join(", ")),
        "Tags: ".concat(tags.join(", ")),
    ].join("\n");
}
/**
 * Maps model-generated tags to existing semantically similar tags and stores
 * any genuinely new tags in memory/tags.json.
 *
 * Important:
 * Cancellation before saveTags prevents tag changes. A Tauri write already
 * started cannot always be forcibly interrupted, but checks prevent moving on
 * to subsequent work after cancellation.
 */
function synchronizeTags(modelTags, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var storedTags, uniqueModelTags, similarityResult, synchronizedTags, uniqueSynchronizedTags, updatedStoredTags;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, ensureMemoryDirectory(signal)];
                case 1:
                    _a.sent();
                    throwIfAborted(signal);
                    return [4 /*yield*/, readStoredTags(signal)];
                case 2:
                    storedTags = _a.sent();
                    throwIfAborted(signal);
                    if (modelTags.length === 0) {
                        return [2 /*return*/, []];
                    }
                    if (!(storedTags.length === 0)) return [3 /*break*/, 4];
                    uniqueModelTags = __spreadArray([], new Set(modelTags), true);
                    return [4 /*yield*/, saveTags(uniqueModelTags, signal)];
                case 3:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, uniqueModelTags];
                case 4: return [4 /*yield*/, textSimilarity_1.textSimilarity.compareListToList(modelTags, storedTags, signal)];
                case 5:
                    similarityResult = _a.sent();
                    throwIfAborted(signal);
                    synchronizedTags = similarityResult.results.map(function (result) {
                        var bestMatch = result.bestMatch;
                        if (bestMatch &&
                            bestMatch.score >= TAG_SIMILARITY_THRESHOLD) {
                            return bestMatch.text;
                        }
                        return result.sourceText;
                    });
                    uniqueSynchronizedTags = __spreadArray([], new Set(synchronizedTags), true);
                    updatedStoredTags = __spreadArray([], new Set(__spreadArray(__spreadArray([], storedTags, true), uniqueSynchronizedTags, true)), true);
                    return [4 /*yield*/, saveTags(updatedStoredTags, signal)];
                case 6:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, uniqueSynchronizedTags];
            }
        });
    });
}
function ensureMemoryDirectory(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    directoryExists = _a.sent();
                    throwIfAborted(signal);
                    if (directoryExists) {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                            recursive: true,
                        })];
                case 2:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/];
            }
        });
    });
}
function readStoredTags(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var tagsFileExists, fileContent, parsedContent, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(TAGS_FILE_PATH, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    tagsFileExists = _a.sent();
                    throwIfAborted(signal);
                    if (!!tagsFileExists) return [3 /*break*/, 3];
                    return [4 /*yield*/, saveTags([], signal)];
                case 2:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, []];
                case 3:
                    _a.trys.push([3, 5, , 7]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(TAGS_FILE_PATH, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 4:
                    fileContent = _a.sent();
                    throwIfAborted(signal);
                    parsedContent = JSON.parse(fileContent);
                    if (!Array.isArray(parsedContent) ||
                        !parsedContent.every(function (value) { return typeof value === "string"; })) {
                        throw new Error("tags.json must contain a JSON array of strings.");
                    }
                    return [2 /*return*/, parsedContent];
                case 5:
                    error_1 = _a.sent();
                    /*
                     * AbortError must never be treated as a corrupted tags file.
                     * Otherwise cancelling a request could erase the tags list.
                     */
                    if (error_1 instanceof DOMException && error_1.name === "AbortError") {
                        throw error_1;
                    }
                    console.warn("Unable to read tags.json. Replacing it with an empty tag list.", error_1);
                    throwIfAborted(signal);
                    return [4 /*yield*/, saveTags([], signal)];
                case 6:
                    _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, []];
                case 7: return [2 /*return*/];
            }
        });
    });
}
function saveTags(tags, signal) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(TAGS_FILE_PATH, JSON.stringify(tags, null, 2), {
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
