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
exports.registerExtensionHost = registerExtensionHost;
var plugin_dialog_1 = require("@tauri-apps/plugin-dialog");
var store_1 = require("../../store");
var ai_1 = require("../../services/ai");
var extension_client_1 = require("./extension-client");
/**
 * Routes host-bound JSON-RPC messages that extensions send toward
 * Mocu. Rust forwards them as events; the frontend owns the actual
 * Mocu capabilities (LLM, settings, dialogs, events), so it resolves
 * the request and replies through the `extension_respond` Rust command.
 */
function handleHostMessage(extensionId, message) {
    var record = message;
    if (typeof record.method !== "string") {
        return;
    }
    var method = record.method;
    var params = record.params && typeof record.params === "object"
        ? record.params
        : {};
    var hasId = "id" in record;
    var requestId = hasId
        ? String(record.id)
        : null;
    void dispatchHostMethod(method, params)
        .then(function (result) {
        if (requestId) {
            void (0, extension_client_1.respondExtension)(extensionId, requestId, result, null);
        }
    })
        .catch(function (error) {
        var errorMessage = error instanceof Error
            ? error.message
            : String(error);
        if (requestId) {
            void (0, extension_client_1.respondExtension)(extensionId, requestId, null, {
                code: -32603,
                message: errorMessage,
                data: null,
            });
        }
        else {
            console.error("[Mocu Extension] ".concat(method, " failed:"), error);
        }
    });
}
function dispatchHostMethod(method, params) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, level, logMessage, messageText, type, kind, event_1, current, incoming, prompt_1;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = method;
                    switch (_a) {
                        case "mocu.log": return [3 /*break*/, 1];
                        case "mocu.showMessage": return [3 /*break*/, 2];
                        case "mocu.emitEvent": return [3 /*break*/, 4];
                        case "mocu.getSettings": return [3 /*break*/, 5];
                        case "mocu.updateSettings": return [3 /*break*/, 7];
                        case "mocu.llm.generate": return [3 /*break*/, 10];
                    }
                    return [3 /*break*/, 12];
                case 1:
                    {
                        level = typeof params.level === "string"
                            ? params.level
                            : "info";
                        logMessage = typeof params.message === "string"
                            ? params.message
                            : "";
                        if (level === "error") {
                            console.error("[Mocu Extension] ".concat(logMessage));
                        }
                        else if (level === "warn") {
                            console.warn("[Mocu Extension] ".concat(logMessage));
                        }
                        else {
                            console.log("[Mocu Extension] ".concat(logMessage));
                        }
                        return [2 /*return*/, null];
                    }
                    _b.label = 2;
                case 2:
                    messageText = typeof params.message === "string"
                        ? params.message
                        : "Extension message";
                    type = typeof params.type === "string"
                        ? params.type
                        : "info";
                    kind = type === "warning"
                        ? "warning"
                        : type === "error"
                            ? "error"
                            : "info";
                    return [4 /*yield*/, (0, plugin_dialog_1.message)(messageText, {
                            kind: kind,
                        })];
                case 3:
                    _b.sent();
                    return [2 /*return*/, null];
                case 4:
                    {
                        event_1 = typeof params.event === "string"
                            ? params.event
                            : "";
                        if (event_1) {
                            window.dispatchEvent(new CustomEvent(event_1, {
                                detail: params.payload,
                            }));
                        }
                        return [2 /*return*/, null];
                    }
                    _b.label = 5;
                case 5: return [4 /*yield*/, (0, store_1.readSettings)()];
                case 6: return [2 /*return*/, _b.sent()];
                case 7: return [4 /*yield*/, (0, store_1.readSettings)()];
                case 8:
                    current = _b.sent();
                    incoming = params.settings &&
                        typeof params.settings === "object"
                        ? params.settings
                        : {};
                    return [4 /*yield*/, (0, store_1.saveSettings)(__assign(__assign({}, current), incoming))];
                case 9:
                    _b.sent();
                    return [2 /*return*/, null];
                case 10:
                    prompt_1 = typeof params.prompt === "string"
                        ? params.prompt.trim()
                        : "";
                    if (!prompt_1) {
                        throw new Error("mocu.llm.generate requires a 'prompt' parameter.");
                    }
                    return [4 /*yield*/, (0, ai_1.generateSimpleAnswer)(prompt_1)];
                case 11: return [2 /*return*/, _b.sent()];
                case 12: throw new Error("Unknown Mocu host method: ".concat(method));
            }
        });
    });
}
/**
 * Register the app-side host handler so extension-initiated requests
 * (like using the LLM model) are handled and answered.
 */
function registerExtensionHost() {
    (0, extension_client_1.setExtensionMessageHandler)(handleHostMessage);
}
