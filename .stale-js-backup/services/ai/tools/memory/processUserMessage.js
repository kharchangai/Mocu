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
exports.isAbortError = void 0;
exports.processUserMessage = processUserMessage;
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var zod_1 = require("zod");
var atomicMemoryExtractor_1 = require("./atomicMemoryExtractor");
var createMemory_1 = require("./createMemory");
var llm_1 = require("../../llm");
var prompts_1 = require("./prompts");
var MEMORY_DIRECTORY = "memory";
var memoryGateSchema = zod_1.z.object({
    shouldUseMemory: zod_1.z.boolean(),
    reason: zod_1.z.string().min(1),
});
var createAbortError = function () {
    return new DOMException("The operation was cancelled.", "AbortError");
};
var throwIfAborted = function (signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw createAbortError();
    }
};
var isAbortError = function (error) {
    if (error instanceof DOMException) {
        return error.name === "AbortError";
    }
    if (error instanceof Error) {
        return error.name === "AbortError";
    }
    return false;
};
exports.isAbortError = isAbortError;
/**
 * Processes one raw user message for long-term memory.
 */
function processUserMessage(userText, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var text, emptyResult, gate, error_1, error_2, atomicMemories, error_3, createdMemories, failures, _i, atomicMemories_1, atomicMemory, createdMemory, error_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    text = typeof userText === "string"
                        ? userText.trim()
                        : "";
                    emptyResult = {
                        userText: text,
                        gate: null,
                        atomicMemories: [],
                        createdMemories: [],
                        failures: [],
                    };
                    if (!text) {
                        return [2 /*return*/, emptyResult];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 4]);
                    throwIfAborted(signal);
                    return [4 /*yield*/, evaluateMemoryGate(text, signal)];
                case 2:
                    gate = _a.sent();
                    throwIfAborted(signal);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    if ((0, exports.isAbortError)(error_1)) {
                        throw error_1;
                    }
                    console.error("[Memory processing] Failed to evaluate memory gate:", error_1);
                    /*
                     * Fail closed:
                     * If the decision cannot be parsed, do not run the long-term
                     * memory extraction and creation pipeline.
                     */
                    return [2 /*return*/, __assign(__assign({}, emptyResult), { failures: [
                                {
                                    atomicMemory: text,
                                    error: "Memory gate evaluation failed: ".concat(getErrorMessage(error_1)),
                                },
                            ] })];
                case 4:
                    if (!gate.shouldUseMemory) {
                        console.log("[Memory gate] Skipped message. Reason: ".concat(gate.reason));
                        return [2 /*return*/, __assign(__assign({}, emptyResult), { gate: gate })];
                    }
                    _a.label = 5;
                case 5:
                    _a.trys.push([5, 7, , 8]);
                    throwIfAborted(signal);
                    return [4 /*yield*/, ensureMemoryDirectoryExists(signal)];
                case 6:
                    _a.sent();
                    throwIfAborted(signal);
                    return [3 /*break*/, 8];
                case 7:
                    error_2 = _a.sent();
                    if ((0, exports.isAbortError)(error_2)) {
                        throw error_2;
                    }
                    console.error("[Memory processing] Failed to ensure memory directory:", error_2);
                    return [2 /*return*/, __assign(__assign({}, emptyResult), { gate: gate, failures: [
                                {
                                    atomicMemory: text,
                                    error: getErrorMessage(error_2),
                                },
                            ] })];
                case 8:
                    _a.trys.push([8, 10, , 11]);
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, atomicMemoryExtractor_1.extractAtomicMemories)(text, signal)];
                case 9:
                    atomicMemories = _a.sent();
                    throwIfAborted(signal);
                    return [3 /*break*/, 11];
                case 10:
                    error_3 = _a.sent();
                    if ((0, exports.isAbortError)(error_3)) {
                        throw error_3;
                    }
                    console.error("[Memory processing] Failed to extract atomic memories:", error_3);
                    return [2 /*return*/, __assign(__assign({}, emptyResult), { gate: gate, failures: [
                                {
                                    atomicMemory: text,
                                    error: "Atomic memory extraction failed: ".concat(getErrorMessage(error_3)),
                                },
                            ] })];
                case 11:
                    if (atomicMemories.length === 0) {
                        return [2 /*return*/, __assign(__assign({}, emptyResult), { gate: gate, atomicMemories: atomicMemories })];
                    }
                    createdMemories = [];
                    failures = [];
                    _i = 0, atomicMemories_1 = atomicMemories;
                    _a.label = 12;
                case 12:
                    if (!(_i < atomicMemories_1.length)) return [3 /*break*/, 17];
                    atomicMemory = atomicMemories_1[_i];
                    throwIfAborted(signal);
                    _a.label = 13;
                case 13:
                    _a.trys.push([13, 15, , 16]);
                    return [4 /*yield*/, (0, createMemory_1.createMemory)(atomicMemory.content, signal)];
                case 14:
                    createdMemory = _a.sent();
                    throwIfAborted(signal);
                    createdMemories.push(createdMemory);
                    return [3 /*break*/, 16];
                case 15:
                    error_4 = _a.sent();
                    if ((0, exports.isAbortError)(error_4)) {
                        throw error_4;
                    }
                    console.error("[Memory processing] Failed to create memory:", atomicMemory.content, error_4);
                    failures.push({
                        atomicMemory: atomicMemory.content,
                        error: getErrorMessage(error_4),
                    });
                    return [3 /*break*/, 16];
                case 16:
                    _i++;
                    return [3 /*break*/, 12];
                case 17:
                    throwIfAborted(signal);
                    return [2 /*return*/, {
                            userText: text,
                            gate: gate,
                            atomicMemories: atomicMemories,
                            createdMemories: createdMemories,
                            failures: failures,
                        }];
            }
        });
    });
}
/**
 * Uses a normal LLM invoke call instead of withStructuredOutput().
 *
 * This avoids provider-specific structured-output failures, including
 * "Text: undefined" from OpenAI-compatible providers.
 */
