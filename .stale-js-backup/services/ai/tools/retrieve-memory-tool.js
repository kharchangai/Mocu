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
exports.retrieveMemoryTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var output_parsers_1 = require("@langchain/core/output_parsers");
var runnables_1 = require("@langchain/core/runnables");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var path_1 = require("@tauri-apps/api/path");
var memory_tools_1 = require("./memory_tools");
var memory_prompts_1 = require("../prompts/memory-prompts");
var stringParser = new output_parsers_1.StringOutputParser();
var fileSelectionSchema = zod_1.z.object({
    personal: zod_1.z.array(zod_1.z.string()).default([]),
    shortTerm: zod_1.z.array(zod_1.z.string()).default([]),
});
var jsonParser = output_parsers_1.StructuredOutputParser.fromZodSchema(fileSelectionSchema);
// Helper function to get memory paths securely in Tauri
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
// Helper to extract content using Rust's fs
function extractFromFile(llm, filePath, fileName, userQuery) {
    return __awaiter(this, void 0, void 0, function () {
        var content, prompt_1, chain, result, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(filePath)];
                case 1:
                    if (!(_a.sent()))
                        return [2 /*return*/, null];
                    return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(filePath)];
                case 2:
                    content = _a.sent();
                    if (!content.trim())
                        return [2 /*return*/, null];
                    prompt_1 = (0, memory_prompts_1.EXTRACT_FROM_SINGLE_FILE_PROMPT)(userQuery, fileName, content);
                    chain = runnables_1.RunnableSequence.from([llm, stringParser]);
                    return [4 /*yield*/, chain.invoke(prompt_1)];
                case 3:
                    result = (_a.sent()).trim();
                    if (result === "NONE" || !result)
                        return [2 /*return*/, null];
                    return [2 /*return*/, "[Source: ".concat(fileName, "]\n").concat(result)];
                case 4:
                    error_1 = _a.sent();
                    console.error("[Retrieve Tool] Error extracting from ".concat(fileName, ":"), error_1);
                    return [2 /*return*/, null];
                case 5: return [2 /*return*/];
            }
        });
    });
}
exports.retrieveMemoryTool = (0, tools_1.tool)(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
    var llm, _c, personalDir, shortDir, personalGuide, guidePath, _d, shortTermFiles, entries, _e, todayStr, basePrompt, selectPrompt, selectionChain, selectedFiles, _f, tasks, _i, _g, file, filePath, _h, _j, file, filePath, results, error_2;
    var userQuery = _b.userQuery;
    return __generator(this, function (_k) {
        switch (_k.label) {
            case 0:
                _k.trys.push([0, 26, , 27]);
                return [4 /*yield*/, (0, memory_tools_1.getAsyncLLM)()];
            case 1:
                llm = _k.sent();
                return [4 /*yield*/, getMemoryPaths()];
            case 2:
                _c = _k.sent(), personalDir = _c.personalDir, shortDir = _c.shortDir;
                personalGuide = "{}";
                return [4 /*yield*/, (0, path_1.join)(personalDir, "guide.json")];
            case 3:
                guidePath = _k.sent();
                return [4 /*yield*/, (0, plugin_fs_1.exists)(guidePath)];
            case 4:
                if (!_k.sent()) return [3 /*break*/, 8];
                _k.label = 5;
            case 5:
                _k.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(guidePath)];
            case 6:
                personalGuide = _k.sent();
                return [3 /*break*/, 8];
            case 7:
                _d = _k.sent();
                return [3 /*break*/, 8];
            case 8:
                shortTermFiles = [];
                _k.label = 9;
            case 9:
                _k.trys.push([9, 11, , 12]);
                return [4 /*yield*/, (0, plugin_fs_1.readDir)(shortDir)];
            case 10:
                entries = _k.sent();
                shortTermFiles = entries.map(function (e) { return e.name || ""; }).filter(function (name) { return name.endsWith(".md"); });
                return [3 /*break*/, 12];
            case 11:
                _e = _k.sent();
                return [3 /*break*/, 12];
            case 12:
                todayStr = new Date().toISOString().split('T')[0];
                basePrompt = (0, memory_prompts_1.SELECT_MEMORY_FILES_PROMPT)(userQuery, todayStr, personalGuide, shortTermFiles);
                selectPrompt = "".concat(basePrompt, "\n\n").concat(jsonParser.getFormatInstructions());
                selectionChain = runnables_1.RunnableSequence.from([llm, stringParser, jsonParser]);
                selectedFiles = void 0;
                _k.label = 13;
            case 13:
                _k.trys.push([13, 15, , 16]);
                return [4 /*yield*/, selectionChain.invoke(selectPrompt)];
            case 14:
                selectedFiles = _k.sent();
                return [3 /*break*/, 16];
            case 15:
                _f = _k.sent();
                selectedFiles = { personal: [], shortTerm: [] };
                return [3 /*break*/, 16];
            case 16:
                tasks = [];
                _i = 0, _g = selectedFiles.personal;
                _k.label = 17;
            case 17:
                if (!(_i < _g.length)) return [3 /*break*/, 20];
                file = _g[_i];
                return [4 /*yield*/, (0, path_1.join)(personalDir, file)];
            case 18:
                filePath = _k.sent();
                tasks.push(extractFromFile(llm, filePath, "Personal/".concat(file), userQuery));
                _k.label = 19;
            case 19:
                _i++;
                return [3 /*break*/, 17];
            case 20:
                _h = 0, _j = selectedFiles.shortTerm;
                _k.label = 21;
            case 21:
                if (!(_h < _j.length)) return [3 /*break*/, 24];
                file = _j[_h];
                return [4 /*yield*/, (0, path_1.join)(shortDir, file)];
            case 22:
                filePath = _k.sent();
                tasks.push(extractFromFile(llm, filePath, "Short_Term/".concat(file), userQuery));
                _k.label = 23;
            case 23:
                _h++;
                return [3 /*break*/, 21];
            case 24: return [4 /*yield*/, Promise.all(tasks)];
            case 25:
                results = (_k.sent()).filter(function (m) { return m !== null; });
                return [2 /*return*/, results.length > 0
                        ? results.join("\n\n")
                        : "No relevant historical details found in the selected files."];
            case 26:
                error_2 = _k.sent();
                console.error("[Retrieve Tool] Execution Error:", error_2);
                return [2 /*return*/, "An error occurred while retrieving memories."];
            case 27: return [2 /*return*/];
        }
    });
}); }, {
    name: "retrieve_memory",
    description: "Searches the memory directory for relevant past facts or daily logs and extracts only the strictly needed parts to answer the query.",
    schema: zod_1.z.object({
        userQuery: zod_1.z.string().describe("The user query or topic to search in the history."),
    }),
});
