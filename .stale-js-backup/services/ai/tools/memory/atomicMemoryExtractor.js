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
exports.AtomicMemoryExtractionSchema = exports.AtomicMemorySchema = void 0;
exports.extractAtomicMemories = extractAtomicMemories;
var zod_1 = require("zod");
var messages_1 = require("@langchain/core/messages");
var llm_1 = require("../../llm");
var prompts_1 = require("./prompts");
exports.AtomicMemorySchema = zod_1.z.object({
    content: zod_1.z.string().trim().min(1),
});
exports.AtomicMemoryExtractionSchema = zod_1.z.object({
    memories: zod_1.z.array(exports.AtomicMemorySchema),
});
/**
 * Raw JSON Schema for the provider.
 *
 * Do not add `description`, `title`, `default`, or `$ref` here.
 * Some OpenAI-compatible providers reject schemas where `$ref`
 * is combined with additional JSON Schema keywords.
 */
var AtomicMemoryExtractionJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
        memories: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                properties: {
                    content: {
                        type: "string",
                    },
                },
                required: ["content"],
            },
        },
    },
    required: ["memories"],
};
var createAbortError = function () {
    return new DOMException("The operation was cancelled.", "AbortError");
};
var throwIfAborted = function (signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw createAbortError();
    }
};
var isAbortError = function (error) {
    return (error instanceof DOMException &&
        error.name === "AbortError") || (error instanceof Error &&
        error.name === "AbortError");
};
/**
 * Extracts independent atomic memory candidates from a raw user message.
 *
 * Cancellation behavior:
 * - Throws AbortError when the signal is aborted.
 * - Passes the signal to the structured LLM invocation.
 * - Does not convert cancellation into an empty array, because the caller
 *   must stop the complete memory pipeline immediately.
 *
 * This function only extracts standalone memory statements.
 * It does not create IDs, keys, tags, contexts, embeddings, links,
 * timestamps, files, or database records.
 */
function extractAtomicMemories(userText, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var text, model, structuredModel, result, validatedResult, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    text = userText === null || userText === void 0 ? void 0 : userText.trim();
                    if (!text) {
                        return [2 /*return*/, []];
                    }
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 4, , 5]);
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 2:
                    model = _a.sent();
                    throwIfAborted(signal);
                    structuredModel = model.withStructuredOutput(AtomicMemoryExtractionJsonSchema, {
                        name: "atomic_memory_extraction",
                    });
                    return [4 /*yield*/, structuredModel.invoke([
                            new messages_1.SystemMessage(prompts_1.ATOMIC_MEMORY_EXTRACTION_PROMPT),
                            new messages_1.HumanMessage(text),
                        ], {
                            signal: signal,
                        })];
                case 3:
                    result = _a.sent();
                    throwIfAborted(signal);
                    validatedResult = exports.AtomicMemoryExtractionSchema.safeParse(result);
                    if (!validatedResult.success) {
                        console.error("[Atomic memory extraction] Invalid structured response:", validatedResult.error);
                        return [2 /*return*/, []];
                    }
                    return [2 /*return*/, validatedResult.data.memories];
                case 4:
                    error_1 = _a.sent();
                    /*
                     * Cancellation must be propagated to processUserMessage.
                     * Returning [] here would make the upper layer think extraction
                     * completed normally and may allow later work to continue.
                     */
                    if (isAbortError(error_1)) {
                        throw error_1;
                    }
                    console.error("[Atomic memory extraction] Failed:", error_1);
                    return [2 /*return*/, []];
                case 5: return [2 /*return*/];
            }
        });
    });
}
