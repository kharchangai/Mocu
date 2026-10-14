import { createInterface } from "node:readline";
import { HOST_METHODS } from "@mocu/extension-contracts";
/*
 * Minimal stdin/stdout JSON-RPC client.
 *
 * Mocu writes `{ method, id, params }` to the extension's stdin; the SDK
 * dispatches to the matching handler and writes `{ id, result/error }` back
 * on stdout. In the reverse direction, `request()` lets the extension call
 * host methods (e.g. `mocu.llm.generate`) and await the answer.
 */
export class JsonRpcProtocolClient {
    nextRequestId = 1;
    requestHandlers = new Map();
    pendingRequests = new Map();
    started = false;
    registerRequestHandler(method, handler) {
        this.requestHandlers.set(method, handler);
    }
    start() {
        if (this.started) {
            return;
        }
        this.started = true;
        const reader = createInterface({
            input: process.stdin,
            crlfDelay: Infinity,
            terminal: false,
        });
        reader.on("line", (line) => {
            const normalizedLine = line.trim();
            if (!normalizedLine) {
                return;
            }
            void this.handleLine(normalizedLine);
        });
        reader.on("close", () => {
            this.rejectAllPendingRequests(new Error("Mocu extension host disconnected."));
        });
        process.stdin.resume();
    }
    /**
     * Send a request to the host and await its response.
     */
    async request(method, params, timeoutMs = 90_000, signal) {
        if (signal?.aborted) {
            throw new Error(`Request "${method}" was cancelled.`);
        }
        const id = this.nextRequestId++;
        const request = {
            jsonrpc: "2.0",
            id,
            method,
            ...(params === undefined ? {} : { params }),
        };
        const result = new Promise((resolve, reject) => {
            const pending = {
                resolve: (value) => resolve(value),
                reject,
                timeout: null,
                ...(signal ? { signal } : {}),
            };
            if (timeoutMs !== null) {
                pending.timeout = setTimeout(() => {
                    this.pendingRequests.delete(id);
                    this.clearPendingRequest(pending);
                    reject(new Error(`Request "${method}" timed out after ${timeoutMs}ms.`));
                }, timeoutMs);
            }
            if (signal) {
                pending.abortListener = () => {
                    if (!this.pendingRequests.has(id)) {
                        return;
                    }
                    this.pendingRequests.delete(id);
                    this.clearPendingRequest(pending);
                    if (method === HOST_METHODS.extensionInteract ||
                        method === HOST_METHODS.agentsRun) {
                        this.notify(HOST_METHODS.extensionInteractionCancel, {
                            requestId: id,
                        });
                    }
                    reject(new Error(`Request "${method}" was cancelled.`));
                };
            }
            this.pendingRequests.set(id, pending);
            if (signal && pending.abortListener) {
                signal.addEventListener("abort", pending.abortListener, { once: true });
                if (signal.aborted) {
                    pending.abortListener();
                }
            }
        });
        if (this.pendingRequests.has(id)) {
            this.writeMessage(request);
        }
        return result;
    }
    async handleLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch (error) {
            this.writeFailure(null, -32700, "Invalid JSON received.", error instanceof Error ? error.message : String(error));
            return;
        }
        // A request from the host (e.g. extension.execute).
        if ("method" in message && "id" in message) {
            await this.handleRequest(message);
            return;
        }
        // A response from the host to one of our requests.
        if ("result" in message) {
            this.handleSuccess(message);
            return;
        }
        if ("error" in message) {
            this.handleFailure(message);
        }
    }
    async handleRequest(request) {
        const handler = this.requestHandlers.get(request.method);
        if (!handler) {
            this.writeFailure(request.id, -32601, `Method not found: ${request.method}`);
            return;
        }
        try {
            const result = await handler(request.params);
            const response = {
                jsonrpc: "2.0",
                id: request.id,
                result: result ?? null,
            };
            this.writeMessage(response);
        }
        catch (error) {
            this.writeFailure(request.id, -32603, error instanceof Error ? error.message : String(error));
        }
    }
    notify(method, params) {
        this.writeMessage({
            jsonrpc: "2.0",
            method,
            ...(params === undefined ? {} : { params }),
        });
    }
    clearPendingRequest(pending) {
        if (pending.timeout) {
            clearTimeout(pending.timeout);
        }
        if (pending.signal && pending.abortListener) {
            pending.signal.removeEventListener("abort", pending.abortListener);
        }
    }
    handleSuccess(response) {
        const pending = this.pendingRequests.get(response.id);
        if (!pending) {
            return;
        }
        this.clearPendingRequest(pending);
        this.pendingRequests.delete(response.id);
        pending.resolve(response.result);
    }
    handleFailure(response) {
        if (response.id === null) {
            return;
        }
        const pending = this.pendingRequests.get(response.id);
        if (!pending) {
            return;
        }
        this.clearPendingRequest(pending);
        this.pendingRequests.delete(response.id);
        pending.reject(new Error(response.error.message));
    }
    writeFailure(id, code, message, data) {
        const failure = {
            jsonrpc: "2.0",
            id,
            error: {
                code,
                message,
                ...(data === undefined ? {} : { data }),
            },
        };
        this.writeMessage(failure);
    }
    writeMessage(message) {
        process.stdout.write(`${JSON.stringify(message)}\n`);
    }
    rejectAllPendingRequests(error) {
        for (const pending of this.pendingRequests.values()) {
            this.clearPendingRequest(pending);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
}
//# sourceMappingURL=protocol-client.js.map