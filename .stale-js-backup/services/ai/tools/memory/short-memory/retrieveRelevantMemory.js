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
exports.retrieveRelevantShortMemory = retrieveRelevantShortMemory;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var prompts_1 = require("@langchain/core/prompts");
var output_parsers_1 = require("@langchain/core/output_parsers");
var zod_1 = require("zod");
var llm_1 = require("../../../llm");
var textSimilarity_1 = require("../../textSimilarity");
var prompts_2 = require("./prompts");
var SHORT_MEMORY_DIR = "memory/short-memory";
var DEFAULT_MAX_FILES = 5;
var DEFAULT_CANDIDATE_LIMIT = 5;
var DEFAULT_NEIGHBOR_COUNT = 2;
var relevanceDecisionSchema = zod_1.z.object({
    selectedTurns: zod_1.z.array(zod_1.z.object({
        candidateId: zod_1.z.string(),
        includePrevious: zod_1.z.boolean(),
        includeNext: zod_1.z.boolean(),
    })),
});
var relevanceParser = output_parsers_1.StructuredOutputParser.fromZodSchema(relevanceDecisionSchema);
function isDateMemoryFile(fileName) {
    return /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName);
}
function isValidEmbedding(value) {
    return (Array.isArray(value) &&
        value.length > 0 &&
        value.every(function (item) { return typeof item === "number" && Number.isFinite(item); }));
}
function isValidTurn(value) {
    var _a, _b;
    if (typeof value !== "object" || value === null) {
        return false;
    }
    var turn = value;
    return (typeof turn.id === "string" &&
        turn.id.trim().length > 0 &&
        typeof turn.createdAt === "string" &&
        typeof ((_a = turn.user) === null || _a === void 0 ? void 0 : _a.content) === "string" &&
        typeof ((_b = turn.assistant) === null || _b === void 0 ? void 0 : _b.content) === "string" &&
        (turn.embedding === undefined || isValidEmbedding(turn.embedding)));
}
function isValidMemoryFile(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    var memoryFile = value;
    return (typeof memoryFile.date === "string" &&
        Array.isArray(memoryFile.turns));
}
function getMessageContent(content) {
    if (typeof content === "string") {
        return content.trim();
    }
    if (Array.isArray(content)) {
        return content
            .map(function (item) {
            if (typeof item === "string") {
                return item;
            }
            if (typeof item === "object" &&
                item !== null &&
                "text" in item &&
                typeof item.text === "string") {
                return item.text;
            }
            return "";
        })
            .filter(Boolean)
            .join("\n")
            .trim();
    }
    return String(content !== null && content !== void 0 ? content : "").trim();
}
function createCandidateId(fileName, turnIndex, turnId) {
    return "".concat(fileName, ":").concat(turnIndex, ":").concat(turnId);
}
function getAvailableMemoryFiles() {
    return __awaiter(this, void 0, void 0, function () {
        var folderExists, entries, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(SHORT_MEMORY_DIR, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    folderExists = _a.sent();
                    if (!folderExists) {
                        return [2 /*return*/, []];
                    }
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, (0, plugin_fs_1.readDir)(SHORT_MEMORY_DIR, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 3:
                    entries = _a.sent();
                    return [2 /*return*/, entries
                            .filter(function (entry) {
                            return !entry.isDirectory &&
                                isDateMemoryFile(entry.name);
                        })
                            .map(function (entry) { return entry.name; })
                            .sort(function (first, second) { return second.localeCompare(first); })];
                case 4:
                    error_1 = _a.sent();
                    console.error("Failed to read the short-memory directory:", error_1);
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function readTurnsFromFile(fileName) {
    return __awaiter(this, void 0, void 0, function () {
        var filePath, content, parsed, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    filePath = "".concat(SHORT_MEMORY_DIR, "/").concat(fileName);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    content = _a.sent();
                    parsed = JSON.parse(content);
                    if (!isValidMemoryFile(parsed)) {
                        console.warn("Invalid memory file format: ".concat(filePath));
                        return [2 /*return*/, []];
                    }
                    return [2 /*return*/, parsed.turns.filter(isValidTurn)];
                case 3:
                    error_2 = _a.sent();
                    console.error("Failed to read memory file: ".concat(filePath), error_2);
                    return [2 /*return*/, []];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function loadLatestMemoryFiles(maxFiles) {
    return __awaiter(this, void 0, void 0, function () {
        var availableFiles, selectedFileNames, loadedFiles, _i, selectedFileNames_1, fileName, turns;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (maxFiles <= 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, getAvailableMemoryFiles()];
                case 1:
                    availableFiles = _a.sent();
                    selectedFileNames = availableFiles.slice(0, maxFiles);
                    loadedFiles = [];
                    _i = 0, selectedFileNames_1 = selectedFileNames;
                    _a.label = 2;
                case 2:
                    if (!(_i < selectedFileNames_1.length)) return [3 /*break*/, 5];
                    fileName = selectedFileNames_1[_i];
                    return [4 /*yield*/, readTurnsFromFile(fileName)];
                case 3:
                    turns = _a.sent();
                    loadedFiles.push({
                        fileName: fileName,
                        turns: turns,
                    });
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, loadedFiles];
            }
        });
    });
}
/**
 * Creates one chronological turn list.
 *
 * The loaded files are initially ordered from newest to oldest.
 * They are reversed here so neighbor lookup can move through the
 * complete conversation timeline, including daily file boundaries.
 */
function createChronologicalTurnIndex(files) {
    var indexedTurns = [];
    var chronologicalFiles = __spreadArray([], files, true).reverse();
    var _loop_1 = function (file) {
        file.turns.forEach(function (turn, turnIndex) {
            indexedTurns.push({
                candidateId: createCandidateId(file.fileName, turnIndex, turn.id),
                fileName: file.fileName,
                turnIndex: turnIndex,
                globalIndex: indexedTurns.length,
                turn: turn,
            });
        });
    };
    for (var _i = 0, chronologicalFiles_1 = chronologicalFiles; _i < chronologicalFiles_1.length; _i++) {
        var file = chronologicalFiles_1[_i];
        _loop_1(file);
    }
    return indexedTurns.sort(function (first, second) {
        var firstTime = new Date(first.turn.createdAt).getTime();
        var secondTime = new Date(second.turn.createdAt).getTime();
        if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) {
            return first.globalIndex - second.globalIndex;
        }
        return firstTime - secondTime;
    }).map(function (item, globalIndex) { return (__assign(__assign({}, item), { globalIndex: globalIndex })); });
}
function createSearchQuery(userMessage) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, prompt, chain, response, searchQuery;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 1:
                    llm = _a.sent();
                    prompt = prompts_1.ChatPromptTemplate.fromTemplate(prompts_2.CREATE_MEMORY_SEARCH_QUERY_PROMPT);
                    chain = prompt.pipe(llm);
                    return [4 /*yield*/, chain.invoke({
                            userMessage: userMessage,
                        })];
                case 2:
                    response = _a.sent();
                    searchQuery = getMessageContent(response.content);
                    return [2 /*return*/, searchQuery || userMessage.trim()];
            }
        });
    });
}
function findTopCandidates(queryEmbedding, indexedTurns, candidateLimit) {
    if (candidateLimit <= 0) {
        return [];
    }
    /*
     * Embeddings created by another model or with another dimension
     * cannot be compared with the current query embedding.
     */
    var comparableTurns = indexedTurns.filter(function (item) {
        return isValidEmbedding(item.turn.embedding) &&
            item.turn.embedding.length === queryEmbedding.length;
    });
    if (comparableTurns.length === 0) {
        return [];
    }
    var targetEmbeddings = comparableTurns.map(function (item) { return ({
        id: item.candidateId,
        embedding: item.turn.embedding,
    }); });
    var comparison = textSimilarity_1.textSimilarity.compareEmbeddingToList(queryEmbedding, targetEmbeddings);
    var turnByCandidateId = new Map(comparableTurns.map(function (item) { return [
        item.candidateId,
        item,
    ]; }));
    return comparison.matches
        .slice(0, candidateLimit)
        .map(function (match) {
        var indexedTurn = turnByCandidateId.get(match.id);
        if (!indexedTurn) {
            return null;
        }
        return __assign(__assign({}, indexedTurn), { score: match.score });
    })
        .filter(function (item) { return item !== null; });
}
function formatCandidatesForPrompt(candidates) {
    return candidates
        .map(function (candidate, index) { return [
        "Candidate ".concat(index + 1),
        "Candidate ID: ".concat(candidate.candidateId),
        "Created at: ".concat(candidate.turn.createdAt),
        "Similarity score: ".concat(candidate.score),
        "User: ".concat(candidate.turn.user.content),
        "Assistant: ".concat(candidate.turn.assistant.content),
    ].join("\n"); })
        .join("\n\n---\n\n");
}
function selectRelevantCandidates(userMessage, searchQuery, candidates) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, prompt, chain, result, validCandidateIds, selectedById, _i, _a, selection, existingSelection, error_3;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (candidates.length === 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("cheap")];
                case 1:
                    llm = _b.sent();
                    prompt = prompts_1.ChatPromptTemplate.fromTemplate(prompts_2.SELECT_RELEVANT_MEMORY_PROMPT);
                    chain = prompt
                        .pipe(llm)
                        .pipe(relevanceParser);
                    _b.label = 2;
                case 2:
                    _b.trys.push([2, 4, , 5]);
                    return [4 /*yield*/, chain.invoke({
                            userMessage: userMessage,
                            searchQuery: searchQuery,
                            candidateTurns: formatCandidatesForPrompt(candidates),
                            formatInstructions: relevanceParser.getFormatInstructions(),
                        })];
                case 3:
                    result = _b.sent();
                    validCandidateIds = new Set(candidates.map(function (candidate) { return candidate.candidateId; }));
                    selectedById = new Map();
                    for (_i = 0, _a = result.selectedTurns; _i < _a.length; _i++) {
                        selection = _a[_i];
                        if (!validCandidateIds.has(selection.candidateId)) {
                            continue;
                        }
                        existingSelection = selectedById.get(selection.candidateId);
                        if (existingSelection) {
                            existingSelection.includePrevious =
                                existingSelection.includePrevious ||
                                    selection.includePrevious;
                            existingSelection.includeNext =
                                existingSelection.includeNext ||
                                    selection.includeNext;
                            continue;
                        }
                        selectedById.set(selection.candidateId, {
                            candidateId: selection.candidateId,
                            includePrevious: selection.includePrevious,
                            includeNext: selection.includeNext,
                        });
                    }
                    return [2 /*return*/, __spreadArray([], selectedById.values(), true)];
                case 4:
                    error_3 = _b.sent();
                    console.error("Failed to select relevant memory candidates:", error_3);
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function collectSelectedTurnsWithNeighbors(indexedTurns, selections, neighborCount) {
    if (selections.length === 0) {
        return [];
    }
    var normalizedNeighborCount = Math.max(0, Math.floor(neighborCount));
    var indexedTurnByCandidateId = new Map(indexedTurns.map(function (item) { return [
        item.candidateId,
        item,
    ]; }));
    var selectedIndexes = new Set();
    for (var _i = 0, selections_1 = selections; _i < selections_1.length; _i++) {
        var selection = selections_1[_i];
        var selectedTurn = indexedTurnByCandidateId.get(selection.candidateId);
        if (!selectedTurn) {
            continue;
        }
        selectedIndexes.add(selectedTurn.globalIndex);
        if (selection.includePrevious) {
            var startIndex = Math.max(0, selectedTurn.globalIndex - normalizedNeighborCount);
            for (var index = startIndex; index < selectedTurn.globalIndex; index += 1) {
                selectedIndexes.add(index);
            }
        }
        if (selection.includeNext) {
            var endIndex = Math.min(indexedTurns.length - 1, selectedTurn.globalIndex + normalizedNeighborCount);
            for (var index = selectedTurn.globalIndex + 1; index <= endIndex; index += 1) {
                selectedIndexes.add(index);
            }
        }
    }
    return __spreadArray([], selectedIndexes, true).sort(function (first, second) { return first - second; })
        .map(function (index) { var _a; return (_a = indexedTurns[index]) === null || _a === void 0 ? void 0 : _a.turn; })
        .filter(function (turn) { return turn !== undefined; });
}
function formatTurnsForAgent(turns) {
    return turns.flatMap(function (turn) {
        var messages = [];
        if (turn.user.content.trim()) {
            messages.push({
                role: "user",
                content: turn.user.content,
            });
        }
        if (turn.assistant.content.trim()) {
            messages.push({
                role: "assistant",
                content: turn.assistant.content,
            });
        }
        return messages;
    });
}
function formatCandidatesForResult(candidates) {
    return candidates.map(function (candidate) { return ({
        id: candidate.candidateId,
        originalTurnId: candidate.turn.id,
        createdAt: candidate.turn.createdAt,
        score: candidate.score,
        userContent: candidate.turn.user.content,
        assistantContent: candidate.turn.assistant.content,
    }); });
}
/**
 * Retrieves relevant conversation turns from the five latest
 * short-memory files.
 *
 * Process:
 * 1. Convert the current user message into a semantic search query.
 * 2. Create an embedding for the search query.
 * 3. Compare it with stored turn embeddings.
 * 4. Select the five highest-scoring candidates.
 * 5. Ask an LLM to verify relevance.
 * 6. Add up to two previous or next turns when requested.
 * 7. Return compact messages for the main Agent.
 */
