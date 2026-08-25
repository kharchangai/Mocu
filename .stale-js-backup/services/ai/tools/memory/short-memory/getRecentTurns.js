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
exports.getRecentTurns = getRecentTurns;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var SHORT_MEMORY_DIR = "memory/short-memory";
var REQUIRED_TURN_COUNT = 5;
function isDateMemoryFile(fileName) {
    return /^\d{4}-\d{2}-\d{2}\.json$/.test(fileName);
}
function isValidTurn(value) {
    var _a, _b;
    if (typeof value !== "object" || value === null) {
        return false;
    }
    var turn = value;
    return (typeof turn.id === "string" &&
        typeof turn.createdAt === "string" &&
        typeof ((_a = turn.user) === null || _a === void 0 ? void 0 : _a.content) === "string" &&
        typeof ((_b = turn.assistant) === null || _b === void 0 ? void 0 : _b.content) === "string");
}
function isValidMemoryFile(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    var memoryFile = value;
    return (typeof memoryFile.date === "string" &&
        Array.isArray(memoryFile.turns));
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
                            .filter(function (entry) { return !entry.isDirectory && isDateMemoryFile(entry.name); })
                            .map(function (entry) { return entry.name; })
                            .sort(function (first, second) { return second.localeCompare(first); })];
                case 4:
                    error_1 = _a.sent();
                    console.error("Failed to read short-memory directory:", error_1);
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
/**
 * Gets the latest stored conversation turns.
 * Returned turns are ordered from oldest to newest.
 * This function preserves internal memory data and is useful
 * for memory-layer operations.
 */
function getLatestStoredTurns(limit) {
    return __awaiter(this, void 0, void 0, function () {
        var files, collectedTurns, _i, files_1, fileName, turns;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (limit <= 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, getAvailableMemoryFiles()];
                case 1:
                    files = _a.sent();
                    if (files.length === 0) {
                        return [2 /*return*/, []];
                    }
                    collectedTurns = [];
                    _i = 0, files_1 = files;
                    _a.label = 2;
                case 2:
                    if (!(_i < files_1.length)) return [3 /*break*/, 5];
                    fileName = files_1[_i];
                    return [4 /*yield*/, readTurnsFromFile(fileName)];
                case 3:
                    turns = _a.sent();
                    collectedTurns.push.apply(collectedTurns, turns);
                    if (collectedTurns.length >= limit) {
                        return [3 /*break*/, 5];
                    }
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5: return [2 /*return*/, collectedTurns
                        .sort(function (first, second) {
                        return new Date(second.createdAt).getTime() -
                            new Date(first.createdAt).getTime();
                    })
                        .slice(0, limit)
                        .reverse()];
            }
        });
    });
}
/**
 * Returns recent conversation history in a compact format
 * suitable for the main Agent / LLM.
 *
 * Internal fields such as id, embedding and createdAt are omitted
 * to avoid unnecessary tokens in the LLM context.
 *
 * Messages are ordered from oldest to newest.
 */
function getRecentTurns() {
    return __awaiter(this, arguments, void 0, function (limit) {
        var turns;
        if (limit === void 0) { limit = REQUIRED_TURN_COUNT; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getLatestStoredTurns(limit)];
                case 1:
                    turns = _a.sent();
                    return [2 /*return*/, turns.flatMap(function (turn) { return [
                            {
                                role: "user",
                                content: turn.user.content,
                            },
                            {
                                role: "assistant",
                                content: turn.assistant.content,
                            },
                        ]; })];
            }
        });
    });
}
