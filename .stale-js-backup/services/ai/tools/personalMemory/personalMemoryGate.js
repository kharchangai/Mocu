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
exports.runPersonalMemoryGate = runPersonalMemoryGate;
var llm_1 = require("../../llm");
var analyzeMemoryContext_1 = require("./memory/analyzeMemoryContext");
var zod_1 = require("zod");
var prompts_1 = require("./prompts");
var personalMemoryGateSchema = zod_1.z.object({
    isPersonalMemory: zod_1.z
        .boolean()
        .describe("True only if the interaction contains a reusable personal preference, concrete correction, stable user fact, or durable project/workflow fact."),
    reason: zod_1.z
        .string()
        .describe("A short explanation of why the interaction should be stored or skipped."),
});
var model = await (0, llm_1.getAsyncLLM)("medium");
var structuredModel = model.withStructuredOutput(personalMemoryGateSchema, {
    name: "personal_memory_gate_result",
});
/**
 * Checks whether a three-message interaction is suitable for personal memory.
 *
 * When the gate passes, analyzeFeedback is called before returning PASSED.
 * If it does not pass, { status: "SKIP", output: "SKIP" } is returned.
 */
function runPersonalMemoryGate(input) {
    return __awaiter(this, void 0, void 0, function () {
        var decision, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    validateInput(input);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, structuredModel.invoke([
                            {
                                role: "system",
                                content: prompts_1.PERSONAL_MEMORY_GATE_SYSTEM_PROMPT,
                            },
                            {
                                role: "user",
                                content: (0, prompts_1.createPersonalMemoryGateUserPrompt)(input),
                            },
                        ])];
                case 2:
                    decision = _a.sent();
                    if (!decision.isPersonalMemory) {
                        return [2 /*return*/, {
                                status: "SKIP",
                                output: "SKIP",
                                reason: decision.reason,
                            }];
                    }
                    return [4 /*yield*/, (0, analyzeMemoryContext_1.analyzeFeedback)({
                            user_request: input.userMessage,
                            agent_response: input.assistantMessage,
                            user_feedback: input.nextUserMessage,
                        })];
                case 3:
                    _a.sent();
                    return [2 /*return*/, {
                            status: "PASSED",
                            messages: input,
                            reason: decision.reason,
                        }];
                case 4:
                    error_1 = _a.sent();
                    console.error("Personal memory gate failed:", error_1);
                    // If the gate or memory analysis fails, do not store anything.
                    return [2 /*return*/, {
                            status: "SKIP",
                            output: "SKIP",
                            reason: "Memory gate failed, so the interaction was skipped safely.",
                        }];
                case 5: return [2 /*return*/];
            }
        });
    });
}
function validateInput(input) {
    if (!input.userMessage.trim()) {
        throw new Error("userMessage must not be empty.");
    }
    if (!input.assistantMessage.trim()) {
        throw new Error("assistantMessage must not be empty.");
    }
    if (!input.nextUserMessage.trim()) {
        throw new Error("nextUserMessage must not be empty.");
    }
}
