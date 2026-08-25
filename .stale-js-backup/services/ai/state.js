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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphState = void 0;
var langgraph_1 = require("@langchain/langgraph");
// We extend the default MessagesAnnotation to include our custom memory state
exports.GraphState = langgraph_1.Annotation.Root(__assign(__assign({}, langgraph_1.MessagesAnnotation.spec), { 
    // This holds the context retrieved or updated by the Memory Agent
    memoryContext: (0, langgraph_1.Annotation)({
        reducer: function (state, update) { return update; }, // Overwrite with the latest retrieved memory per turn
        default: function () { return ""; }, // Default is empty if no memory is found
    }) }));
