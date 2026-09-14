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
exports.getSettingsStore = getSettingsStore;
exports.readSettings = readSettings;
exports.saveSettings = saveSettings;
var plugin_store_1 = require("@tauri-apps/plugin-store");
var settingsStore = null;
function getSettingsStore() {
    return __awaiter(this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!!settingsStore) return [3 /*break*/, 2];
                    return [4 /*yield*/, (0, plugin_store_1.load)("settings.json", {
                            autoSave: false,
                        })];
                case 1:
                    settingsStore = _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/, settingsStore];
            }
        });
    });
}
function reloadStore(store) {
    return __awaiter(this, void 0, void 0, function () {
        var maybeReload;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    maybeReload = store;
                    if (!(typeof maybeReload.reload === "function")) return [3 /*break*/, 2];
                    return [4 /*yield*/, maybeReload.reload()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
                case 2:
                    if (!(typeof maybeReload.load === "function")) return [3 /*break*/, 4];
                    return [4 /*yield*/, maybeReload.load()];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4: return [2 /*return*/];
            }
        });
    });
}
function getValidSearchDepth(value) {
    if (!Number.isFinite(value)) {
        return 3;
    }
    var depth = Math.floor(value);
    if (depth < 1) {
        return 1;
    }
    if (depth > 10) {
        return 10;
    }
    return depth;
}
function readSettings() {
    return __awaiter(this, void 0, void 0, function () {
        var store, rawDepth, legacyBaseUrl, legacyLlmModel, expensiveBaseUrl, expensiveModel;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, getSettingsStore()];
                case 1:
                    store = _b.sent();
                    return [4 /*yield*/, reloadStore(store)];
                case 2:
                    _b.sent();
                    return [4 /*yield*/, store.get("MOCU_SEARCH_DEPTH")];
                case 3:
                    rawDepth = _b.sent();
                    return [4 /*yield*/, store.get("MOCU_BASE_URL")];
                case 4:
                    legacyBaseUrl = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_LLM_MODEL")];
                case 5:
                    legacyLlmModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_EXPENSIVE_BASE_URL")];
                case 6:
                    expensiveBaseUrl = ((_b.sent()) || legacyBaseUrl).trim();
                    return [4 /*yield*/, store.get("MOCU_EXPENSIVE_MODEL")];
                case 7:
                    expensiveModel = ((_b.sent()) || legacyLlmModel).trim();
                    _a = {};
                    return [4 /*yield*/, store.get("MOCU_API_KEY")];
                case 8:
                    // LLM settings
                    _a.apiKey = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_CHEAP_BASE_URL")];
                case 9:
                    _a.cheapBaseUrl = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_CHEAP_MODEL")];
                case 10:
                    _a.cheapModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_MEDIUM_BASE_URL")];
                case 11:
                    _a.mediumBaseUrl = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_MEDIUM_MODEL")];
                case 12:
                    _a.mediumModel = ((_b.sent()) || "").trim(),
                        // Falls back to old settings for migration compatibility.
                        _a.expensiveBaseUrl = expensiveBaseUrl,
                        _a.expensiveModel = expensiveModel;
                    return [4 /*yield*/, store.get("MOCU_STT_MODEL")];
                case 13:
                    // Speech settings
                    _a.sttModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_TTS_MODEL")];
                case 14:
                    _a.ttsModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_TTS_VOICE")];
                case 15:
                    _a.ttsVoice = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_EMBEDDING_API_KEY")];
                case 16:
                    // Embedding settings
                    _a.embeddingApiKey = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_EMBEDDING_BASE_URL")];
                case 17:
                    _a.embeddingBaseUrl = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_EMBEDDING_MODEL")];
                case 18:
                    _a.embeddingModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_VISION_API_KEY")];
                case 19:
                    // Vision settings
                    _a.visionApiKey = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_VISION_BASE_URL")];
                case 20:
                    _a.visionBaseUrl = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_VISION_MODEL")];
                case 21:
                    _a.visionModel = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_PERPLEXITY_API_KEY")];
                case 22:
                    // Perplexity settings
                    _a.perplexityApiKey = ((_b.sent()) || "").trim();
                    return [4 /*yield*/, store.get("MOCU_PERPLEXITY_BASE_URL")];
                case 23:
                    _a.perplexityBaseUrl = ((_b.sent()) ||
                        "https://api.perplexity.ai").trim();
                    return [4 /*yield*/, store.get("MOCU_PERPLEXITY_MODEL")];
                case 24: return [2 /*return*/, (_a.perplexityModel = ((_b.sent()) || "sonar").trim(),
                        _a.searchDepth = getValidSearchDepth(rawDepth),
                        _a)];
            }
        });
    });
}
function saveSettings(settings) {
    return __awaiter(this, void 0, void 0, function () {
        var store;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, getSettingsStore()];
                case 1:
                    store = _a.sent();
                    // LLM settings
                    return [4 /*yield*/, store.set("MOCU_API_KEY", (settings.apiKey || "").trim())];
                case 2:
                    // LLM settings
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_CHEAP_BASE_URL", (settings.cheapBaseUrl || "").trim())];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_CHEAP_MODEL", (settings.cheapModel || "").trim())];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_MEDIUM_BASE_URL", (settings.mediumBaseUrl || "").trim())];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_MEDIUM_MODEL", (settings.mediumModel || "").trim())];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_EXPENSIVE_BASE_URL", (settings.expensiveBaseUrl || "").trim())];
                case 7:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_EXPENSIVE_MODEL", (settings.expensiveModel || "").trim())];
                case 8:
                    _a.sent();
                    // Speech settings
                    return [4 /*yield*/, store.set("MOCU_STT_MODEL", (settings.sttModel || "").trim())];
                case 9:
                    // Speech settings
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_TTS_MODEL", (settings.ttsModel || "").trim())];
                case 10:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_TTS_VOICE", (settings.ttsVoice || "").trim())];
                case 11:
                    _a.sent();
                    // Embedding settings
                    return [4 /*yield*/, store.set("MOCU_EMBEDDING_API_KEY", (settings.embeddingApiKey || "").trim())];
                case 12:
                    // Embedding settings
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_EMBEDDING_BASE_URL", (settings.embeddingBaseUrl || "").trim())];
                case 13:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_EMBEDDING_MODEL", (settings.embeddingModel || "").trim())];
                case 14:
                    _a.sent();
                    // Vision settings
                    return [4 /*yield*/, store.set("MOCU_VISION_API_KEY", (settings.visionApiKey || "").trim())];
                case 15:
                    // Vision settings
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_VISION_BASE_URL", (settings.visionBaseUrl || "").trim())];
                case 16:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_VISION_MODEL", (settings.visionModel || "").trim())];
                case 17:
                    _a.sent();
                    // Perplexity settings
                    return [4 /*yield*/, store.set("MOCU_PERPLEXITY_API_KEY", (settings.perplexityApiKey || "").trim())];
                case 18:
                    // Perplexity settings
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_PERPLEXITY_BASE_URL", (settings.perplexityBaseUrl || "https://api.perplexity.ai").trim())];
                case 19:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_PERPLEXITY_MODEL", (settings.perplexityModel || "sonar").trim())];
                case 20:
                    _a.sent();
                    return [4 /*yield*/, store.set("MOCU_SEARCH_DEPTH", getValidSearchDepth(settings.searchDepth))];
                case 21:
                    _a.sent();
                    return [4 /*yield*/, store.save()];
                case 22:
                    _a.sent();
                    return [4 /*yield*/, reloadStore(store)];
                case 23:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
