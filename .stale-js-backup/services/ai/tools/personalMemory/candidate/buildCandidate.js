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
exports.buildConditionCandidate = buildConditionCandidate;
var zod_1 = require("zod");
var llm_1 = require("../../../llm");
var generateAtomicPolicy_1 = require("./generateAtomicPolicy");
var prompts_1 = require("./prompts");
var createMainAgentPolicies_1 = require("../policy/createMainAgentPolicies");
var NonEmptyStringSchema = zod_1.z
    .string()
    .trim()
    .min(1, {
    error: "Value cannot be empty.",
});
var OptionalNullableStringSchema = zod_1.z
    .string()
    .nullable()
    .optional();
var AnalyzeFeedbackSchema = zod_1.z.looseObject({
    user_request: NonEmptyStringSchema,
    agent_response: NonEmptyStringSchema,
    user_feedback: NonEmptyStringSchema,
    problem_summary: OptionalNullableStringSchema,
    problem_category: OptionalNullableStringSchema,
    task_type: OptionalNullableStringSchema,
    scope: OptionalNullableStringSchema,
    scope_description: OptionalNullableStringSchema,
    domain: OptionalNullableStringSchema,
    topic: OptionalNullableStringSchema,
    content_type: OptionalNullableStringSchema,
    project_id: OptionalNullableStringSchema,
});
var LlmOutputSchema = zod_1.z.object({
    activationDescription: NonEmptyStringSchema,
});
function normalizeOptionalString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    var normalizedValue = value.trim();
    return normalizedValue || undefined;
}
function extractJsonObject(content) {
    var trimmedContent = content.trim();
    if (trimmedContent.startsWith("{") &&
        trimmedContent.endsWith("}")) {
        return trimmedContent;
    }
    var fencedJsonMatch = trimmedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedJsonMatch === null || fencedJsonMatch === void 0 ? void 0 : fencedJsonMatch[1]) {
        var fencedContent = fencedJsonMatch[1].trim();
        if (fencedContent.startsWith("{") &&
            fencedContent.endsWith("}")) {
            return fencedContent;
        }
    }
    var firstBraceIndex = trimmedContent.indexOf("{");
    var lastBraceIndex = trimmedContent.lastIndexOf("}");
    if (firstBraceIndex >= 0 &&
        lastBraceIndex > firstBraceIndex) {
        return trimmedContent.slice(firstBraceIndex, lastBraceIndex + 1);
    }
    throw new Error("The condition candidate LLM response does not contain a JSON object.");
}
function getMessageContent(content) {
    if (typeof content === "string") {
        var normalizedContent = content.trim();
        if (normalizedContent) {
            return normalizedContent;
        }
    }
    if (Array.isArray(content)) {
        var text = content
            .map(function (part) {
            if (typeof part === "object" &&
                part !== null &&
                "text" in part &&
                typeof part.text === "string") {
                return part.text;
            }
            return "";
        })
            .join("")
            .trim();
        if (text) {
            return text;
        }
    }
    throw new Error("The condition candidate LLM returned an unsupported or empty message content format.");
}
function normalizeScope(analyzeFeedback) {
    var scope = {};
    var problemCategory = normalizeOptionalString(analyzeFeedback.problem_category);
    var taskType = normalizeOptionalString(analyzeFeedback.task_type);
    var normalizedScope = normalizeOptionalString(analyzeFeedback.scope);
    var scopeDescription = normalizeOptionalString(analyzeFeedback.scope_description);
    var domain = normalizeOptionalString(analyzeFeedback.domain);
    var topic = normalizeOptionalString(analyzeFeedback.topic);
    var contentType = normalizeOptionalString(analyzeFeedback.content_type);
    var projectId = normalizeOptionalString(analyzeFeedback.project_id);
    if (problemCategory) {
        scope.problemCategory =
            problemCategory;
    }
    if (taskType) {
        scope.taskType =
            taskType;
    }
    if (normalizedScope) {
        scope.scope =
            normalizedScope;
    }
    if (scopeDescription) {
        scope.scopeDescription =
            scopeDescription;
    }
    if (domain) {
        scope.domain =
            domain;
    }
    if (topic) {
        scope.topic =
            topic;
    }
    if (contentType) {
        scope.contentType =
            contentType;
    }
    if (projectId) {
        scope.projectId =
            projectId;
    }
    return scope;
}
function createPromptInput(analyzeFeedback, scope) {
    var problemSummary = normalizeOptionalString(analyzeFeedback.problem_summary);
    return {
        interaction: {
            userRequest: analyzeFeedback.user_request,
            agentResponse: analyzeFeedback.agent_response,
            userFeedback: analyzeFeedback.user_feedback,
        },
        analyzeFeedback: __assign(__assign({}, (problemSummary
            ? {
                problemSummary: problemSummary,
            }
            : {})), scope),
    };
}
/**
 * Builds a complete condition candidate.
 *
 * This function:
 * 1. Generates the activation description.
 * 2. Generates atomic policies.
 * 3. Resolves existing policy IDs.
 * 4. Creates, embeds, and stores missing policies.
 * 5. Returns the activation description together with all
 *    resolved atomic-policy references.
 *
 * Policy generation errors are propagated to prevent storing
 * an incomplete condition.
 */
