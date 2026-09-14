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
exports.memoryTool = exports.getAsyncLLM = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var openai_1 = require("@langchain/openai");
var output_parsers_1 = require("@langchain/core/output_parsers");
var runnables_1 = require("@langchain/core/runnables");
var memory_prompts_1 = require("../prompts/memory-prompts");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var store_1 = require("../../../store");
var save_memory_tool_1 = require("./save-memory-tool");
var retrieve_memory_tool_1 = require("./retrieve-memory-tool");
var fsOptions = { baseDir: plugin_fs_1.BaseDirectory.AppData };
function ensureMemoryReady() {
    return __awaiter(this, void 0, void 0, function () {
        var memoryRoot, personalDir, shortDir, longDir, personalGuidePath, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 16, , 17]);
                    memoryRoot = "memory";
                    personalDir = "memory/Personal";
                    shortDir = "memory/Short_Term";
                    longDir = "memory/Long_Term";
                    personalGuidePath = "memory/Personal/guide.json";
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(memoryRoot, fsOptions)];
                case 1:
                    if (!!(_a.sent())) return [3 /*break*/, 3];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(memoryRoot, __assign(__assign({}, fsOptions), { recursive: true }))];
                case 2:
                    _a.sent();
                    _a.label = 3;
                case 3: return [4 /*yield*/, (0, plugin_fs_1.exists)(personalDir, fsOptions)];
                case 4:
                    if (!!(_a.sent())) return [3 /*break*/, 6];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(personalDir, __assign(__assign({}, fsOptions), { recursive: true }))];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6: return [4 /*yield*/, (0, plugin_fs_1.exists)(shortDir, fsOptions)];
                case 7:
                    if (!!(_a.sent())) return [3 /*break*/, 9];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(shortDir, __assign(__assign({}, fsOptions), { recursive: true }))];
                case 8:
                    _a.sent();
                    _a.label = 9;
                case 9: return [4 /*yield*/, (0, plugin_fs_1.exists)(longDir, fsOptions)];
                case 10:
                    if (!!(_a.sent())) return [3 /*break*/, 12];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(longDir, __assign(__assign({}, fsOptions), { recursive: true }))];
                case 11:
                    _a.sent();
                    _a.label = 12;
                case 12: return [4 /*yield*/, (0, plugin_fs_1.exists)(personalGuidePath, fsOptions)];
                case 13:
                    if (!!(_a.sent())) return [3 /*break*/, 15];
                    return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(personalGuidePath, JSON.stringify({}, null, 2), fsOptions)];
                case 14:
                    _a.sent();
                    _a.label = 15;
                case 15: return [3 /*break*/, 17];
                case 16:
                    error_1 = _a.sent();
                    console.error("[Memory Tool] Directory initialization failed:", error_1);
                    return [3 /*break*/, 17];
                case 17: return [2 /*return*/];
            }
        });
    });
}
var getAsyncLLM = function () { return __awaiter(void 0, void 0, void 0, function () {
    var config, apiKey, baseUrl, llmModel;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, store_1.readSettings)()];
            case 1:
                config = _a.sent();
                apiKey = config.apiKey || "";
                baseUrl = config.baseUrl || "";
                llmModel = config.llmModel || "";
                return [2 /*return*/, new openai_1.ChatOpenAI({
                        apiKey: apiKey,
                        model: llmModel,
                        configuration: {
                            baseURL: baseUrl.trim().replace(/\/+$/, "")
                        },
                        dangerouslyAllowBrowser: true,
                    })];
        }
    });
}); };
exports.getAsyncLLM = getAsyncLLM;
var decisionSchema = zod_1.z.object({
    actions: zod_1.z.array(zod_1.z.enum(["SAVE", "RETRIEVE"])).describe("List of necessary actions. Empty array [] if NONE is needed."),
});
var stringParser = new output_parsers_1.StringOutputParser();
var jsonParser = output_parsers_1.StructuredOutputParser.fromZodSchema(decisionSchema);
// Memory Tool Definition
exports.memoryTool = (0, tools_1.tool)(function (input) { return __awaiter(void 0, void 0, void 0, function () {
    var userRequest, chatHistory, recentHistoryMessages, formattedHistory, prompt_1, modelInstance, decisionChain, decision, error_2, actions, combinedContext, retrievedResult, error_3, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 11, , 12]);
                userRequest = input.userRequest, chatHistory = input.chatHistory;
                if (!userRequest)
                    return [2 /*return*/, "No request provided."];
                return [4 /*yield*/, ensureMemoryReady()];
            case 1:
                _a.sent();
                recentHistoryMessages = chatHistory
                    ? chatHistory
                        .slice(Math.max(0, chatHistory.length - 11))
                        .map(function (msg) { return "".concat(msg._getType() === 'human' ? 'User' : 'Mocu', ": ").concat(msg.content); })
                    : [];
                formattedHistory = recentHistoryMessages.length > 0
                    ? recentHistoryMessages.join("\n")
                    : "No previous history in this session.";
                prompt_1 = "".concat(memory_prompts_1.MEMORY_DECISION_PROMPT, "\n\nRecent History:\n").concat(formattedHistory, "\n\nUser's Latest Input:\n\"").concat(userRequest, "\"\n\n").concat(jsonParser.getFormatInstructions());
                return [4 /*yield*/, (0, exports.getAsyncLLM)()];
            case 2:
                modelInstance = _a.sent();
                decisionChain = runnables_1.RunnableSequence.from([
                    modelInstance,
                    stringParser,
                    jsonParser
                ]);
                decision = void 0;
                _a.label = 3;
            case 3:
                _a.trys.push([3, 5, , 6]);
                return [4 /*yield*/, decisionChain.invoke(prompt_1)];
            case 4:
                decision = _a.sent();
                return [3 /*break*/, 6];
            case 5:
                error_2 = _a.sent();
                console.warn("[Memory Tool] Parser failed, fallback to empty actions:", error_2);
                decision = { actions: [] };
                return [3 /*break*/, 6];
            case 6:
                actions = decision.actions;
                if (actions.length === 0) {
                    return [2 /*return*/, "Memory check complete. No relevant memories needed to be saved or retrieved."];
                }
                combinedContext = "";
                if (actions.includes("SAVE")) {
                    // 🔥 CHANGE: Fire and Forget - no await!
                    save_memory_tool_1.saveMemoryTool.invoke({ memoryToSave: userRequest })
                        .then(function (saveResult) {
                        console.log("[Memory Tool] Background save completed:", saveResult);
                    })
                        .catch(function (error) {
                        console.error("[Memory Tool] Background save failed:", error);
                    });
                    // Don't wait - immediately continue
                    combinedContext += "[System Note: Save operation initiated in background.]\n\n";
                }
                if (!actions.includes("RETRIEVE")) return [3 /*break*/, 10];
                _a.label = 7;
            case 7:
                _a.trys.push([7, 9, , 10]);
                return [4 /*yield*/, retrieve_memory_tool_1.retrieveMemoryTool.invoke({ userQuery: userRequest })];
            case 8:
                retrievedResult = _a.sent();
                combinedContext += "[Historical Memory Context]:\n".concat(retrievedResult, "\n");
                return [3 /*break*/, 10];
            case 9:
                error_3 = _a.sent();
                console.error("[Memory Tool] Retrieval failed:", error_3);
                return [3 /*break*/, 10];
            case 10: return [2 /*return*/, combinedContext.trim()];
            case 11:
                error_4 = _a.sent();
                console.error("[Memory Tool] Critical execution error:", error_4);
                return [2 /*return*/, "An error occurred while accessing the memory system."];
            case 12: return [2 /*return*/];
        }
    });
}); }, {
    name: "memory_action",
    description: "Use this tool to SAVE new facts/preferences about the user, or RETRIEVE past memories/context about the user.",
    schema: zod_1.z.object({
        userRequest: zod_1.z.string().describe("The user's input related to the memory operation."),
    }),
});
