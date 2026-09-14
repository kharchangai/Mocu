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
exports.processMessageMemoryInBackground = exports.getLongTermMemoryContextForAgent = exports.getShortMemoryContextForAgent = exports.buildShortMemoryContextForMainAgent = exports.removeDuplicateShortMemoryMessages = exports.extractShortMemoryMessages = exports.normalizeShortMemoryRole = exports.buildMemoryContextsForMainAgent = exports.saveShortMemoryInBackground = void 0;
var abort_1 = require("./abort");
var helpers_1 = require("./helpers");
var findRelevantMemories_1 = require("../tools/memory/findRelevantMemories");
var processUserMessage_1 = require("../tools/memory/processUserMessage");
var shortMemory_1 = require("../tools/memory/short-memory/shortMemory");
var memoryGate_1 = require("../tools/memory/short-memory/memoryGate");
/**
 * Saves a completed conversation turn in the background.
 *
 * This operation never blocks the final agent response.
 */
var saveShortMemoryInBackground = function (messages) {
    void (0, shortMemory_1.saveShortMemoryTurn)({ messages: messages })
        .then(function () {
        console.log("[Short Memory] Turn saved successfully.");
    })
        .catch(function (error) {
        console.error("[Short Memory] Failed to save turn:", error);
    });
};
exports.saveShortMemoryInBackground = saveShortMemoryInBackground;
/**
 * Creates the long-term memory block sent to the main agent.
 *
 * Only memory contexts are returned.
 * Internal IDs, tags, embeddings, scores, paths, and metadata are not
 * included in the final prompt context.
 */
var buildMemoryContextsForMainAgent = function (selectedMemories, neighborMemories) {
    if (selectedMemories === void 0) { selectedMemories = []; }
    if (neighborMemories === void 0) { neighborMemories = []; }
    var contexts = __spreadArray(__spreadArray([], selectedMemories, true), neighborMemories, true).map(function (memory) { var _a; return (_a = memory.context) === null || _a === void 0 ? void 0 : _a.trim(); })
        .filter(function (context) {
        return typeof context === "string" &&
            context.length > 0;
    });
    if (contexts.length === 0) {
        return "";
    }
    return contexts
        .map(function (context, index) {
        return "[Memory Context ".concat(index + 1, "]\n").concat(context);
    })
        .join("\n\n");
};
exports.buildMemoryContextsForMainAgent = buildMemoryContextsForMainAgent;
/**
 * Converts supported message roles to the two roles that are sent to
 * the main agent.
 */
var normalizeShortMemoryRole = function (role) {
    if (role === "user" || role === "human") {
        return "user";
    }
    if (role === "assistant" || role === "ai") {
        return "assistant";
    }
    return null;
};
exports.normalizeShortMemoryRole = normalizeShortMemoryRole;
/**
 * Extracts short-memory messages from direct or nested search results.
 *
 * Supported formats:
 *
 * {
 *   role: "user",
 *   content: "..."
 * }
 *
 * {
 *   userContent: "...",
 *   assistantContent: "..."
 * }
 *
 * {
 *   messages: [...]
 * }
 */
var extractShortMemoryMessages = function (value) {
    var extractedMessages = [];
    var visited = new Set();
    var visit = function (item) {
        var _a;
        if (Array.isArray(item)) {
            for (var _i = 0, item_1 = item; _i < item_1.length; _i++) {
                var child = item_1[_i];
                visit(child);
            }
            return;
        }
        if (!(0, helpers_1.isRecord)(item)) {
            return;
        }
        if (visited.has(item)) {
            return;
        }
        visited.add(item);
        var role = (0, exports.normalizeShortMemoryRole)((_a = item.role) !== null && _a !== void 0 ? _a : item.type);
        var content = (0, helpers_1.getTextContent)(item.content);
        var createdAt = typeof item.createdAt === "string"
            ? item.createdAt
            : undefined;
        if (role && content.trim()) {
            extractedMessages.push({
                role: role,
                content: content.trim(),
                createdAt: createdAt,
            });
        }
        var userContent = typeof item.userContent === "string"
            ? item.userContent.trim()
            : "";
        if (userContent) {
            extractedMessages.push({
                role: "user",
                content: userContent,
                createdAt: createdAt,
            });
        }
        var assistantContent = typeof item.assistantContent === "string"
            ? item.assistantContent.trim()
            : "";
        if (assistantContent) {
            extractedMessages.push({
                role: "assistant",
                content: assistantContent,
                createdAt: createdAt,
            });
        }
        if (Array.isArray(item.messages)) {
            visit(item.messages);
        }
    };
    visit(value);
    return extractedMessages;
};
exports.extractShortMemoryMessages = extractShortMemoryMessages;
/**
 * Removes duplicate short-memory messages while preserving the original
 * order of the first occurrence.
 */
var removeDuplicateShortMemoryMessages = function (messages) {
    var _a, _b;
    var seen = new Set();
    var uniqueMessages = [];
    for (var _i = 0, messages_1 = messages; _i < messages_1.length; _i++) {
        var message = messages_1[_i];
        var role = (0, exports.normalizeShortMemoryRole)((_a = message.role) !== null && _a !== void 0 ? _a : message.type);
        var content = (0, helpers_1.getTextContent)(message.content).trim();
        if (!role || !content) {
            continue;
        }
        var key = [
            role,
            content,
            (_b = message.createdAt) !== null && _b !== void 0 ? _b : "",
        ].join("::");
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        uniqueMessages.push({
            role: role,
            content: content,
            createdAt: message.createdAt,
        });
    }
    return uniqueMessages;
};
exports.removeDuplicateShortMemoryMessages = removeDuplicateShortMemoryMessages;
/**
 * Converts retrieved short-memory messages into a safe prompt context.
 *
 * Only user content, assistant content, and optional dates are included.
 * Internal metadata is intentionally omitted.
 */
