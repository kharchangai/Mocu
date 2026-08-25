"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchAgentActivity = exports.stripMarkdown = exports.getToolResultText = exports.getTextContent = exports.isRecord = void 0;
var isRecord = function (value) {
    return (typeof value === "object" &&
        value !== null &&
        !Array.isArray(value));
};
exports.isRecord = isRecord;
var getTextContent = function (content) {
    if (typeof content === "string") {
        return content;
    }
    if ((0, exports.isRecord)(content)) {
        if (typeof content.text === "string") {
            return content.text;
        }
        return "";
    }
    if (!Array.isArray(content)) {
        return "";
    }
    var textParts = [];
    for (var _i = 0, content_1 = content; _i < content_1.length; _i++) {
        var item = content_1[_i];
        var text = (0, exports.getTextContent)(item).trim();
        if (text) {
            textParts.push(text);
        }
    }
    return textParts.join(" ");
};
exports.getTextContent = getTextContent;
var getToolResultText = function (result) {
    if (typeof result === "string") {
        return result;
    }
    if (result === null || result === undefined) {
        return "";
    }
    try {
        return JSON.stringify(result);
    }
    catch (_a) {
        return String(result);
    }
};
exports.getToolResultText = getToolResultText;
var stripMarkdown = function (text) {
    if (!text) {
        return "";
    }
    return text
        .replace(/!\[([^\]]*)\]\((?:[^)]+)\)/g, "$1")
        .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
        .replace(/https?:\/\/[^\s]+/g, "")
        .replace(/[*_#`~>|]/g, "")
        .replace(/^\s*[-•]\s*/gm, "")
        .replace(/^\s*\d+[.)]\s*/gm, "")
        .replace(/\r?\n+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
};
exports.stripMarkdown = stripMarkdown;
var dispatchAgentActivity = function (activity) {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(new CustomEvent("mocu_activity", {
        detail: activity,
    }));
};
exports.dispatchAgentActivity = dispatchAgentActivity;
