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
exports.setExtensionMessageHandler = setExtensionMessageHandler;
exports.startExtension = startExtension;
exports.stopExtension = stopExtension;
exports.getExtensionStatus = getExtensionStatus;
exports.requestExtension = requestExtension;
exports.notifyExtension = notifyExtension;
exports.respondExtension = respondExtension;
var core_1 = require("@tauri-apps/api/core");
var event_1 = require("@tauri-apps/api/event");
/*
 * Host-initiated JSON-RPC requests are stored here until the extension
 * responds. The extension SDK writes responses to stdout, the Rust host
 * forwards them back as `extension://message` events, and we resolve the
 * matching pending promise by id.
 */
var pendingRequests = new Map();
var listenerPromise = null;
/*
 * Optional callback used by the app host layer to intercept requests or
 * notifications that extensions send toward Mocu (for example
 * `mocu.llm.generate` or `mocu.getSettings`).
 */
var hostMessageHandler = null;
function setExtensionMessageHandler(handler) {
    hostMessageHandler = handler;
}
function ensureExtensionListener() {
    var _this = this;
    if (listenerPromise) {
        return listenerPromise;
    }
    listenerPromise = (function () { return __awaiter(_this, void 0, void 0, function () {
        var unlisten;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, event_1.listen)("extension://message", function (event) {
                        handleIncoming(event.payload);
                    })];
                case 1:
                    unlisten = _a.sent();
                    // Keep a reference so future cleanup code can detach the listener.
                    void unlisten;
                    return [2 /*return*/];
            }
        });
    }); })();
    return listenerPromise;
}
function handleIncoming(payload) {
    var _a;
    var message = payload.message;
    if (!message || typeof message !== "object") {
        return;
    }
    var record = message;
    // A response to one of our pending requests.
    if ("id" in record &&
        ("result" in record || "error" in record)) {
        var requestId = String(record.id);
        if (pendingRequests.has(requestId)) {
            var pending = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);
            if ("error" in record) {
                var rawError = record.error;
                var errorMessage = rawError && typeof rawError === "object"
                    ? rawError.message
                    : null;
                pending.reject(new Error(typeof errorMessage === "string"
                    ? errorMessage
                    : "The extension returned an error."));
            }
            else {
                pending.resolve((_a = record.result) !== null && _a !== void 0 ? _a : null);
            }
        }
        return;
    }
    // A request or notification initiated by the extension.
    if ("method" in record) {
        hostMessageHandler === null || hostMessageHandler === void 0 ? void 0 : hostMessageHandler(payload.extensionId, message);
    }
}
/**
 * Start a Node.js or Python extension process through the Rust host.
 */
function startExtension(path, manifest) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureExtensionListener()];
                case 1:
                    _a.sent();
                    return [2 /*return*/, (0, core_1.invoke)("extension_start", {
                            input: {
                                extensionPath: path,
                                manifest: manifest,
                            },
                        })];
            }
        });
    });
}
/**
 * Stop a running extension process.
 */
function stopExtension(extensionId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            return [2 /*return*/, (0, core_1.invoke)("extension_stop", {
                    input: {
                        extensionId: extensionId,
                    },
                })];
        });
    });
}
/**
 * Ask an extension for its current running state.
 */
function getExtensionStatus(extensionId) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureExtensionListener()];
                case 1:
                    _a.sent();
                    return [2 /*return*/, (0, core_1.invoke)("extension_status", {
                            input: {
                                extensionId: extensionId,
                            },
                        })];
            }
        });
    });
}
/**
 * Send a JSON-RPC request to an extension and await its response.
 */
function requestExtension(extensionId_1, method_1, params_1) {
    return __awaiter(this, arguments, void 0, function (extensionId, method, params, timeoutMs) {
        var requestId, resultPromise;
        if (timeoutMs === void 0) { timeoutMs = 30000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureExtensionListener()];
                case 1:
                    _a.sent();
                    requestId = crypto.randomUUID();
                    resultPromise = new Promise(function (resolve, reject) {
                        var timer = setTimeout(function () {
                            if (pendingRequests.has(requestId)) {
                                pendingRequests.delete(requestId);
                                reject(new Error("Extension request \"".concat(method, "\" timed out after ").concat(timeoutMs, "ms.")));
                            }
                        }, timeoutMs);
                        pendingRequests.set(requestId, {
                            resolve: function (value) {
                                clearTimeout(timer);
                                resolve(value);
                            },
                            reject: function (error) {
                                clearTimeout(timer);
                                reject(error);
                            },
                        });
                    });
                    return [4 /*yield*/, (0, core_1.invoke)("extension_send_request", {
                            input: {
                                extensionId: extensionId,
                                requestId: requestId,
                                method: method,
                                params: params !== null && params !== void 0 ? params : null,
                            },
                        }).catch(function (error) {
                            pendingRequests.delete(requestId);
                            throw error;
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/, resultPromise];
            }
        });
    });
}
/**
 * Send a fire-and-forget JSON-RPC notification to an extension.
 */
function notifyExtension(extensionId, method, params) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureExtensionListener()];
                case 1:
                    _a.sent();
                    return [4 /*yield*/, (0, core_1.invoke)("extension_send_notification", {
                            input: {
                                extensionId: extensionId,
                                method: method,
                                params: params !== null && params !== void 0 ? params : null,
                            },
                        })];
                case 2:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
/**
 * Send a JSON-RPC response back to an extension-initiated request.
 *
 * This is how Rust stays the middleware: the extension calls a host
 * method, the frontend resolves it, then writes the result through Rust
 * into the extension's stdin.
 */
function respondExtension(extensionId, requestId, result, error) {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, (0, core_1.invoke)("extension_respond", {
                        input: {
                            extensionId: extensionId,
                            requestId: requestId,
                            result: result !== null && result !== void 0 ? result : null,
                            error: error !== null && error !== void 0 ? error : null,
                        },
                    })];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
