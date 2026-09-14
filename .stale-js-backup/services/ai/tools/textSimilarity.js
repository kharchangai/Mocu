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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.textSimilarity = exports.TextSimilarity = void 0;
var openai_1 = require("@langchain/openai");
var store_1 = require("../../../store");
function cosineSimilarity(vectorA, vectorB) {
    if (vectorA.length !== vectorB.length) {
        throw new Error("Embedding dimensions do not match: ".concat(vectorA.length, " and ").concat(vectorB.length, "."));
    }
    if (vectorA.length === 0) {
        return 0;
    }
    var dotProduct = 0;
    var magnitudeA = 0;
    var magnitudeB = 0;
    for (var index = 0; index < vectorA.length; index += 1) {
        var valueA = vectorA[index];
        var valueB = vectorB[index];
        dotProduct += valueA * valueB;
        magnitudeA += valueA * valueA;
        magnitudeB += valueB * valueB;
    }
    var denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    if (denominator === 0) {
        return 0;
    }
    return dotProduct / denominator;
}
function roundScore(score) {
    return Number(score.toFixed(6));
}
function assertValidEmbedding(embedding, label) {
    if (embedding.length === 0) {
        throw new Error("".concat(label, " cannot be empty."));
    }
    var hasInvalidValue = embedding.some(function (value) { return !Number.isFinite(value); });
    if (hasInvalidValue) {
        throw new Error("".concat(label, " contains an invalid numeric value."));
    }
}
/**
 * Converts all memory fields into one stable text representation.
 * This representation is sent to the embedding model.
 */
