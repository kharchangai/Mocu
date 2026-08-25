"use strict";
// main-agent.ts
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
exports.callMainAgent = void 0;
var messages_1 = require("@langchain/core/messages");
var abort_1 = require("./agent/abort");
var helpers_1 = require("./agent/helpers");
var memory_manager_1 = require("./agent/memory-manager");
var prompts_1 = require("./agent/prompts");
var llm_1 = require("./llm");
var tool_executor_1 = require("./agent/tool-executor");
var schedule_tool_1 = require("./tools/schedule-tool");
var desktop_vision_tool_1 = require("./tools/desktop-vision-tool");
var terminal_execution_tool_1 = require("./tools/terminal_execution_tool");
var perplexity_search_tool_1 = require("./tools/perplexity_search_tool");
var personalMemoryGate_1 = require("./tools/personalMemory/personalMemoryGate");
var generateMainAgentPrompt_1 = require("./tools/personalMemory/generateMainAgentPrompt");
var MAX_STEPS = 3;
/**
 * Cycle state is kept per conversation so that different chats
 * never mix their interactions.
 */
var personalMemoryCycles = new Map();
var getStringArg = function (args, key) {
    var value = args[key];
    return typeof value === "string" ? value : "";
};
var getConversationId = function (config) {
    var _a;
    var threadId = (_a = config.configurable) === null || _a === void 0 ? void 0 : _a.thread_id;
    if (typeof threadId === "string" &&
        threadId.trim()) {
        return threadId.trim();
    }
    if (typeof threadId === "number") {
        return String(threadId);
    }
    return "default";
};
var getPersonalMemoryCycle = function (conversationId) {
    var existingCycle = personalMemoryCycles.get(conversationId);
    if (existingCycle) {
        return existingCycle;
    }
    var newCycle = {
        pendingTurn: null,
    };
    personalMemoryCycles.set(conversationId, newCycle);
    return newCycle;
};
/**
 * Consumes the stored user/assistant turn and sends it to the
 * personal-memory gate together with the current user message.
 *
 * The pending turn is cleared before the background task starts,
 * so the same interaction can never be processed twice.
 *
 * Returns true when the current user message completed a cycle.
 * In that case the response generated for this message must not
 * be stored as the beginning of the next cycle.
 */
var runPersonalMemoryGateForCurrentMessage = function (currentUserMessage, conversationId) {
    if (!currentUserMessage.trim()) {
        return false;
    }
    var cycle = getPersonalMemoryCycle(conversationId);
    var previousTurn = cycle.pendingTurn;
    if (!previousTurn) {
        return false;
    }
    // Consume the pending turn immediately.
    cycle.pendingTurn = null;
    var gateInput = {
        userMessage: previousTurn.userMessage,
        assistantMessage: previousTurn.assistantMessage,
        nextUserMessage: currentUserMessage,
    };
    void (0, personalMemoryGate_1.runPersonalMemoryGate)(gateInput)
        .then(function (result) {
        console.log("[Personal Memory Gate] Background result:", result);
    })
        .catch(function (error) {
        console.error("[Personal Memory Gate] Background task failed:", error);
    });
    return true;
};
/**
 * Starts a new personal-memory cycle by storing the current
 * user message together with the assistant response.
 */
