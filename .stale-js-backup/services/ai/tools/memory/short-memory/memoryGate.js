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
exports.getMemoryForAgent = getMemoryForAgent;
var zod_1 = require("zod");
var llm_1 = require("../../../llm");
var prompts_1 = require("./prompts");
var getRecentTurns_1 = require("./getRecentTurns");
var retrieveRelevantMemory_1 = require("./retrieveRelevantMemory");
var memoryGateSchema = zod_1.z.object({
    useRecentTurns: zod_1.z.boolean(),
    recentTurnCount: zod_1.z.number().int().min(0).max(10),
    useRelevantMemorySearch: zod_1.z.boolean(),
    reason: zod_1.z.string(),
});
function createEmptyDecision(reason) {
    if (reason === void 0) { reason = "No memory is needed."; }
    return {
        useRecentTurns: false,
        recentTurnCount: 0,
        useRelevantMemorySearch: false,
        reason: reason,
    };
}
function removeDuplicateMessages(messages) {
    var seen = new Set();
    return messages.filter(function (message) {
        var _a;
        var key = [
            message.role,
            message.content,
            (_a = message.createdAt) !== null && _a !== void 0 ? _a : "",
        ].join(":");
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
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
function removeCodeFence(text) {
    return text
        .trim()
        .replace(/^```(?:json|JSON)?\s*/u, "")
        .replace(/\s*```$/u, "")
        .trim();
}
function findJsonObject(text) {
    var cleanedText = removeCodeFence(text);
    if (cleanedText.startsWith("{") &&
        cleanedText.endsWith("}")) {
        return cleanedText;
    }
    var firstBraceIndex = cleanedText.indexOf("{");
    if (firstBraceIndex === -1) {
        return null;
    }
    var depth = 0;
    var insideString = false;
    var escaped = false;
    for (var index = firstBraceIndex; index < cleanedText.length; index += 1) {
        var character = cleanedText[index];
        if (insideString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (character === "\\") {
                escaped = true;
                continue;
            }
            if (character === '"') {
                insideString = false;
            }
            continue;
        }
        if (character === '"') {
            insideString = true;
            continue;
        }
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return cleanedText.slice(firstBraceIndex, index + 1);
            }
        }
    }
    return null;
}
function parseMemoryGateDecision(content) {
    var responseText = getTextFromLlmContent(content);
    if (!responseText) {
        throw new Error("The model returned an empty response.");
    }
    var jsonText = findJsonObject(responseText);
    if (!jsonText) {
        throw new Error("Could not find a JSON object in the model response: ".concat(responseText));
    }
    var parsedJson = JSON.parse(jsonText);
    return memoryGateSchema.parse(parsedJson);
}
function buildMemoryGateSystemPrompt() {
    return "".concat(prompts_1.memoryGatePrompt, "\n\nReturn exactly one valid JSON object.\n\nDo not use Markdown.\nDo not use a code block.\nDo not include any explanation before or after the JSON.\n\nThe JSON must have exactly this structure:\n\n{\n  \"useRecentTurns\": boolean,\n  \"recentTurnCount\": integer,\n  \"useRelevantMemorySearch\": boolean,\n  \"reason\": string\n}\n\nRules:\n- \"recentTurnCount\" must be an integer from 0 to 10.\n- Set \"recentTurnCount\" to 0 when \"useRecentTurns\" is false.\n- \"reason\" must be short.\n");
}
function getMemoryGateDecision(userMessage) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    llm = _a.sent();
                    return [4 /*yield*/, llm.invoke([
                            {
                                role: "system",
                                content: buildMemoryGateSystemPrompt(),
                            },
                            {
                                role: "user",
                                content: userMessage,
                            },
                        ])];
                case 2:
                    response = _a.sent();
                    return [2 /*return*/, parseMemoryGateDecision(response.content)];
            }
        });
    });
}
function getMemoryForAgent(userMessage) {
    return __awaiter(this, void 0, void 0, function () {
        var normalizedUserMessage, decision, memoryRequests, memoryGroups, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    normalizedUserMessage = userMessage.trim();
                    if (!normalizedUserMessage) {
                        return [2 /*return*/, {
                                messages: [],
                                decision: createEmptyDecision(),
                            }];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, getMemoryGateDecision(normalizedUserMessage)];
                case 2:
                    decision = _a.sent();
                    memoryRequests = [];
                    if (decision.useRecentTurns &&
                        decision.recentTurnCount > 0) {
                        memoryRequests.push((0, getRecentTurns_1.getRecentTurns)(decision.recentTurnCount));
                    }
                    if (decision.useRelevantMemorySearch) {
                        memoryRequests.push((0, retrieveRelevantMemory_1.retrieveRelevantShortMemory)(normalizedUserMessage));
                    }
                    if (memoryRequests.length === 0) {
                        return [2 /*return*/, {
                                messages: [],
                                decision: decision,
                            }];
                    }
                    return [4 /*yield*/, Promise.all(memoryRequests)];
                case 3:
                    memoryGroups = _a.sent();
                    return [2 /*return*/, {
                            messages: removeDuplicateMessages(memoryGroups.flat()),
                            decision: decision,
                        }];
                case 4:
                    error_1 = _a.sent();
                    console.error("Failed to process memory gate:", error_1);
                    return [2 /*return*/, {
                            messages: [],
                            decision: createEmptyDecision("Memory gate failed, so memory retrieval was skipped."),
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
