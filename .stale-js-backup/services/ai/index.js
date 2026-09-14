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
exports.chatWithMocu = exports.generateSimpleAnswer = void 0;
// src/services/ai/index.ts
var messages_1 = require("@langchain/core/messages");
var langgraph_1 = require("@langchain/langgraph");
var graph_1 = require("./graph");
var llm_1 = require("./llm");
/*
 * In-memory checkpointer keeps per-thread conversation history,
 * so multi-turn chats (src/chat) get real context in the agent.
 *
 * When no thread_id is passed (e.g. the voice pipeline), each call
 * runs on its own ephemeral thread, same as before.
 */
var checkpointer = new langgraph_1.MemorySaver();
var app = graph_1.workflow.compile({ checkpointer: checkpointer });
var throwIfAborted = function (signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw new DOMException("The operation was cancelled.", "AbortError");
    }
};
/*
 * Generate a quick, stateless text answer.
 *
 * Used by extension LLM calls (`mocu.llm.generate`). Unlike
 * `chatWithMocu`, this is a single direct model completion with no
 * agent loop, no tools, and no memory retrieval — so it stays well
 * within the extension `extension.execute` timeout.
 */
var generateSimpleAnswer = function (prompt, signal) { return __awaiter(void 0, void 0, void 0, function () {
    var cleanPrompt, llm, response, content;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                throwIfAborted(signal);
                cleanPrompt = prompt.trim();
                if (!cleanPrompt) {
                    throw new Error("User input cannot be empty.");
                }
                return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
            case 1:
                llm = _a.sent();
                throwIfAborted(signal);
                return [4 /*yield*/, llm.invoke([new messages_1.HumanMessage(cleanPrompt)], signal ? { signal: signal } : undefined)];
            case 2:
                response = _a.sent();
                throwIfAborted(signal);
                content = response.content;
                if (typeof content === "string") {
                    return [2 /*return*/, content.trim()];
                }
                if (Array.isArray(content)) {
                    return [2 /*return*/, content
                            .map(function (block) {
                            return typeof block === "string"
                                ? block
                                : block &&
                                    typeof block === "object" &&
                                    "text" in block &&
                                    typeof block.text === "string"
                                    ? block.text
                                    : "";
                        })
                            .join("")
                            .trim()];
                }
                return [2 /*return*/, content == null ? "" : String(content)];
        }
    });
}); };
exports.generateSimpleAnswer = generateSimpleAnswer;
var chatWithMocu = function (userInput, signal, threadId) { return __awaiter(void 0, void 0, void 0, function () {
    var cleanUserInput, inputs, finalState, lastMessage, content, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                throwIfAborted(signal);
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                cleanUserInput = userInput.trim();
                if (!cleanUserInput) {
                    throw new Error("User input cannot be empty.");
                }
                inputs = {
                    messages: [
                        new messages_1.HumanMessage(cleanUserInput),
                    ],
                };
                return [4 /*yield*/, app.invoke(inputs, threadId
                        ? {
                            signal: signal,
                            configurable: { thread_id: threadId },
                        }
                        : { signal: signal })];
            case 2:
                finalState = _a.sent();
                throwIfAborted(signal);
                if (!finalState.messages ||
                    finalState.messages.length === 0) {
                    return [2 /*return*/, "No messages returned from graph."];
                }
                lastMessage = finalState.messages[finalState.messages.length - 1];
                content = lastMessage.content;
                if (typeof content === "string") {
                    return [2 /*return*/, content.trim()];
                }
                if (Array.isArray(content)) {
                    return [2 /*return*/, content
                            .map(function (block) {
                            if (typeof block === "string") {
                                return block;
                            }
                            if (block &&
                                typeof block === "object" &&
                                "text" in block &&
                                typeof block.text === "string") {
                                return block.text;
                            }
                            return "";
                        })
                            .join("")
                            .trim()];
                }
                if (content === null || content === undefined) {
                    return [2 /*return*/, ""];
                }
                return [2 /*return*/, JSON.stringify(content)];
            case 3:
                error_1 = _a.sent();
                /*
                 * An interruption is expected behavior, not an AI failure.
                 * Re-throw it so App.tsx can silently stop the current pipeline.
                 */
                if (error_1 instanceof DOMException &&
                    error_1.name === "AbortError") {
                    throw error_1;
                }
                if (error_1 instanceof Error &&
                    error_1.name === "AbortError") {
                    throw error_1;
                }
                console.error("Error in Mocu Graph:", error_1);
                return [2 /*return*/, "I encountered an error while processing your request."];
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.chatWithMocu = chatWithMocu;