var startNewPersonalMemoryCycle = function (conversationId, userMessage, assistantMessage) {
    if (!userMessage.trim()) {
        return;
    }
    var cycle = getPersonalMemoryCycle(conversationId);
    cycle.pendingTurn = {
        userMessage: userMessage,
        assistantMessage: assistantMessage,
    };
};
var getPolicyPromptText = function (value) {
    if (typeof value === "string") {
        return value.trim();
    }
    if (value &&
        typeof value === "object" &&
        "prompt" in value &&
        typeof value.prompt === "string") {
        return value.prompt.trim();
    }
    if (value &&
        typeof value === "object" &&
        "policyPrompt" in value &&
        typeof value.policyPrompt === "string") {
        return value.policyPrompt.trim();
    }
    return "";
};
var appendPolicyToSystemPrompt = function (systemPrompt, policyPrompt) {
    if (!policyPrompt.trim()) {
        return systemPrompt;
    }
    return [
        systemPrompt,
        "",
        "## Personal Memory Policy",
        policyPrompt.trim(),
    ].join("\n");
};
var createToolExecutor = function (terminalTool, state, config) {
    var toolExecutor = new tool_executor_1.ToolExecutor();
    toolExecutor.registerTool({
        name: "schedule_action",
        description: "Creates, updates, or manages schedule actions.",
        execute: function (args) { return __awaiter(void 0, void 0, void 0, function () {
            var toolArgs;
            return __generator(this, function (_a) {
                toolArgs = args;
                return [2 /*return*/, schedule_tool_1.scheduleTool.invoke({
                        userRequest: getStringArg(toolArgs, "userRequest"),
                        chatHistory: state.messages,
                    }, config)];
            });
        }); },
    });
    toolExecutor.registerTool({
        name: "desktop_vision_action",
        description: "Performs desktop vision actions.",
        execute: function (args) { return __awaiter(void 0, void 0, void 0, function () {
            var toolArgs;
            return __generator(this, function (_a) {
                toolArgs = args;
                return [2 /*return*/, desktop_vision_tool_1.desktopVisionTool.invoke({
                        userRequest: getStringArg(toolArgs, "userRequest"),
                    }, config)];
            });
        }); },
    });
    toolExecutor.registerTool({
        name: "terminal_intent_executor",
        description: "Executes a terminal task based on a user intent.",
        execute: function (args) { return __awaiter(void 0, void 0, void 0, function () {
            var toolArgs;
            return __generator(this, function (_a) {
                toolArgs = args;
                return [2 /*return*/, terminalTool.invoke({
                        intent: getStringArg(toolArgs, "intent"),
                    }, config)];
            });
        }); },
    });
    toolExecutor.registerTool({
        name: "perplexity_search",
        description: "Searches the web using Perplexity.",
        execute: function (args) { return __awaiter(void 0, void 0, void 0, function () {
            var toolArgs;
            return __generator(this, function (_a) {
                toolArgs = args;
                return [2 /*return*/, perplexity_search_tool_1.perplexitySearchTool.invoke({
                        query: getStringArg(toolArgs, "query"),
                    }, config)];
            });
        }); },
    });
    return toolExecutor;
};
var callMainAgent = function (state, config) { return __awaiter(void 0, void 0, void 0, function () {
    var runnableConfig, signal, lastMessage, userText, conversationId, currentMessageCompletesMemoryCycle, personalPolicyPrompt, generatedPolicy, error_1, shortMemoryContext, relevantMemoryContext, llm, terminalTool, llmWithTools, toolExecutor, currentDateTime, baseSystemPrompt, systemPrompt, messagesToRun, response, toolResultsSummary, stepCount, toolMessages, _i, _a, toolCall, toolCallId, toolResult, rawToolResult, toolError_1, normalizedToolResult, finalAssistantContent, cleanContextPrompt, cleanMessages, plainLlm, finalResponse, completedMessages;
    var _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                runnableConfig = config !== null && config !== void 0 ? config : {};
                signal = runnableConfig.signal;
                (0, abort_1.throwIfAborted)(signal);
                lastMessage = state.messages[state.messages.length - 1];
                userText = lastMessage
                    ? (0, helpers_1.getTextContent)(lastMessage.content).trim()
                    : "";
                conversationId = getConversationId(runnableConfig);
                currentMessageCompletesMemoryCycle = runPersonalMemoryGateForCurrentMessage(userText, conversationId);
                personalPolicyPrompt = "";
                _c.label = 1;
            case 1:
                _c.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, generateMainAgentPrompt_1.generateMainAgentPolicyPrompt)(userText)];
            case 2:
                generatedPolicy = _c.sent();
                personalPolicyPrompt =
                    getPolicyPromptText(generatedPolicy);
                return [3 /*break*/, 4];
            case 3:
                error_1 = _c.sent();
                console.error("[Main Agent Policy] Failed to generate personal policy prompt:", error_1);
                return [3 /*break*/, 4];
            case 4:
                (0, abort_1.throwIfAborted)(signal);
                return [4 /*yield*/, (0, memory_manager_1.getShortMemoryContextForAgent)(userText, signal)];
            case 5:
                shortMemoryContext = _c.sent();
                (0, memory_manager_1.processMessageMemoryInBackground)(userText, signal);
                return [4 /*yield*/, (0, memory_manager_1.getLongTermMemoryContextForAgent)(userText, signal)];
            case 6:
                relevantMemoryContext = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                return [4 /*yield*/, (0, llm_1.getAsyncLLM)("expensive")];
            case 7:
                llm = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                terminalTool = (0, terminal_execution_tool_1.terminalExecutionTool)(llm);
                llmWithTools = llm.bindTools([
                    schedule_tool_1.scheduleTool,
                    desktop_vision_tool_1.desktopVisionTool,
                    terminalTool,
                    perplexity_search_tool_1.perplexitySearchTool,
                ]);
                toolExecutor = createToolExecutor(terminalTool, state, runnableConfig);
                currentDateTime = new Date().toLocaleString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                });
                baseSystemPrompt = (0, prompts_1.buildMainAgentSystemPrompt)({
                    shortMemoryContext: shortMemoryContext,
                    longTermMemoryContext: relevantMemoryContext,
                    currentDateTime: currentDateTime,
                });
                systemPrompt = appendPolicyToSystemPrompt(baseSystemPrompt, personalPolicyPrompt);
                messagesToRun = __spreadArray([
                    new messages_1.SystemMessage(systemPrompt)
                ], state.messages, true);
                return [4 /*yield*/, llmWithTools.invoke(messagesToRun, runnableConfig)];
            case 8:
                response = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                toolResultsSummary = [];
                stepCount = 0;
                _c.label = 9;
            case 9:
                if (!(response.tool_calls &&
                    response.tool_calls.length > 0 &&
                    stepCount < MAX_STEPS)) return [3 /*break*/, 19];
                (0, abort_1.throwIfAborted)(signal);
                console.log("[Main Agent] Tool call detected (Step ".concat(stepCount + 1, "):"), response.tool_calls);
                toolMessages = [];
                _i = 0, _a = response.tool_calls;
                _c.label = 10;
            case 10:
                if (!(_i < _a.length)) return [3 /*break*/, 17];
                toolCall = _a[_i];
                (0, abort_1.throwIfAborted)(signal);
                toolCallId = toolCall.id;
                if (!toolCallId) {
                    throw new Error("Missing tool call ID for ".concat(toolCall.name, "."));
                }
                toolResult = "";
                (0, helpers_1.dispatchAgentActivity)(toolCall.name);
                _c.label = 11;
            case 11:
                _c.trys.push([11, 13, 14, 15]);
                return [4 /*yield*/, toolExecutor.execute(toolCall.name, ((_b = toolCall.args) !== null && _b !== void 0 ? _b : {}))];
            case 12:
                rawToolResult = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                toolResult = (0, helpers_1.getToolResultText)(rawToolResult);
                return [3 /*break*/, 15];
            case 13:
                toolError_1 = _c.sent();
                if ((0, abort_1.isAbortError)(toolError_1)) {
                    throw toolError_1;
                }
                console.error("[Main Agent] Error executing ".concat(toolCall.name, ":"), toolError_1);
                toolResult =
                    "The requested operation failed. Continue naturally.";
                return [3 /*break*/, 15];
            case 14:
                (0, helpers_1.dispatchAgentActivity)(null);
                return [7 /*endfinally*/];
            case 15:
                normalizedToolResult = toolResult ||
                    "Task completed successfully.";
                toolMessages.push(new messages_1.ToolMessage({
                    content: normalizedToolResult,
                    tool_call_id: toolCallId,
                    name: toolCall.name,
                }));
                toolResultsSummary.push("[Result from ".concat(toolCall.name, " in Step ").concat(stepCount + 1, "]: ").concat(normalizedToolResult));
                _c.label = 16;
            case 16:
                _i++;
                return [3 /*break*/, 10];
            case 17:
                (0, abort_1.throwIfAborted)(signal);
                messagesToRun = __spreadArray(__spreadArray(__spreadArray([], messagesToRun, true), [
                    response
                ], false), toolMessages, true);
                return [4 /*yield*/, llmWithTools.invoke(messagesToRun, runnableConfig)];
            case 18:
                response = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                stepCount += 1;
                return [3 /*break*/, 9];
            case 19:
                finalAssistantContent = "";
                if (!(toolResultsSummary.length > 0)) return [3 /*break*/, 22];
                (0, abort_1.throwIfAborted)(signal);
                cleanContextPrompt = (0, prompts_1.buildToolResultSummaryPrompt)({
                    originalUserRequest: userText || "the user's request",
                    toolResultsSummary: toolResultsSummary,
                });
                cleanMessages = __spreadArray(__spreadArray([
                    new messages_1.SystemMessage(systemPrompt)
                ], state.messages, true), [
                    new messages_1.HumanMessage(cleanContextPrompt),
                ], false);
                return [4 /*yield*/, (0, llm_1.getAsyncLLM)()];
            case 20:
                plainLlm = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                return [4 /*yield*/, plainLlm.invoke(cleanMessages, runnableConfig)];
            case 21:
                finalResponse = _c.sent();
                (0, abort_1.throwIfAborted)(signal);
                finalAssistantContent = (0, helpers_1.stripMarkdown)((0, helpers_1.getTextContent)(finalResponse.content));
                return [3 /*break*/, 23];
            case 22:
                finalAssistantContent = (0, helpers_1.stripMarkdown)((0, helpers_1.getTextContent)(response.content));
                _c.label = 23;
            case 23:
                if (!finalAssistantContent) {
                    finalAssistantContent =
                        "Task completed successfully.";
                }
                response.content = finalAssistantContent;
                /*
                 * Store this turn only if the current user message did not
                 * complete the previous cycle.
                 *
                 * If it did complete the cycle, this assistant response is
                 * intentionally ignored and the next user message starts
                 * a completely new cycle.
                 */
                if (!currentMessageCompletesMemoryCycle) {
                    startNewPersonalMemoryCycle(conversationId, userText, finalAssistantContent);
                }
                completedMessages = __spreadArray(__spreadArray([], state.messages, true), [
                    response,
                ], false);
                (0, memory_manager_1.saveShortMemoryInBackground)(completedMessages);
                return [2 /*return*/, {
                        messages: [response],
                    }];
        }
    });
}); };
exports.callMainAgent = callMainAgent;
