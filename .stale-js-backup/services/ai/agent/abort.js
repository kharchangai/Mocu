"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAbortError = exports.throwIfAborted = exports.createAbortError = void 0;
var createAbortError = function () {
    return new DOMException("The operation was cancelled.", "AbortError");
};
exports.createAbortError = createAbortError;
var throwIfAborted = function (signal) {
    if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
        throw (0, exports.createAbortError)();
    }
};
exports.throwIfAborted = throwIfAborted;
var isAbortError = function (error) {
    return (error instanceof DOMException &&
        error.name === "AbortError") || (error instanceof Error &&
        error.name === "AbortError");
};
exports.isAbortError = isAbortError;