function retrieveRelevantShortMemory(userMessage_1) {
    return __awaiter(this, arguments, void 0, function (userMessage, options) {
        var normalizedUserMessage, maxFiles, candidateLimit, neighborCount, searchQuery, queryEmbedding, loadedFiles, indexedTurns, candidates, selections, selectedTurns, error_4;
        var _a, _b, _c;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    normalizedUserMessage = userMessage.trim();
                    if (!normalizedUserMessage) {
                        return [2 /*return*/, {
                                searchQuery: "",
                                candidates: [],
                                selectedTurnIds: [],
                                messages: [],
                            }];
                    }
                    maxFiles = Math.max(0, Math.floor((_a = options.maxFiles) !== null && _a !== void 0 ? _a : DEFAULT_MAX_FILES));
                    candidateLimit = Math.max(0, Math.floor((_b = options.candidateLimit) !== null && _b !== void 0 ? _b : DEFAULT_CANDIDATE_LIMIT));
                    neighborCount = Math.max(0, Math.floor((_c = options.neighborCount) !== null && _c !== void 0 ? _c : DEFAULT_NEIGHBOR_COUNT));
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 6, , 7]);
                    return [4 /*yield*/, createSearchQuery(normalizedUserMessage)];
                case 2:
                    searchQuery = _d.sent();
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(searchQuery)];
                case 3:
                    queryEmbedding = _d.sent();
                    return [4 /*yield*/, loadLatestMemoryFiles(maxFiles)];
                case 4:
                    loadedFiles = _d.sent();
                    if (loadedFiles.length === 0) {
                        return [2 /*return*/, {
                                searchQuery: searchQuery,
                                candidates: [],
                                selectedTurnIds: [],
                                messages: [],
                            }];
                    }
                    indexedTurns = createChronologicalTurnIndex(loadedFiles);
                    candidates = findTopCandidates(queryEmbedding, indexedTurns, candidateLimit);
                    if (candidates.length === 0) {
                        return [2 /*return*/, {
                                searchQuery: searchQuery,
                                candidates: [],
                                selectedTurnIds: [],
                                messages: [],
                            }];
                    }
                    return [4 /*yield*/, selectRelevantCandidates(normalizedUserMessage, searchQuery, candidates)];
                case 5:
                    selections = _d.sent();
                    selectedTurns = collectSelectedTurnsWithNeighbors(indexedTurns, selections, neighborCount);
                    return [2 /*return*/, {
                            searchQuery: searchQuery,
                            candidates: formatCandidatesForResult(candidates),
                            selectedTurnIds: selections.map(function (selection) { return selection.candidateId; }),
                            messages: formatTurnsForAgent(selectedTurns),
                        }];
                case 6:
                    error_4 = _d.sent();
                    console.error("Failed to retrieve relevant short-term memory:", error_4);
                    return [2 /*return*/, {
                            searchQuery: normalizedUserMessage,
                            candidates: [],
                            selectedTurnIds: [],
                            messages: [],
                        }];
                case 7: return [2 /*return*/];
            }
        });
    });
}
