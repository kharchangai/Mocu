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
exports.perplexitySearchTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var store_1 = require("../../../store");
/**
 * Perplexity Search Tool.
 * Automatically reads configuration (API Key, Base URL, Model Name) from settings.
 */
exports.perplexitySearchTool = (0, tools_1.tool)(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var settings, error_1, apiKey, baseUrl, modelName, cleanBaseUrl, url, payload, response, errorText, data, resultText, error_2;
    var _c, _d, _e;
    var query = _b.query;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0:
                console.log("[Perplexity Tool] Initiating search for query: \"".concat(query, "\""));
                _f.label = 1;
            case 1:
                _f.trys.push([1, 3, , 4]);
                return [4 /*yield*/, (0, store_1.readSettings)()];
            case 2:
                settings = _f.sent();
                return [3 /*break*/, 4];
            case 3:
                error_1 = _f.sent();
                console.error("[Perplexity Tool] Failed to read settings:", error_1);
                return [2 /*return*/, "Error: Failed to load application settings."];
            case 4:
                apiKey = settings.perplexityApiKey;
                baseUrl = settings.perplexityBaseUrl || "https://api.perplexity.ai";
                modelName = settings.perplexityModel || "sonar";
                console.log("[Perplexity Tool] Using Base URL: ".concat(baseUrl, " and Model: ").concat(modelName));
                if (!apiKey) {
                    console.error("[Perplexity Tool] Error: API Key is missing.");
                    return [2 /*return*/, "Error: Perplexity API key is not configured. Please check your settings."];
                }
                cleanBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
                url = "".concat(cleanBaseUrl, "/chat/completions");
                payload = {
                    model: modelName,
                    messages: [
                        {
                            role: "system",
                            content: "You are a precise web search assistant. Search the web and provide a factual, clear, and up-to-date summary answering the user's query. Provide links or sources if available."
                        },
                        {
                            role: "user",
                            content: query
                        }
                    ],
                };
                _f.label = 5;
            case 5:
                _f.trys.push([5, 10, , 11]);
                return [4 /*yield*/, fetch(url, {
                        method: "POST",
                        headers: {
                            "Authorization": "Bearer ".concat(apiKey),
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                    })];
            case 6:
                response = _f.sent();
                if (!!response.ok) return [3 /*break*/, 8];
                return [4 /*yield*/, response.text()];
            case 7:
                errorText = _f.sent();
                console.error("[Perplexity Tool] API error response: ".concat(response.status, " - ").concat(errorText));
                return [2 /*return*/, "Error: Perplexity API returned status ".concat(response.status, ". Details: ").concat(errorText)];
            case 8: return [4 /*yield*/, response.json()];
            case 9:
                data = _f.sent();
                resultText = (_e = (_d = (_c = data.choices) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.message) === null || _e === void 0 ? void 0 : _e.content;
                if (!resultText) {
                    console.warn("[Perplexity Tool] Received empty response from API.");
                    return [2 /*return*/, "No results found or empty response returned from the search API."];
                }
                console.log("[Perplexity Tool] Search completed successfully.");
                return [2 /*return*/, resultText];
            case 10:
                error_2 = _f.sent();
                console.error("[Perplexity Tool] Network or system error:", error_2);
                return [2 /*return*/, "Error: Failed to connect to Perplexity API. Details: ".concat(error_2)];
            case 11: return [2 /*return*/];
        }
    });
}); }, {
    name: "perplexity_search",
    description: "Search the live web using Perplexity to find real-time information, weather, news, current events, or general facts.",
    schema: zod_1.z.object({
        query: zod_1.z.string().describe("The search query to look up (e.g., 'who won the latest Formula 1 race')."),
    }),
});
