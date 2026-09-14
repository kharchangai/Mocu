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
exports.desktopVisionTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var core_1 = require("@tauri-apps/api/core");
var messages_1 = require("@langchain/core/messages");
var openai_1 = require("@langchain/openai");
var store_1 = require("../../../store"); // Adjust the relative path if your store file is located elsewhere
exports.desktopVisionTool = (0, tools_1.tool)(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var settings, apiKey, baseURL, modelName, base64Image, visionLlm, formattedImageUrl, response, resultText, error_1;
    var userRequest = _b.userRequest;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                _c.trys.push([0, 4, , 5]);
                console.log("[Vision Tool] Loading settings from store...");
                return [4 /*yield*/, (0, store_1.readSettings)()];
            case 1:
                settings = _c.sent();
                apiKey = settings.visionApiKey || settings.apiKey;
                baseURL = settings.visionBaseUrl || settings.baseUrl;
                modelName = settings.visionModel || settings.llmModel || "gpt-4o-mini";
                if (!apiKey) {
                    return [2 /*return*/, "Error: No API Key configured. Please set your API Key in the settings menu."];
                }
                console.log("[Vision Tool] Triggering Rust capture_desktop command...");
                return [4 /*yield*/, (0, core_1.invoke)("capture_desktop")];
            case 2:
                base64Image = _c.sent();
                if (!base64Image) {
                    return [2 /*return*/, "Failed to capture the desktop screenshot."];
                }
                console.log("[Vision Tool] Screenshot captured successfully. Initializing Vision LLM (".concat(modelName, ")..."));
                visionLlm = new openai_1.ChatOpenAI({
                    model: modelName,
                    apiKey: apiKey,
                    configuration: {
                        baseURL: baseURL || undefined // Uses default OpenAI base URL if empty
                    },
                });
                console.log("[Vision Tool] Sending multimodal request to the vision model...");
                formattedImageUrl = base64Image.startsWith("data:image")
                    ? base64Image
                    : "data:image/png;base64,".concat(base64Image);
                return [4 /*yield*/, visionLlm.invoke([
                        new messages_1.HumanMessage({
                            content: [
                                {
                                    type: "text",
                                    text: "You are looking at the user's screen. Analyze this image to answer the user's request.\n              \n              User Request: \"".concat(userRequest, "\"\n\n              Provide a clear, direct, and helpful answer based on what you see.")
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: formattedImageUrl
                                    }
                                }
                            ]
                        })
                    ])];
            case 3:
                response = _c.sent();
                console.log("[Vision Tool] Analysis complete.");
                resultText = typeof response.content === 'string'
                    ? response.content
                    : Array.isArray(response.content)
                        ? response.content.map(function (item) { return (typeof item === 'string' ? item : item.text || ''); }).join(' ')
                        : JSON.stringify(response.content);
                console.log("[Vision Tool] Extracted text analysis:", resultText);
                return [2 /*return*/, resultText];
            case 4:
                error_1 = _c.sent();
                console.error("[Vision Tool Error]:", error_1);
                return [2 /*return*/, "An error occurred while capturing or analyzing your desktop screen."];
            case 5: return [2 /*return*/];
        }
    });
}); }, {
    name: "desktop_vision_action",
    description: "Use this tool ONLY when the user asks you to look at their screen, analyze their desktop, debug code visible on screen, or explain UI elements.",
    schema: zod_1.z.object({
        userRequest: zod_1.z.string().describe("The specific question, error message, or instruction the user has about their current screen."),
    }),
});
