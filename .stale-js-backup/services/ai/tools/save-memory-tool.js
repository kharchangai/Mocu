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
exports.saveMemoryTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var path_1 = require("@tauri-apps/api/path");
var memory_tools_1 = require("./memory_tools");
var output_parsers_1 = require("@langchain/core/output_parsers");
var runnables_1 = require("@langchain/core/runnables");
var memory_prompts_1 = require("../prompts/memory-prompts");
// Define the Zod schema for standardizing LLM output
var fileDecisionSchema = zod_1.z.object({
    action: zod_1.z.enum(["UPDATE", "CREATE"]).describe("Whether to UPDATE an existing file or CREATE a new one."),
    filename: zod_1.z.string().describe("The exact filename, e.g., user_profile.md"),
    description: zod_1.z.string().optional().describe("A short 1-sentence description if creating a new file. Empty if updating."),
});
var jsonParser = output_parsers_1.StructuredOutputParser.fromZodSchema(fileDecisionSchema);
var stringParser = new output_parsers_1.StringOutputParser();
function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
}
function getMemoryPaths() {
    return __awaiter(this, void 0, void 0, function () {
        var baseDir, memoryRoot, personalDir, shortDir;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, path_1.appDataDir)()];
                case 1:
                    baseDir = _a.sent();
                    return [4 /*yield*/, (0, path_1.join)(baseDir, "memory")];
                case 2:
                    memoryRoot = _a.sent();
                    return [4 /*yield*/, (0, path_1.join)(memoryRoot, "Personal")];
                case 3:
                    personalDir = _a.sent();
                    return [4 /*yield*/, (0, path_1.join)(memoryRoot, "Short_Term")];
                case 4:
                    shortDir = _a.sent();
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(memoryRoot)];
                case 5:
                    if (!!(_a.sent())) return [3 /*break*/, 7];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(memoryRoot, { recursive: true })];
                case 6:
                    _a.sent();
                    _a.label = 7;
                case 7: return [4 /*yield*/, (0, plugin_fs_1.exists)(personalDir)];
                case 8:
                    if (!!(_a.sent())) return [3 /*break*/, 10];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(personalDir, { recursive: true })];
                case 9:
                    _a.sent();
                    _a.label = 10;
                case 10: return [4 /*yield*/, (0, plugin_fs_1.exists)(shortDir)];
                case 11:
                    if (!!(_a.sent())) return [3 /*break*/, 13];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(shortDir, { recursive: true })];
                case 12:
                    _a.sent();
                    _a.label = 13;
                case 13: return [2 /*return*/, { personalDir: personalDir, shortDir: shortDir }];
            }
        });
    });
}
exports.saveMemoryTool = (0, tools_1.tool)(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var llm, _c, personalDir, shortDir, resultMessages, safeStringChain, todayStr, dailyFilename, dailyFilePath, currentContent, mergedContent, initialContent, routeRawString, memoryType, guidePath, guideData, rawGuide, e_1, decisionPrompt, decisionChain, decision, parseError_1, filename, filePath, currentContent, mergedPersonalContent, filename, description, filePath, initialContent, error_1;
    var memoryToSave = _b.memoryToSave;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                _d.trys.push([0, 38, , 39]);
                return [4 /*yield*/, (0, memory_tools_1.getAsyncLLM)()];
            case 1:
                llm = _d.sent();
                return [4 /*yield*/, getMemoryPaths()];
            case 2:
                _c = _d.sent(), personalDir = _c.personalDir, shortDir = _c.shortDir;
                resultMessages = [];
                safeStringChain = runnables_1.RunnableSequence.from([llm, stringParser]);
                console.log("[Save Memory] Starting process for memory: \"".concat(memoryToSave, "\""));
                todayStr = getTodayDateString();
                dailyFilename = "".concat(todayStr, ".md");
                return [4 /*yield*/, (0, path_1.join)(shortDir, dailyFilename)];
            case 3:
                dailyFilePath = _d.sent();
                return [4 /*yield*/, (0, plugin_fs_1.exists)(dailyFilePath)];
            case 4:
                if (!_d.sent()) return [3 /*break*/, 8];
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(dailyFilePath)];
            case 5:
                currentContent = _d.sent();
                console.log("[Save Memory] Daily log exists. Merging new data...");
                return [4 /*yield*/, safeStringChain.invoke((0, memory_prompts_1.SMART_MERGE_PROMPT)(memoryToSave, currentContent))];
            case 6:
                mergedContent = _d.sent();
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(dailyFilePath, mergedContent.trim())];
            case 7:
                _d.sent();
                resultMessages.push("Added to daily log: ".concat(dailyFilename));
                return [3 /*break*/, 10];
            case 8:
                console.log("[Save Memory] No daily log found for today. Creating new...");
                initialContent = "# Daily Log - ".concat(todayStr, "\n\n- ").concat(memoryToSave);
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(dailyFilePath, initialContent)];
            case 9:
                _d.sent();
                resultMessages.push("Created new daily log: ".concat(dailyFilename));
                _d.label = 10;
            case 10: return [4 /*yield*/, safeStringChain.invoke(memory_prompts_1.ROUTE_MEMORY_TYPE_PROMPT + "\nMemory: \"".concat(memoryToSave, "\""))];
            case 11:
                routeRawString = _d.sent();
                memoryType = routeRawString.trim().toUpperCase();
                console.log("[Save Memory] Evaluated Route: ".concat(memoryType));
                if (!(memoryType.includes("CORE_KNOWLEDGE") || memoryType.includes("PERSONAL"))) return [3 /*break*/, 36];
                console.log("[Save Memory] Action: Proceeding to PERSONAL storage logic.");
                return [4 /*yield*/, (0, path_1.join)(personalDir, "guide.json")];
            case 12:
                guidePath = _d.sent();
                guideData = {};
                return [4 /*yield*/, (0, plugin_fs_1.exists)(guidePath)];
            case 13:
                if (!_d.sent()) return [3 /*break*/, 18];
                _d.label = 14;
            case 14:
                _d.trys.push([14, 16, , 17]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(guidePath)];
            case 15:
                rawGuide = _d.sent();
                guideData = JSON.parse(rawGuide);
                return [3 /*break*/, 17];
            case 16:
                e_1 = _d.sent();
                console.warn("[Save Memory] Warning: guide.json exists but is invalid JSON. Resetting to empty object.");
                return [3 /*break*/, 17];
            case 17: return [3 /*break*/, 20];
            case 18: return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(guidePath, JSON.stringify(guideData, null, 2))];
            case 19:
                _d.sent();
                _d.label = 20;
            case 20:
                console.log("[Save Memory] Current guide tracking ".concat(Object.keys(guideData).length, " categories."));
                decisionPrompt = (0, memory_prompts_1.PERSONAL_FILE_DECISION_PROMPT)(memoryToSave, JSON.stringify(guideData), jsonParser.getFormatInstructions());
                decisionChain = runnables_1.RunnableSequence.from([llm, stringParser, jsonParser]);
                decision = void 0;
                _d.label = 21;
            case 21:
                _d.trys.push([21, 23, , 24]);
                return [4 /*yield*/, decisionChain.invoke(decisionPrompt)];
            case 22:
                decision = _d.sent();
                console.log("[Save Memory] Structured Decision Extracted:", decision);
                return [3 /*break*/, 24];
            case 23:
                parseError_1 = _d.sent();
                console.error("[Save Memory] Parse Error! LLM failed to return valid JSON. Error:", parseError_1);
                resultMessages.push("Note: Evaluated as CORE_KNOWLEDGE but failed to determine file structure.");
                return [2 /*return*/, resultMessages.join(" | ")];
            case 24:
                if (!(decision.action === "UPDATE")) return [3 /*break*/, 31];
                filename = decision.filename.trim();
                return [4 /*yield*/, (0, path_1.join)(personalDir, filename)];
            case 25:
                filePath = _d.sent();
                currentContent = "";
                return [4 /*yield*/, (0, plugin_fs_1.exists)(filePath)];
            case 26:
                if (!_d.sent()) return [3 /*break*/, 28];
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath)];
            case 27:
                currentContent = _d.sent();
                _d.label = 28;
            case 28:
                console.log("[Save Memory] Updating personal file: ".concat(filename));
                return [4 /*yield*/, safeStringChain.invoke((0, memory_prompts_1.SMART_MERGE_PROMPT)(memoryToSave, currentContent))];
            case 29:
                mergedPersonalContent = _d.sent();
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, mergedPersonalContent.trim())];
            case 30:
                _d.sent();
                resultMessages.push("Updated personal memory: ".concat(filename));
                return [3 /*break*/, 35];
            case 31:
                if (!(decision.action === "CREATE")) return [3 /*break*/, 35];
                filename = decision.filename.trim();
                description = decision.description || "Personal memory file.";
                return [4 /*yield*/, (0, path_1.join)(personalDir, filename)];
            case 32:
                filePath = _d.sent();
                console.log("[Save Memory] Creating NEW personal file: ".concat(filename));
                initialContent = "# ".concat(filename.replace(".md", "").toUpperCase(), "\n\n- ").concat(memoryToSave);
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(filePath, initialContent)];
            case 33:
                _d.sent();
                guideData[filename] = description;
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(guidePath, JSON.stringify(guideData, null, 2))];
            case 34:
                _d.sent();
                console.log("[Save Memory] Updated guide.json with new file info.");
                resultMessages.push("Created personal file: ".concat(filename));
                _d.label = 35;
            case 35: return [3 /*break*/, 37];
            case 36:
                console.log("[Save Memory] Action: SKIPPED personal storage (Not Core Knowledge).");
                _d.label = 37;
            case 37:
                console.log("[Save Memory] Final Execution Summary:", resultMessages.join(" | "));
                return [2 /*return*/, resultMessages.join(" | ")];
            case 38:
                error_1 = _d.sent();
                console.error("[Save Memory Tool] Critical Error:", error_1);
                return [2 /*return*/, "An error occurred while saving the memory."];
            case 39: return [2 /*return*/];
        }
    });
}); }, {
    name: "save_memory",
    description: "Evaluates and saves new user facts, events, or rules into the appropriate long-term or short-term storage files.",
    schema: zod_1.z.object({
        memoryToSave: zod_1.z.string().describe("The new information or event that needs to be stored."),
    }),
});