function createMemoryEmbeddingText(_a) {
    var content = _a.content, context = _a.context, key = _a.key, tags = _a.tags;
    return [
        "Content: ".concat(content),
        "Context: ".concat(context),
        "Key: ".concat(key.join(", ")),
        "Tags: ".concat(tags.join(", ")),
    ].join("\n");
}
var TextSimilarity = /** @class */ (function () {
    function TextSimilarity() {
        this.embeddings = null;
    }
    TextSimilarity.prototype.getEmbeddings = function () {
        return __awaiter(this, void 0, void 0, function () {
            var settings;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.embeddings) {
                            return [2 /*return*/, this.embeddings];
                        }
                        return [4 /*yield*/, (0, store_1.readSettings)()];
                    case 1:
                        settings = _a.sent();
                        if (!settings.embeddingModel) {
                            throw new Error("Embedding model is not configured. Please set an Embedding Model in Mocu Settings.");
                        }
                        if (!settings.embeddingBaseUrl) {
                            throw new Error("Embedding base URL is not configured. Please set an Embedding Base URL in Mocu Settings.");
                        }
                        this.embeddings = new openai_1.OpenAIEmbeddings({
                            model: settings.embeddingModel,
                            apiKey: settings.embeddingApiKey || "not-required",
                            configuration: {
                                baseURL: settings.embeddingBaseUrl,
                            },
                        });
                        return [2 /*return*/, this.embeddings];
                }
            });
        });
    };
    TextSimilarity.prototype.embedTexts = function (texts) {
        return __awaiter(this, void 0, void 0, function () {
            var embeddings, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (texts.length === 0) {
                            return [2 /*return*/, []];
                        }
                        return [4 /*yield*/, this.getEmbeddings()];
                    case 1:
                        embeddings = _a.sent();
                        return [4 /*yield*/, embeddings.embedDocuments(texts)];
                    case 2:
                        result = _a.sent();
                        if (result.length !== texts.length) {
                            throw new Error("Embedding provider returned ".concat(result.length, " vectors for ").concat(texts.length, " texts."));
                        }
                        return [2 /*return*/, result];
                }
            });
        });
    };
    /**
     * Creates an embedding vector for one text.
     */
    TextSimilarity.prototype.embedText = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            var embedding;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.embedTexts([text])];
                    case 1:
                        embedding = (_a.sent())[0];
                        if (!embedding) {
                            throw new Error("Embedding provider did not return an embedding vector.");
                        }
                        assertValidEmbedding(embedding, "Generated embedding");
                        return [2 /*return*/, embedding];
                }
            });
        });
    };
    /**
     * Combines memory content, context, keys, and tags into one text,
     * then creates one final embedding vector for the memory node.
     */
    TextSimilarity.prototype.embedMemory = function (memory) {
        return __awaiter(this, void 0, void 0, function () {
            var embeddingText;
            return __generator(this, function (_a) {
                embeddingText = createMemoryEmbeddingText(memory);
                return [2 /*return*/, this.embedText(embeddingText)];
            });
        });
    };
    /**
     * Compares one existing embedding against another existing embedding.
     * No embedding API request is made by this method.
     */
    TextSimilarity.prototype.compareEmbeddingToEmbedding = function (embedding1, embedding2) {
        assertValidEmbedding(embedding1, "First embedding");
        assertValidEmbedding(embedding2, "Second embedding");
        return roundScore(cosineSimilarity(embedding1, embedding2));
    };
    /**
     * Compares one existing embedding against a list of existing embeddings.
     * No embedding API request is made by this method.
     * Results are sorted from highest similarity to lowest similarity.
     */
    TextSimilarity.prototype.compareEmbeddingToList = function (sourceEmbedding, targetEmbeddings) {
        var _this = this;
        var _a;
        assertValidEmbedding(sourceEmbedding, "Source embedding");
        if (targetEmbeddings.length === 0) {
            return {
                matches: [],
                bestMatch: null,
            };
        }
        var matches = targetEmbeddings
            .map(function (target, index) {
            if (!target.id) {
                throw new Error("Target embedding at index ".concat(index, " does not have a valid ID."));
            }
            assertValidEmbedding(target.embedding, "Target embedding at index ".concat(index));
            return {
                id: target.id,
                score: _this.compareEmbeddingToEmbedding(sourceEmbedding, target.embedding),
            };
        })
            .sort(function (first, second) { return second.score - first.score; });
        return {
            matches: matches,
            bestMatch: (_a = matches[0]) !== null && _a !== void 0 ? _a : null,
        };
    };
    /**
     * Compares every embedding in the source list against every embedding
     * in the target list. No embedding API request is made by this method.
     */
    TextSimilarity.prototype.compareEmbeddingListToList = function (sourceEmbeddings, targetEmbeddings) {
        var _this = this;
        if (sourceEmbeddings.length === 0) {
            return {
                results: [],
            };
        }
        var results = sourceEmbeddings.map(function (source, sourceIndex) {
            if (!source.id) {
                throw new Error("Source embedding at index ".concat(sourceIndex, " does not have a valid ID."));
            }
            var comparison = _this.compareEmbeddingToList(source.embedding, targetEmbeddings);
            return {
                sourceId: source.id,
                matches: comparison.matches,
                bestMatch: comparison.bestMatch,
            };
        });
        return {
            results: results,
        };
    };
    /**
     * Compares one text with another text using semantic embeddings.
     */
    TextSimilarity.prototype.compareTextToText = function (text1, text2) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, embedding1, embedding2;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0: return [4 /*yield*/, this.embedTexts([text1, text2])];
                    case 1:
                        _a = _b.sent(), embedding1 = _a[0], embedding2 = _a[1];
                        if (!embedding1 || !embedding2) {
                            throw new Error("Embedding provider did not return vectors for both input texts.");
                        }
                        return [2 /*return*/, {
                                text1: text1,
                                text2: text2,
                                score: this.compareEmbeddingToEmbedding(embedding1, embedding2),
                            }];
                }
            });
        });
    };
    /**
     * Compares one text against every item in a list.
     * Results are sorted from highest similarity to lowest similarity.
     */
    TextSimilarity.prototype.compareTextToList = function (sourceText, textList) {
        return __awaiter(this, void 0, void 0, function () {
            var allTexts, allEmbeddings, sourceEmbedding, listEmbeddings, matches;
            var _this = this;
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (textList.length === 0) {
                            return [2 /*return*/, {
                                    sourceText: sourceText,
                                    matches: [],
                                    bestMatch: null,
                                }];
                        }
                        allTexts = __spreadArray([sourceText], textList, true);
                        return [4 /*yield*/, this.embedTexts(allTexts)];
                    case 1:
                        allEmbeddings = _b.sent();
                        sourceEmbedding = allEmbeddings[0];
                        listEmbeddings = allEmbeddings.slice(1);
                        if (!sourceEmbedding || listEmbeddings.length !== textList.length) {
                            throw new Error("Embedding provider returned an unexpected number of embedding vectors.");
                        }
                        matches = textList
                            .map(function (text, index) {
                            var targetEmbedding = listEmbeddings[index];
                            if (!targetEmbedding) {
                                throw new Error("Embedding provider did not return a vector for list item at index ".concat(index, "."));
                            }
                            return {
                                text: text,
                                score: _this.compareEmbeddingToEmbedding(sourceEmbedding, targetEmbedding),
                            };
                        })
                            .sort(function (first, second) { return second.score - first.score; });
                        return [2 /*return*/, {
                                sourceText: sourceText,
                                matches: matches,
                                bestMatch: (_a = matches[0]) !== null && _a !== void 0 ? _a : null,
                            }];
                }
            });
        });
    };
    /**
     * Compares every text in the source list against every text in the target list.
     *
     * For each source text, it returns:
     * - all target matches in descending similarity order
     * - the best matching target text
     */
    TextSimilarity.prototype.compareListToList = function (sourceList, targetList) {
        return __awaiter(this, void 0, void 0, function () {
            var allTexts, allEmbeddings, sourceEmbeddings, targetEmbeddings, results;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (sourceList.length === 0) {
                            return [2 /*return*/, {
                                    results: [],
                                }];
                        }
                        if (targetList.length === 0) {
                            return [2 /*return*/, {
                                    results: sourceList.map(function (sourceText) { return ({
                                        sourceText: sourceText,
                                        matches: [],
                                        bestMatch: null,
                                    }); }),
                                }];
                        }
                        allTexts = __spreadArray(__spreadArray([], sourceList, true), targetList, true);
                        return [4 /*yield*/, this.embedTexts(allTexts)];
                    case 1:
                        allEmbeddings = _a.sent();
                        if (allEmbeddings.length !== allTexts.length) {
                            throw new Error("Embedding provider returned an unexpected number of embedding vectors.");
                        }
                        sourceEmbeddings = allEmbeddings.slice(0, sourceList.length);
                        targetEmbeddings = allEmbeddings.slice(sourceList.length);
                        results = sourceList.map(function (sourceText, sourceIndex) {
                            var _a;
                            var sourceEmbedding = sourceEmbeddings[sourceIndex];
                            if (!sourceEmbedding) {
                                throw new Error("Embedding provider did not return a vector for source item at index ".concat(sourceIndex, "."));
                            }
                            var matches = targetList
                                .map(function (targetText, targetIndex) {
                                var targetEmbedding = targetEmbeddings[targetIndex];
                                if (!targetEmbedding) {
                                    throw new Error("Embedding provider did not return a vector for target item at index ".concat(targetIndex, "."));
                                }
                                return {
                                    text: targetText,
                                    score: _this.compareEmbeddingToEmbedding(sourceEmbedding, targetEmbedding),
                                };
                            })
                                .sort(function (first, second) { return second.score - first.score; });
                            return {
                                sourceText: sourceText,
                                matches: matches,
                                bestMatch: (_a = matches[0]) !== null && _a !== void 0 ? _a : null,
                            };
                        });
                        return [2 /*return*/, {
                                results: results,
                            }];
                }
            });
        });
    };
    return TextSimilarity;
}());
exports.TextSimilarity = TextSimilarity;
exports.textSimilarity = new TextSimilarity();
