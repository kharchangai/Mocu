type RequestHandler = (params: unknown) => Promise<unknown>;
/**
 * Minimal stdin/stdout JSON-RPC client.
 *
 * Mocu writes `{ method, id, params }` to the extension's stdin; the SDK
 * dispatches to the matching handler and writes `{ id, result/error }` back
 * on stdout. In the reverse direction, `request()` lets the extension call
 * host methods (e.g. `mocu.llm.generate`) and await the answer.
 */
export declare class JsonRpcProtocolClient {
    private nextRequestId;
    private readonly requestHandlers;
    private readonly pendingRequests;
    private started;
    registerRequestHandler(method: string, handler: RequestHandler): void;
    start(): void;
    /**
     * Send a request to the host and await its response.
     */
    request<TResult = unknown>(method: string, params?: unknown, timeoutMs?: number | null, signal?: AbortSignal): Promise<TResult>;
    private handleLine;
    private handleRequest;
    notify(method: string, params?: unknown): void;
    private clearPendingRequest;
    private handleSuccess;
    private handleFailure;
    private writeFailure;
    private writeMessage;
    private rejectAllPendingRequests;
}
export {};
//# sourceMappingURL=protocol-client.d.ts.map