var buildShortMemoryContextForMainAgent = function (result) {
    var extractedMessages = (0, exports.extractShortMemoryMessages)(result.messages);
    var validMessages = (0, exports.removeDuplicateShortMemoryMessages)(extractedMessages);
    if (validMessages.length === 0) {
        return "";
    }
    return validMessages
        .map(function (message) {
        var role = message.role === "user"
            ? "User"
            : "Assistant";
        var content = (0, helpers_1.getTextContent)(message.content).trim();
        var date = typeof message.createdAt === "string" &&
            message.createdAt.trim()
            ? "\nDate: ".concat(message.createdAt.trim())
            : "";
        return "".concat(role, ": ").concat(content).concat(date);
    })
        .join("\n\n");
};
exports.buildShortMemoryContextForMainAgent = buildShortMemoryContextForMainAgent;
/**
 * Retrieves relevant short-term conversation context for the main agent.
 *
 * Any retrieval failure returns an empty context so memory failures never
 * prevent the user from receiving an answer.
 */
var getShortMemoryContextForAgent = function (userText, signal) { return __awaiter(void 0, void 0, void 0, function () {
    var rawShortMemoryResult, shortMemoryResult, extractedMessages, shortMemoryContext, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!userText.trim()) {
                    return [2 /*return*/, ""];
                }
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                (0, abort_1.throwIfAborted)(signal);
                console.log("[Short Memory] Running memory gate for:", userText);
                return [4 /*yield*/, (0, memoryGate_1.getMemoryForAgent)(userText)];
            case 2:
                rawShortMemoryResult = _a.sent();
                (0, abort_1.throwIfAborted)(signal);
                shortMemoryResult = rawShortMemoryResult;
                console.log("[Short Memory] Gate decision:", shortMemoryResult.decision);
                console.log("[Short Memory] Retrieved result:", shortMemoryResult);
                console.log("[Short Memory] Retrieved messages:", shortMemoryResult.messages);
                extractedMessages = (0, exports.extractShortMemoryMessages)(shortMemoryResult.messages);
                console.log("[Short Memory] Extracted messages:", extractedMessages);
                shortMemoryContext = (0, exports.buildShortMemoryContextForMainAgent)(shortMemoryResult);
                if (shortMemoryContext) {
                    console.log("[Short Memory] Context prepared for main agent:", shortMemoryContext);
                }
                else {
                    console.log("[Short Memory] No context found for main agent.");
                }
                return [2 /*return*/, shortMemoryContext];
            case 3:
                error_1 = _a.sent();
                if ((0, abort_1.isAbortError)(error_1)) {
                    throw error_1;
                }
                console.error("[Short Memory] Failed to get memory for agent:", error_1);
                return [2 /*return*/, ""];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getShortMemoryContextForAgent = getShortMemoryContextForAgent;
/**
 * Retrieves relevant long-term memory context for the main agent.
 *
 * Any retrieval failure returns an empty context so memory failures never
 * prevent the user from receiving an answer.
 */
var getLongTermMemoryContextForAgent = function (userText, signal) { return __awaiter(void 0, void 0, void 0, function () {
    var memoryResult, _a, _b, selectedMemories, _c, neighborMemories, relevantMemoryContext, error_2;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                if (!userText.trim()) {
                    return [2 /*return*/, ""];
                }
                _d.label = 1;
            case 1:
                _d.trys.push([1, 3, , 4]);
                (0, abort_1.throwIfAborted)(signal);
                console.log("[Memory] User text:", userText);
                return [4 /*yield*/, (0, findRelevantMemories_1.findRelevantMemories)(userText)];
            case 2:
                memoryResult = _d.sent();
                (0, abort_1.throwIfAborted)(signal);
                console.log("[Memory] Raw retrieval result:", memoryResult);
                _a = memoryResult, _b = _a.selectedMemories, selectedMemories = _b === void 0 ? [] : _b, _c = _a.neighborMemories, neighborMemories = _c === void 0 ? [] : _c;
                console.log("[Memory] Selected memories:", selectedMemories);
                console.log("[Memory] Neighbor memories:", neighborMemories);
                relevantMemoryContext = (0, exports.buildMemoryContextsForMainAgent)(selectedMemories, neighborMemories);
                if (relevantMemoryContext) {
                    console.log("[Memory] Context sent to main agent:", relevantMemoryContext);
                }
                else {
                    console.log("[Memory] No long-term context found.");
                }
                return [2 /*return*/, relevantMemoryContext];
            case 3:
                error_2 = _d.sent();
                if ((0, abort_1.isAbortError)(error_2)) {
                    throw error_2;
                }
                console.error("[Memory] Failed to retrieve relevant memories:", error_2);
                return [2 /*return*/, ""];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.getLongTermMemoryContextForAgent = getLongTermMemoryContextForAgent;
/**
 * Starts long-term memory processing without blocking the agent response.
 *
 * If the user cancels the request, memory processing is cancelled too.
 */
var processMessageMemoryInBackground = function (userText, signal) {
    if (!userText.trim() || (signal === null || signal === void 0 ? void 0 : signal.aborted)) {
        return;
    }
    void (0, processUserMessage_1.processUserMessage)(userText, signal)
        .then(function (result) {
        console.log("[Memory] Background processing completed:", result);
    })
        .catch(function (error) {
        if ((0, abort_1.isAbortError)(error)) {
            console.log("[Memory] Background processing cancelled.");
            return;
        }
        console.error("[Memory] Background processing failed:", error);
    });
};
exports.processMessageMemoryInBackground = processMessageMemoryInBackground;
