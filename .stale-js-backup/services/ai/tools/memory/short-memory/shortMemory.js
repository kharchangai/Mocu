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
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveShortMemoryTurn = saveShortMemoryTurn;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var textSimilarity_1 = require("../../textSimilarity");
var MEMORY_DIRECTORY = "memory";
var SHORT_MEMORY_DIRECTORY = "".concat(MEMORY_DIRECTORY, "/short-memory");
/**
 * Appends one completed user/assistant turn to today's short-memory file.
 *
 * The user message and assistant response are combined into one text,
 * embedded, and saved with the rest of the turn data.
 */
function saveShortMemoryTurn(state) {
    return __awaiter(this, void 0, void 0, function () {
        var date, filePath, dailyMemory, turnData, embeddingText, embedding, error_1, turn;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureDirectory(SHORT_MEMORY_DIRECTORY)];
                case 1:
                    _a.sent();
                    date = getLocalDateKey();
                    filePath = "".concat(SHORT_MEMORY_DIRECTORY, "/").concat(date, ".json");
                    return [4 /*yield*/, readOrCreateDailyMemoryFile(filePath, date)];
                case 2:
                    dailyMemory = _a.sent();
                    turnData = createTurnDataFromState(state.messages);
                    if (!turnData) {
                        console.warn("[Short Memory] A complete user/assistant turn was not found.");
                        return [2 /*return*/];
                    }
                    embeddingText = createTurnEmbeddingText(turnData.user.content, turnData.assistant.content);
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, textSimilarity_1.textSimilarity.embedText(embeddingText)];
                case 4:
                    embedding = _a.sent();
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    console.error("[Short Memory] Failed to create embedding for turn.", error_1);
                    return [2 /*return*/];
                case 6:
                    turn = __assign(__assign({}, turnData), { embedding: embedding });
                    dailyMemory.turns.push(turn);
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, JSON.stringify(dailyMemory, null, 2), {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 7:
                    _a.sent();
                    console.log("[Short Memory] Turn saved with embedding: ".concat(filePath));
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Creates turn data without the embedding.
 */
function createTurnDataFromState(messages) {
    var userMessage = findLastMessageByType(messages, "human");
    var assistantMessage = findLastMessageByType(messages, "ai");
    var userContent = userMessage
        ? getTextContent(userMessage.content).trim()
        : "";
    var assistantContent = assistantMessage
        ? getTextContent(assistantMessage.content).trim()
        : "";
    if (!userContent || !assistantContent) {
        return null;
    }
    return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        user: {
            content: userContent,
        },
        assistant: {
            content: assistantContent,
        },
    };
}
/**
 * Creates the text that will be sent to the embedding model.
 */
function createTurnEmbeddingText(userContent, assistantContent) {
    return [
        "User: ".concat(userContent),
        "Assistant: ".concat(assistantContent),
    ].join("\n");
}
/**
 * Finds the latest message with the requested LangChain message type.
 *
 * `message.getType()` is deprecated in recent LangChain versions.
 * Use `message.type` instead.
 */
function findLastMessageByType(messages, messageType) {
    if (!Array.isArray(messages)) {
        return undefined;
    }
    for (var index = messages.length - 1; index >= 0; index -= 1) {
        var message = messages[index];
        if (message.type === messageType) {
            return message;
        }
    }
    return undefined;
}
function readOrCreateDailyMemoryFile(filePath, date) {
    return __awaiter(this, void 0, void 0, function () {
        var fileExists, content, parsed;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(filePath, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    fileExists = _a.sent();
                    if (!fileExists) {
                        return [2 /*return*/, {
                                date: date,
                                turns: [],
                            }];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 2:
                    content = _a.sent();
                    try {
                        parsed = JSON.parse(content);
                        if (!Array.isArray(parsed.turns)) {
                            throw new Error("The turns field is invalid.");
                        }
                        return [2 /*return*/, {
                                date: typeof parsed.date === "string" && parsed.date
                                    ? parsed.date
                                    : date,
                                turns: parsed.turns,
                            }];
                    }
                    catch (error) {
                        console.error("[Short Memory] Invalid JSON in ".concat(filePath, ". A new daily file will be created."), error);
                        return [2 /*return*/, {
                                date: date,
                                turns: [],
                            }];
                    }
                    return [2 /*return*/];
            }
        });
    });
}
function ensureDirectory(directoryPath) {
    return __awaiter(this, void 0, void 0, function () {
        var directoryExists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, plugin_fs_1.exists)(directoryPath, {
                        baseDir: plugin_fs_1.BaseDirectory.AppData,
                    })];
                case 1:
                    directoryExists = _a.sent();
                    if (directoryExists) {
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(directoryPath, {
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
 * Uses the local date instead of UTC.
 */
function getLocalDateKey(date) {
    if (date === void 0) { date = new Date(); }
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return "".concat(year, "-").concat(month, "-").concat(day);
}
function getTextContent(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .map(function (item) {
        if (typeof item === "string") {
            return item;
        }
        if (item &&
            typeof item === "object" &&
            "text" in item &&
            typeof item.text === "string") {
            return item.text;
        }
        return "";
    })
        .filter(Boolean)
        .join(" ");
}
