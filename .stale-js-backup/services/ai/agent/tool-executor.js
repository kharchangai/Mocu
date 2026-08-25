"use strict";
// tool-executor.ts
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
exports.ToolExecutor = void 0;
var ToolExecutor = /** @class */ (function () {
    function ToolExecutor() {
        this.tools = new Map();
    }
    ToolExecutor.prototype.registerTool = function (tool) {
        if (!tool.name.trim()) {
            throw new Error("Tool name cannot be empty.");
        }
        if (typeof tool.execute !== "function") {
            throw new Error("Tool \"".concat(tool.name, "\" must have an execute function."));
        }
        if (this.tools.has(tool.name)) {
            console.warn("Tool \"".concat(tool.name, "\" is already registered and will be replaced."));
        }
        this.tools.set(tool.name, tool);
    };
    ToolExecutor.prototype.unregisterTool = function (toolName) {
        return this.tools.delete(toolName);
    };
    ToolExecutor.prototype.hasTool = function (toolName) {
        return this.tools.has(toolName);
    };
    ToolExecutor.prototype.getTool = function (toolName) {
        return this.tools.get(toolName);
    };
    ToolExecutor.prototype.getAvailableTools = function () {
        return Array.from(this.tools.values()).map(function (tool) { return ({
            name: tool.name,
            description: tool.description,
        }); });
    };
    ToolExecutor.prototype.execute = function (toolName_1) {
        return __awaiter(this, arguments, void 0, function (toolName, args) {
            var tool;
            if (args === void 0) { args = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        tool = this.tools.get(toolName);
                        if (!tool) {
                            throw new Error("Tool \"".concat(toolName, "\" was not found."));
                        }
                        return [4 /*yield*/, tool.execute(args)];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    ToolExecutor.prototype.executeCall = function (toolCall) {
        return __awaiter(this, void 0, void 0, function () {
            var result, error_1, errorMessage;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _b.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, this.execute(toolCall.name, (_a = toolCall.arguments) !== null && _a !== void 0 ? _a : {})];
                    case 1:
                        result = _b.sent();
                        return [2 /*return*/, {
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                success: true,
                                result: result,
                            }];
                    case 2:
                        error_1 = _b.sent();
                        errorMessage = error_1 instanceof Error
                            ? error_1.message
                            : String(error_1);
                        console.error("Failed to execute tool \"".concat(toolCall.name, "\":"), error_1);
                        return [2 /*return*/, {
                                toolCallId: toolCall.id,
                                toolName: toolCall.name,
                                success: false,
                                error: errorMessage,
                            }];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ToolExecutor.prototype.executeCalls = function (toolCalls) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, Promise.all(toolCalls.map(function (toolCall) {
                            return _this.executeCall(toolCall);
                        }))];
                    case 1: return [2 /*return*/, _a.sent()];
                }
            });
        });
    };
    return ToolExecutor;
}());
exports.ToolExecutor = ToolExecutor;
