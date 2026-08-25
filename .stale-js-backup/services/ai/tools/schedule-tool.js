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
exports.scheduleTool = void 0;
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var plugin_fs_1 = require("@tauri-apps/plugin-fs");
var path_1 = require("@tauri-apps/api/path");
var memory_tools_1 = require("./memory_tools");
var output_parsers_1 = require("@langchain/core/output_parsers");
var runnables_1 = require("@langchain/core/runnables");
// Enhanced schema to support flexible deletions without needing an ID first
var internalDecisionSchema = zod_1.z.object({
    intent: zod_1.z.enum(["CREATE", "READ", "DELETE"]).describe("The determined intent of the user."),
    createData: zod_1.z.object({
        type: zod_1.z.enum(["TIMER", "PLANNER"]).describe("TIMER for quick alarms/reminders, PLANNER for calendar events."),
        targetTime: zod_1.z.string().describe("The calculated target date and time in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ). ALWAYS include 'Z'."),
        task: zod_1.z.string().describe("A brief English or Persian description of the task."),
        ttsText: zod_1.z.string().describe("A friendly, warm Persian reminder sentence that Mocu will read aloud when triggered.")
    }).optional(),
    readData: zod_1.z.object({
        date: zod_1.z.string().describe("The target date to query in YYYY-MM-DD format."),
        type: zod_1.z.enum(["TIMER", "PLANNER", "ALL"]).default("ALL").describe("Filter to retrieve only TIMER, only PLANNER, or ALL events.")
    }).optional(),
    deleteData: zod_1.z.object({
        id: zod_1.z.string().optional().describe("The unique ID of the timer or planner event to cancel/delete. Use this if available in history."),
        type: zod_1.z.enum(["TIMER", "PLANNER"]).describe("The type of the event to delete."),
        date: zod_1.z.string().optional().describe("The target date of the event in YYYY-MM-DD format. Required if type is PLANNER."),
        allOnDate: zod_1.z.boolean().optional().describe("Set to true if the user wants to cancel ALL plans/timers on this specific date, or conditionally cancel whatever exists."),
        taskKeyword: zod_1.z.string().optional().describe("A keyword to match the task description to delete (e.g., 'youtube') if deleting a specific task without an ID.")
    }).optional()
});
var jsonParser = output_parsers_1.StructuredOutputParser.fromZodSchema(internalDecisionSchema);
var stringParser = new output_parsers_1.StringOutputParser();
function getSchedulePaths() {
    return __awaiter(this, void 0, void 0, function () {
        var baseDir, scheduleRoot, plannerDir, timerPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, path_1.appDataDir)()];
                case 1:
                    baseDir = _a.sent();
                    return [4 /*yield*/, (0, path_1.join)(baseDir, "memory", "schedule")];
                case 2:
                    scheduleRoot = _a.sent();
                    return [4 /*yield*/, (0, path_1.join)(scheduleRoot, "planner")];
                case 3:
                    plannerDir = _a.sent();
                    return [4 /*yield*/, (0, plugin_fs_1.exists)(scheduleRoot)];
                case 4:
                    if (!!(_a.sent())) return [3 /*break*/, 6];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(scheduleRoot, { recursive: true })];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6: return [4 /*yield*/, (0, plugin_fs_1.exists)(plannerDir)];
                case 7:
                    if (!!(_a.sent())) return [3 /*break*/, 9];
                    return [4 /*yield*/, (0, plugin_fs_1.mkdir)(plannerDir, { recursive: true })];
                case 8:
                    _a.sent();
                    _a.label = 9;
                case 9: return [4 /*yield*/, (0, path_1.join)(scheduleRoot, "timer.json")];
                case 10:
                    timerPath = _a.sent();
                    return [2 /*return*/, { plannerDir: plannerDir, timerPath: timerPath }];
            }
        });
    });
}
function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}
var INTERNAL_SCHEDULER_PROMPT = "\nYou are an expert scheduling assistant. Your job is to analyze the user's request and determine their intent: CREATE a schedule/timer, READ existing schedules, or DELETE/CANCEL a schedule.\n\nCurrent Time (UTC): {currentTime}\n\nRecent Chat History for context:\n{history}\n\nUser Query: \"{query}\"\n\nAnalyze the query and history carefully:\n1. If the user wants to set, create, make, or schedule a new timer, reminder, alarm, or plan, select \"CREATE\".\n2. If the user wants to check, read, view, or ask what plans/timers they have, select \"READ\".\n3. If the user wants to cancel, delete, or remove a timer or plan (e.g., \"cancel that program\" or \"if I have a plan for the day after tomorrow, cancel it\"), select \"DELETE\".\n   - If the request is conditional (e.g., \"if I have plans on date X, cancel them\"), set intent to \"DELETE\".\n   - Fill \"deleteData\" fields:\n     * \"type\": \"PLANNER\" or \"TIMER\".\n     * \"date\": The calculated target date in YYYY-MM-DD format based on the query and Current Time.\n     * \"allOnDate\": Set to true if they want to cancel all plans on that day, or if they want to clear any existing plans on that date.\n     * \"taskKeyword\": Extract a keyword if they specified a specific task to delete (e.g., \"youtube\").\n     * \"id\": Only fill this if you see an exact ID in the recent chat history that the user is explicitly referring to.\n\nYou must output a JSON matching the requested schema.\nFormat Instructions:\n{formatInstructions}\n";
exports.scheduleTool = (0, tools_1.tool)(function (input) { return __awaiter(void 0, void 0, void 0, function () {
    var userRequest, chatHistory, llm, _a, plannerDir, timerPath, currentTimeIso, formattedHistory, formattedPrompt, scheduleChain, decision, eventId, targetTime, timers, rawTimers, _b, newTimer, targetDate, targetMonth, plannerFile, plannerFilePath, monthData, rawData, _c, newPlan, _d, date_1, type, result, _e, rawTimers, timers, _f, targetMonth, plannerFile, plannerFilePath, rawData, monthData, _g, _h, id_1, type, date_2, allOnDate, taskKeyword, rawTimers, timers, initialLength, targetMonth, plannerFile, plannerFilePath, rawData, monthData, deletedTasks_1, initialLength, planToDelete, normalizedKeyword_1, remainingPlans_1, taskNames, error_1;
    return __generator(this, function (_j) {
        switch (_j.label) {
            case 0:
                _j.trys.push([0, 41, , 42]);
                userRequest = input.userRequest, chatHistory = input.chatHistory;
                return [4 /*yield*/, (0, memory_tools_1.getAsyncLLM)()];
            case 1:
                llm = _j.sent();
                return [4 /*yield*/, getSchedulePaths()];
            case 2:
                _a = _j.sent(), plannerDir = _a.plannerDir, timerPath = _a.timerPath;
                currentTimeIso = new Date().toISOString();
                formattedHistory = chatHistory
                    ? chatHistory.map(function (m) { return "".concat(m._getType() === 'human' ? 'User' : 'Mocu', ": ").concat(m.content); }).join("\n")
                    : "No history provided.";
                formattedPrompt = INTERNAL_SCHEDULER_PROMPT
                    .replace("{currentTime}", currentTimeIso)
                    .replace("{history}", formattedHistory)
                    .replace("{query}", userRequest)
                    .replace("{formatInstructions}", jsonParser.getFormatInstructions());
                scheduleChain = runnables_1.RunnableSequence.from([llm, stringParser, jsonParser]);
                return [4 /*yield*/, scheduleChain.invoke(formattedPrompt)];
            case 3:
                decision = _j.sent();
                console.log("[Schedule Tool] Internal LLM Decision:", decision);
                if (!(decision.intent === "CREATE" && decision.createData)) return [3 /*break*/, 18];
                eventId = generateUUID();
                targetTime = decision.createData.targetTime;
                if (!targetTime.endsWith("Z")) {
                    targetTime += "Z";
                }
                if (!(decision.createData.type === "TIMER")) return [3 /*break*/, 10];
                timers = [];
                return [4 /*yield*/, (0, plugin_fs_1.exists)(timerPath)];
            case 4:
                if (!_j.sent()) return [3 /*break*/, 8];
                _j.label = 5;
            case 5:
                _j.trys.push([5, 7, , 8]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(timerPath)];
            case 6:
                rawTimers = _j.sent();
                timers = JSON.parse(rawTimers);
                return [3 /*break*/, 8];
            case 7:
                _b = _j.sent();
                return [3 /*break*/, 8];
            case 8:
                newTimer = {
                    id: eventId,
                    time: targetTime,
                    task: decision.createData.task,
                    tts_text: decision.createData.ttsText,
                    status: "PENDING"
                };
                timers.push(newTimer);
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(timerPath, JSON.stringify(timers, null, 2))];
            case 9:
                _j.sent();
                return [2 /*return*/, "Successfully set timer for ".concat(targetTime)];
            case 10:
                targetDate = targetTime.split("T")[0];
                targetMonth = targetDate.substring(0, 7);
                plannerFile = "".concat(targetMonth, ".json");
                return [4 /*yield*/, (0, path_1.join)(plannerDir, plannerFile)];
            case 11:
                plannerFilePath = _j.sent();
                monthData = {};
                return [4 /*yield*/, (0, plugin_fs_1.exists)(plannerFilePath)];
            case 12:
                if (!_j.sent()) return [3 /*break*/, 16];
                _j.label = 13;
            case 13:
                _j.trys.push([13, 15, , 16]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(plannerFilePath)];
            case 14:
                rawData = _j.sent();
                monthData = JSON.parse(rawData);
                return [3 /*break*/, 16];
            case 15:
                _c = _j.sent();
                return [3 /*break*/, 16];
            case 16:
                if (!monthData[targetDate]) {
                    monthData[targetDate] = [];
                }
                newPlan = {
                    id: eventId,
                    time: targetTime.split("T")[1], // HH:mm:ssZ
                    task: decision.createData.task,
                    tts_text: decision.createData.ttsText,
                    status: "PENDING"
                };
                monthData[targetDate].push(newPlan);
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(plannerFilePath, JSON.stringify(monthData, null, 2))];
            case 17:
                _j.sent();
                return [2 /*return*/, "Successfully added plan to calendar on ".concat(targetDate)];
            case 18:
                if (!(decision.intent === "READ" && decision.readData)) return [3 /*break*/, 31];
                _d = decision.readData, date_1 = _d.date, type = _d.type;
                result = { timers: [], planner: [] };
                _e = (type === "TIMER" || type === "ALL");
                if (!_e) return [3 /*break*/, 20];
                return [4 /*yield*/, (0, plugin_fs_1.exists)(timerPath)];
            case 19:
                _e = (_j.sent());
                _j.label = 20;
            case 20:
                if (!_e) return [3 /*break*/, 24];
                _j.label = 21;
            case 21:
                _j.trys.push([21, 23, , 24]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(timerPath)];
            case 22:
                rawTimers = _j.sent();
                timers = JSON.parse(rawTimers);
                result.timers = timers.filter(function (t) { return t.time.startsWith(date_1); });
                return [3 /*break*/, 24];
            case 23:
                _f = _j.sent();
                return [3 /*break*/, 24];
            case 24:
                if (!(type === "PLANNER" || type === "ALL")) return [3 /*break*/, 30];
                targetMonth = date_1.substring(0, 7);
                plannerFile = "".concat(targetMonth, ".json");
                return [4 /*yield*/, (0, path_1.join)(plannerDir, plannerFile)];
            case 25:
                plannerFilePath = _j.sent();
                return [4 /*yield*/, (0, plugin_fs_1.exists)(plannerFilePath)];
            case 26:
                if (!_j.sent()) return [3 /*break*/, 30];
                _j.label = 27;
            case 27:
                _j.trys.push([27, 29, , 30]);
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(plannerFilePath)];
            case 28:
                rawData = _j.sent();
                monthData = JSON.parse(rawData);
                result.planner = monthData[date_1] || [];
                return [3 /*break*/, 30];
            case 29:
                _g = _j.sent();
                return [3 /*break*/, 30];
            case 30:
                if (result.timers.length === 0 && result.planner.length === 0) {
                    return [2 /*return*/, "No schedules, plans, or timers found for ".concat(date_1, ".")];
                }
                return [2 /*return*/, JSON.stringify(result, null, 2)];
            case 31:
                if (!(decision.intent === "DELETE" && decision.deleteData)) return [3 /*break*/, 40];
                _h = decision.deleteData, id_1 = _h.id, type = _h.type, date_2 = _h.date, allOnDate = _h.allOnDate, taskKeyword = _h.taskKeyword;
                if (!(type === "TIMER")) return [3 /*break*/, 35];
                return [4 /*yield*/, (0, plugin_fs_1.exists)(timerPath)];
            case 32:
                if (!(_j.sent())) {
                    return [2 /*return*/, "No active timers or reminders found to cancel."];
                }
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(timerPath)];
            case 33:
                rawTimers = _j.sent();
                timers = JSON.parse(rawTimers);
                initialLength = timers.length;
                if (id_1) {
                    timers = timers.filter(function (t) { return t.id !== id_1; });
                }
                else if (date_2) {
                    timers = timers.filter(function (t) { return !t.time.startsWith(date_2); });
                }
                if (timers.length === initialLength) {
                    return [2 /*return*/, "Could not find any matching timer to cancel."];
                }
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(timerPath, JSON.stringify(timers, null, 2))];
            case 34:
                _j.sent();
                return [2 /*return*/, "Successfully cancelled the timer."];
            case 35:
                if (!date_2) {
                    return [2 /*return*/, "Error: Date is required to cancel a planner event."];
                }
                targetMonth = date_2.substring(0, 7);
                plannerFile = "".concat(targetMonth, ".json");
                return [4 /*yield*/, (0, path_1.join)(plannerDir, plannerFile)];
            case 36:
                plannerFilePath = _j.sent();
                return [4 /*yield*/, (0, plugin_fs_1.exists)(plannerFilePath)];
            case 37:
                if (!(_j.sent())) {
                    return [2 /*return*/, "No plans found for the date ".concat(date_2, ".")];
                }
                return [4 /*yield*/, (0, plugin_fs_1.readTextFile)(plannerFilePath)];
            case 38:
                rawData = _j.sent();
                monthData = JSON.parse(rawData);
                if (!monthData[date_2] || monthData[date_2].length === 0) {
                    return [2 /*return*/, "No plans found for the date ".concat(date_2, ".")];
                }
                deletedTasks_1 = [];
                initialLength = monthData[date_2].length;
                if (id_1) {
                    planToDelete = monthData[date_2].find(function (p) { return p.id === id_1; });
                    if (planToDelete)
                        deletedTasks_1.push(planToDelete.task);
                    monthData[date_2] = monthData[date_2].filter(function (p) { return p.id !== id_1; });
                }
                else if (allOnDate) {
                    deletedTasks_1 = monthData[date_2].map(function (p) { return p.task; });
                    delete monthData[date_2];
                }
                else if (taskKeyword) {
                    normalizedKeyword_1 = taskKeyword.toLowerCase();
                    remainingPlans_1 = [];
                    monthData[date_2].forEach(function (p) {
                        if (p.task.toLowerCase().includes(normalizedKeyword_1) || p.tts_text.toLowerCase().includes(normalizedKeyword_1)) {
                            deletedTasks_1.push(p.task);
                        }
                        else {
                            remainingPlans_1.push(p);
                        }
                    });
                    monthData[date_2] = remainingPlans_1;
                }
                else {
                    if (monthData[date_2].length === 1) {
                        deletedTasks_1.push(monthData[date_2][0].task);
                        delete monthData[date_2];
                    }
                    else {
                        taskNames = monthData[date_2].map(function (p) { return p.task; }).join(", ");
                        return [2 /*return*/, "Multiple plans found on ".concat(date_2, ": ").concat(taskNames, ". Please specify which one to cancel.")];
                    }
                }
                if (deletedTasks_1.length === 0) {
                    return [2 /*return*/, "No matching programs found to cancel."];
                }
                if (monthData[date_2] && monthData[date_2].length === 0) {
                    delete monthData[date_2];
                }
                return [4 /*yield*/, (0, plugin_fs_1.writeTextFile)(plannerFilePath, JSON.stringify(monthData, null, 2))];
            case 39:
                _j.sent();
                return [2 /*return*/, "Successfully cancelled the following programs on ".concat(date_2, ": ").concat(deletedTasks_1.join(", "))];
            case 40: return [2 /*return*/, "No valid schedule action could be determined."];
            case 41:
                error_1 = _j.sent();
                console.error("[Schedule Tool] Error during execution:", error_1);
                return [2 /*return*/, "An error occurred while managing your request."];
            case 42: return [2 /*return*/];
        }
    });
}); }, {
    name: "schedule_action",
    description: "Use this tool for ANY scheduling, timers, alarms, calendar events, checking schedules, or canceling/deleting schedules.",
    schema: zod_1.z.object({
        userRequest: zod_1.z.string().describe("The raw user query."),
    }),
});
