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
exports.analyzeMemoryRelationships = analyzeMemoryRelationships;
var zod_1 = require("zod");
var llm_1 = require("../../llm");
var prompts_1 = require("./prompts");
var MEMORY_RELATIONSHIPS = [
    "COMPLEMENTS",
    "CONTRADICTS",
    "RELATED",
    "DUPLICATE",
    "UNRELATED",
];
/**
 * The model only classifies the factual relationship.
 *
 * Confidence and target metadata are generated locally.
 */
var relationshipDecisionSchema = zod_1.z
    .object({
    relationship: zod_1.z.enum(MEMORY_RELATIONSHIPS),
})
    .strict();
/**
 * Reuses the same cheap LLM wrapper for all relationship analyses.
 *
 * If initialization fails, the rejected promise is cleared so a later
 * operation can retry.
 */
var cheapRelationshipLlmPromise;
function getCheapRelationshipLlm() {
    if (!cheapRelationshipLlmPromise) {
        cheapRelationshipLlmPromise = (0, llm_1.getAsyncLLM)("cheap").catch(function (error) {
            cheapRelationshipLlmPromise = undefined;
            throw error;
        });
    }
    return cheapRelationshipLlmPromise;
}
function createAbortError() {
    return new DOMException("The operation was cancelled.", "AbortError");
}
function throwIfAborted(signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw createAbortError();
    }
}
/**
 * Analyzes the relationship between a new memory and every candidate.
 *
 * Important:
 * - Embedding similarity is only used for candidate retrieval and scoring.
 * - Every relationship, including DUPLICATE, is classified by the LLM.
 * - No semantic duplicate is inferred from embedding similarity alone.
 * - AbortError is allowed to propagate to the caller.
 */
function analyzeMemoryRelationships(newMemory, similarMemories, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var llm, structuredLlm, newComparableMemory, analyses;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    if (similarMemories.length === 0) {
                        return [2 /*return*/, []];
                    }
                    return [4 /*yield*/, getCheapRelationshipLlm()];
                case 1:
                    llm = _a.sent();
                    throwIfAborted(signal);
                    structuredLlm = llm.withStructuredOutput(relationshipDecisionSchema);
                    newComparableMemory = toComparableMemory(newMemory);
                    return [4 /*yield*/, Promise.all(similarMemories.map(function (similarMemory) {
                            return analyzeSingleMemoryRelationship(newComparableMemory, similarMemory, structuredLlm, signal);
                        }))];
                case 2:
                    analyses = _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, analyses];
            }
        });
    });
}
/**
 * Analyzes one candidate memory.
 *
 * The LLM is responsible for selecting the relationship, including
 * DUPLICATE. Similarity does not select or override the relationship.
 */
function analyzeSingleMemoryRelationship(newMemory, similarMemory, structuredLlm, signal) {
    return __awaiter(this, void 0, void 0, function () {
        var similarity, targetMemory, prompt, decision;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    throwIfAborted(signal);
                    similarity = normalizeSimilarity(similarMemory.similarity);
                    targetMemory = toComparableMemory(similarMemory.memory);
                    prompt = buildRelationshipPrompt(newMemory, targetMemory);
                    throwIfAborted(signal);
                    return [4 /*yield*/, structuredLlm.invoke(prompt, {
                            signal: signal,
                        })];
                case 1:
                    decision = _a.sent();
                    throwIfAborted(signal);
                    return [2 /*return*/, {
                            targetFileName: similarMemory.fileName,
                            targetMemoryId: similarMemory.memory.id,
                            similarity: similarity,
                            analysis: {
                                relationship: decision.relationship,
                                confidence: calculateConfidence(decision.relationship, similarity),
                            },
                        }];
            }
        });
    });
}
function buildRelationshipPrompt(newMemory, targetMemory) {
    return prompts_1.MEMORY_RELATIONSHIP_ANALYSIS_PROMPT
        .replace("{newMemory}", JSON.stringify(newMemory))
        .replace("{targetMemory}", JSON.stringify(targetMemory));
}
/**
 * Produces a local relationship score.
 *
 * This is not a probability reported by the model. Embedding similarity only
 * adjusts the score after the LLM has selected the relationship.
 *
 * DUPLICATE is scored conservatively because a false duplicate can cause an
 * important memory to be merged, replaced, or ignored.
 */
function calculateConfidence(relationship, similarity) {
    var confidence;
    switch (relationship) {
        case "DUPLICATE":
            /*
             * The LLM must first classify the pair as DUPLICATE.
             *
             * Similarity cannot independently create a duplicate result. It only
             * affects whether the model's duplicate decision is strong enough for
             * subsequent processing.
             */
            confidence = 0.25 + similarity * 0.75;
            break;
        case "COMPLEMENTS":
            confidence = 0.45 + similarity * 0.45;
            break;
        case "CONTRADICTS":
            /*
             * Contradictory statements can have high embedding similarity because
             * they often discuss the same entity and differ in one factual value.
             */
            confidence = 0.5 + similarity * 0.4;
            break;
        case "RELATED":
            confidence = 0.4 + similarity * 0.45;
            break;
        case "UNRELATED":
            /*
             * UNRELATED must never become a stored relationship link.
             */
            confidence = 0;
            break;
        default: {
            var exhaustiveCheck = relationship;
            return exhaustiveCheck;
        }
    }
    return roundConfidence(clamp(confidence, 0, 1));
}
/**
 * Creates a compact factual representation for the LLM.
 *
 * Excluded fields:
 * - id: target metadata is already handled locally;
 * - links: graph state does not define the direct factual relationship;
 * - embedding: vectors are not useful as prompt text;
 * - createdAt: storage time does not necessarily represent factual time.
 */
function toComparableMemory(memory) {
    var comparableMemory = {
        content: normalizeInputText(memory.content),
    };
    var context = normalizeOptionalInputText(memory.context);
    if (context !== undefined) {
        comparableMemory.context = context;
    }
    var key = normalizeKey(memory.key);
    if (key !== undefined) {
        comparableMemory.key = key;
    }
    var tags = normalizeStringArray(memory.tags);
    if (tags.length > 0) {
        comparableMemory.tags = tags;
    }
    if (hasMeaningfulValue(memory.time)) {
        comparableMemory.time = memory.time;
    }
    return comparableMemory;
}
function normalizeInputText(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ");
}
function normalizeOptionalInputText(value) {
    var normalized = normalizeInputText(value);
    return normalized.length > 0
        ? normalized
        : undefined;
}
/**
 * Supports both the old string key format and the newer string-array format.
 */
function normalizeKey(value) {
    if (typeof value === "string") {
        return normalizeOptionalInputText(value);
    }
    if (Array.isArray(value)) {
        var normalized = normalizeStringArray(value);
        return normalized.length > 0
            ? normalized
            : undefined;
    }
    return undefined;
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    var normalizedValues = value
        .filter(function (item) {
        return typeof item === "string";
    })
        .map(function (item) { return normalizeInputText(item); })
        .filter(function (item) {
        return item.length > 0;
    });
    return Array.from(new Set(normalizedValues));
}
function normalizeSimilarity(similarity) {
    if (!Number.isFinite(similarity)) {
        return 0;
    }
    return clamp(similarity, 0, 1);
}
function hasMeaningfulValue(value) {
    if (value === null ||
        value === undefined) {
        return false;
    }
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (typeof value === "object") {
        return Object.keys(value).length > 0;
    }
    return true;
}
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
function roundConfidence(confidence) {
    return Math.round(confidence * 1000) / 1000;
}
