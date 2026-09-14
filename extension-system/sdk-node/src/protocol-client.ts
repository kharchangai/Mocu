import { createInterface } from "node:readline";

import type {
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRequest,
  JsonRpcSuccess,
} from "@mocu/extension-contracts";

import type { PendingRequest } from "./types.js";

type RequestHandler = (params: unknown) => Promise<unknown>;

/**
 * Minimal stdin/stdout JSON-RPC client.
 *
 * Mocu writes `{ method, id, params }` to the extension's stdin; the SDK
 * dispatches to the matching handler and writes `{ id, result/error }` back
 * on stdout. In the reverse direction, `request()` lets the extension call
 * host methods (e.g. `mocu.llm.generate`) and await the answer.
 */
export class JsonRpcProtocolClient {
  private nextRequestId = 1;

  private readonly requestHandlers =
    new Map<string, RequestHandler>();

  private readonly pendingRequests =
    new Map<JsonRpcId, PendingRequest>();

  private started = false;

  public registerRequestHandler(
    method: string,
    handler: RequestHandler,
  ): void {
    this.requestHandlers.set(method, handler);
  }

  public start(): void {
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
      this.rejectAllPendingRequests(
        new Error("Mocu extension host disconnected."),
      );
    });

    process.stdin.resume();
  }

  /**
   * Send a request to the host and await its response.
   */
  public async request<TResult = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 90_000,
  ): Promise<TResult> {
    const id = this.nextRequestId++;

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    const result = new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);

        reject(
          new Error(
            `Request "${method}" timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeout,
      });
    });

    this.writeMessage(request);

    return result;
  }

  private async handleLine(line: string): Promise<void> {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch (error) {
      this.writeFailure(
        null,
        -32700,
        "Invalid JSON received.",
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    // A request from the host (e.g. extension.execute).
    if ("method" in message && "id" in message) {
      await this.handleRequest(message as JsonRpcRequest);
      return;
    }

    // A response from the host to one of our requests.
    if ("result" in message) {
      this.handleSuccess(message as JsonRpcSuccess);
      return;
    }

    if ("error" in message) {
      this.handleFailure(message as JsonRpcFailure);
    }
  }

  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    const handler = this.requestHandlers.get(request.method);

    if (!handler) {
      this.writeFailure(
        request.id,
        -32601,
        `Method not found: ${request.method}`,
      );
      return;
    }

    try {
      const result = await handler(request.params);

      const response: JsonRpcSuccess = {
        jsonrpc: "2.0",
        id: request.id,
        result: result ?? null,
      };

      this.writeMessage(response);
    } catch (error) {
      this.writeFailure(
        request.id,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private handleSuccess(response: JsonRpcSuccess): void {
    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    pending.resolve(response.result);
  }

  private handleFailure(response: JsonRpcFailure): void {
    if (response.id === null) {
      return;
    }

    const pending = this.pendingRequests.get(response.id);

    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    pending.reject(
      new Error(response.error.message),
    );
  }

  private writeFailure(
    id: JsonRpcId | null,
    code: number,
    message: string,
    data?: unknown,
  ): void {
    const failure: JsonRpcFailure = {
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

  private writeMessage(message: unknown): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }
}