function buildConditionCandidate(analyzeFeedbackInput) {
    return __awaiter(this, void 0, void 0, function () {
        var validationResult, analyzeFeedback, scope, promptInput, userPrompt, llm, response, content, jsonContent, parsedOutput, outputValidationResult, activationResult, atomicPolicyResult, mainAgentPolicies, conditionCandidate;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    validationResult = AnalyzeFeedbackSchema.safeParse(analyzeFeedbackInput);
                    if (!validationResult.success) {
                        throw new Error("Invalid analyzeFeedback input: ".concat(validationResult.error.message));
                    }
                    analyzeFeedback = validationResult.data;
                    scope = normalizeScope(analyzeFeedback);
                    promptInput = createPromptInput(analyzeFeedback, scope);
                    userPrompt = "\n".concat(prompts_1.conditionCandidateSystemPrompt, "\n\nCreate an activation description from the provided interaction and feedback analysis.\n\nReturn only valid JSON in exactly this format:\n{\n  \"activationDescription\": \"...\"\n}\n\nInput:\n").concat(JSON.stringify(promptInput, null, 2), "\n  ").trim();
                    return [4 /*yield*/, (0, llm_1.getAsyncLLM)("medium")];
                case 1:
                    llm = _d.sent();
                    return [4 /*yield*/, llm.invoke(userPrompt)];
                case 2:
                    response = _d.sent();
                    content = getMessageContent(response.content);
                    jsonContent = extractJsonObject(content);
                    try {
                        parsedOutput =
                            JSON.parse(jsonContent);
                    }
                    catch (_e) {
                        throw new Error("The condition candidate LLM returned invalid JSON.");
                    }
                    outputValidationResult = LlmOutputSchema.safeParse(parsedOutput);
                    if (!outputValidationResult.success) {
                        throw new Error("The condition candidate LLM returned an invalid output: ".concat(outputValidationResult.error.message));
                    }
                    activationResult = outputValidationResult.data;
                    console.log("Generated activation description:", JSON.stringify(activationResult, null, 2));
                    return [4 /*yield*/, (0, generateAtomicPolicy_1.generateAtomicPolicy)({
                            user_request: analyzeFeedback.user_request,
                            agent_response: analyzeFeedback.agent_response,
                            user_feedback: analyzeFeedback.user_feedback,
                            problem_summary: (_a = normalizeOptionalString(analyzeFeedback.problem_summary)) !== null && _a !== void 0 ? _a : "",
                            problem_category: (_b = normalizeOptionalString(analyzeFeedback.problem_category)) !== null && _b !== void 0 ? _b : "",
                            task_type: (_c = normalizeOptionalString(analyzeFeedback.task_type)) !== null && _c !== void 0 ? _c : "",
                            activation_description: activationResult.activationDescription,
                        })];
                case 3:
                    atomicPolicyResult = _d.sent();
                    console.log("Generated atomic policies:", JSON.stringify(atomicPolicyResult, null, 2));
                    return [4 /*yield*/, (0, createMainAgentPolicies_1.createMainAgentPolicies)({
                            user_request: analyzeFeedback.user_request,
                            agent_response: analyzeFeedback.agent_response,
                            user_feedback: analyzeFeedback.user_feedback,
                            atomic_policies: atomicPolicyResult.atomic_policies,
                        })];
                case 4:
                    mainAgentPolicies = _d.sent();
                    console.log("Resolved main-agent policies:", JSON.stringify(mainAgentPolicies, null, 2));
                    conditionCandidate = {
                        activationDescription: activationResult.activationDescription,
                        mainAgentPolicies: mainAgentPolicies,
                    };
                    console.log("Final condition candidate:", JSON.stringify(conditionCandidate, null, 2));
                    return [2 /*return*/, conditionCandidate];
            }
        });
    });
}