function evaluateMemoryGate(userText, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var model, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    model = _a.sent();
                    throwIfAborted(signal);
                    return [4 /*yield*/, model.invoke([
                            {
                                role: "system",
                                content: buildMemoryGatePrompt(),
                            },
                            {
                                role: "user",
                                content: JSON.stringify({ userText: userText }),
                            },
                        ], {
                            signal: signal,
                        })];
                case 2:
                    response = _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, parseMemoryGateResponse(response.content)];
            }
        });
    });
}
function buildMemoryGatePrompt() {
    return "".concat(prompts_1.MEMORY_GATE_PROMPT, "\n\nReturn exactly one valid JSON object and nothing else.\n\nDo not use Markdown.\nDo not wrap the JSON in a code block.\nDo not write explanations before or after the JSON.\n\nThe required JSON format is:\n\n{\n  \"shouldUseMemory\": boolean,\n  \"reason\": string\n}\n\nRules:\n- \"shouldUseMemory\" must be true only if the user message contains\n  durable, useful information that should be stored in long-term memory.\n- \"reason\" must be a short non-empty string.\n");
}
function parseMemoryGateResponse(content) {
    var responseText = getTextFromLlmContent(content);
    if (!responseText) {
        throw new Error("Memory gate model returned an empty response.");
    }
    var jsonText = extractFirstJsonObject(responseText);
    if (!jsonText) {
        throw new Error("Memory gate response did not contain a JSON object. Response: ".concat(responseText));
    }
    var parsedValue;
    try {
        parsedValue = JSON.parse(jsonText);
    }
    catch (error) {
        throw new Error("Memory gate returned invalid JSON: ".concat(getErrorMessage(error)));
    }
    return memoryGateSchema.parse(parsedValue);
}
function getTextFromLlmContent(content) {
    if (typeof content === "string") {
        return content.trim();
    }
    if (!Array.isArray(content)) {
        return "";
    }
    return content
        .map(function (part) {
        if (typeof part === "string") {
            return part;
        }
        if (!part || typeof part !== "object") {
            return "";
        }
        if (typeof part.text === "string") {
            return part.text;
        }
        if (typeof part.content === "string") {
            return part.content;
        }
        return "";
    })
        .join("")
        .trim();
}
/**
 * Extracts the first complete JSON object while respecting quoted strings,
 * escaped quotes, and braces inside JSON string values.
 */
function extractFirstJsonObject(responseText) {
    var text = responseText
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "")
        .trim();
    var startIndex = text.indexOf("{");
    if (startIndex === -1) {
        return null;
    }
    var depth = 0;
    var isInsideString = false;
    var isEscaped = false;
    for (var index = startIndex; index < text.length; index += 1) {
        var character = text[index];
        if (isInsideString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (character === "\\") {
                isEscaped = true;
                continue;
            }
            if (character === '"') {
                isInsideString = false;
            }
            continue;
        }
        if (character === '"') {
            isInsideString = true;
            continue;
        }
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return text.slice(startIndex, index + 1);
            }
        }
    }
    return null;
}
/**
 * Ensures AppData/memory exists.
 */
function ensureMemoryDirectoryExists(signal) {
    return __awaiter(this, void 0, void 0, function () {
        var memoryDirectoryExists;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(MEMORY_DIRECTORY, {
                            baseDir: plugin_fs_1.BaseDirectory.AppData,
                        })];
                case 1:
                    memoryDirectoryExists = _a.sent();
                    throwIfAborted(signal);
                    if (memoryDirectoryExists) {
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
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
