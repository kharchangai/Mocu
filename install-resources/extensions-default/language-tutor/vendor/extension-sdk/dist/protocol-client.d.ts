type RequestHandler = (params: unknown) => Promise<unknown>;
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