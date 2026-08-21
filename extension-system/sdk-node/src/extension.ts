import type {
  ExtensionActivateParams,
  ExtensionDeactivateParams,
  ExtensionExecuteParams,
  ExtensionInitializeParams,
  MocuEmitEventParams,
  MocuLogParams,
  MocuShowMessageParams,
} from "@mocu/extension-contracts";

import {
  EXTENSION_METHODS,
  HOST_METHODS,
} from "@mocu/extension-contracts";

import {
  JsonRpcProtocolClient,
} from "./protocol-client.js";

import type {
  ExtensionCommandHandler,
  MocuExtensionDefinition,
} from "./types.js";

export class MocuExtension {
  private readonly protocol =
    new JsonRpcProtocolClient();

  private readonly commands =
    new Map<string, ExtensionCommandHandler>();

  private initialized = false;
  private activated = false;

  public constructor(
    private readonly definition: MocuExtensionDefinition = {},
  ) {
    for (
      const [command, handler]
      of Object.entries(definition.commands ?? {})
    ) {
      this.commands.set(command, handler);
    }

    this.registerProtocolHandlers();
  }

  public registerCommand(
    command: string,
    handler: ExtensionCommandHandler,
  ): void {
    const normalizedCommand = command.trim();

    if (!normalizedCommand) {
      throw new Error(
        "Command name cannot be empty.",
      );
    }

    if (this.commands.has(normalizedCommand)) {
      throw new Error(
        `Command is already registered: ${normalizedCommand}`,
      );
    }

    this.commands.set(normalizedCommand, handler);
  }

  public start(): void {
    this.protocol.start();
  }

  public log(
    message: string,
    data?: unknown,
  ): void {
    this.sendLog("info", message, data);
  }

  public debug(
    message: string,
    data?: unknown,
  ): void {
    this.sendLog("debug", message, data);
  }

  public warn(
    message: string,
    data?: unknown,
  ): void {
    this.sendLog("warn", message, data);
  }

  public error(
    message: string,
    data?: unknown,
  ): void {
    this.sendLog("error", message, data);
  }

  public showInformationMessage(
    message: string,
  ): void {
    const params: MocuShowMessageParams = {
      type: "info",
      message,
    };

    this.protocol.notify(
      HOST_METHODS.showMessage,
      params,
    );
  }

  public showWarningMessage(
    message: string,
  ): void {
    const params: MocuShowMessageParams = {
      type: "warning",
      message,
    };

    this.protocol.notify(
      HOST_METHODS.showMessage,
      params,
    );
  }

  public showErrorMessage(
    message: string,
  ): void {
    const params: MocuShowMessageParams = {
      type: "error",
      message,
    };

    this.protocol.notify(
      HOST_METHODS.showMessage,
      params,
    );
  }

  public emitEvent(
    event: string,
    payload?: unknown,
  ): void {
    const params: MocuEmitEventParams = {
      event,
      ...(payload === undefined ? {} : { payload }),
    };

    this.protocol.notify(
      HOST_METHODS.emitEvent,
      params,
    );
  }

  public getSettings<
    TSettings = Record<string, unknown>,
  >(): Promise<TSettings> {
    return this.protocol.request<TSettings>(
      HOST_METHODS.getSettings,
    );
  }

  public updateSettings(
    settings: Record<string, unknown>,
  ): Promise<void> {
    return this.protocol.request<void>(
      HOST_METHODS.updateSettings,
      {
        settings,
      },
    );
  }

  private registerProtocolHandlers(): void {
    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.initialize,
      async (params) => {
        const initializeParams =
          params as ExtensionInitializeParams;

        await this.definition.initialize?.(
          initializeParams,
        );

        this.initialized = true;

        return {
          initialized: true,
        };
      },
    );

    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.activate,
      async (params) => {
        if (!this.initialized) {
          throw new Error(
            "Extension must be initialized before activation.",
          );
        }

        const activateParams =
          params as ExtensionActivateParams;

        await this.definition.activate?.(
          activateParams,
        );

        this.activated = true;

        return {
          activated: true,
        };
      },
    );

    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.deactivate,
      async (params) => {
        const deactivateParams =
          params as ExtensionDeactivateParams;

        await this.definition.deactivate?.(
          deactivateParams,
        );

        this.activated = false;

        return {
          deactivated: true,
        };
      },
    );

    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.execute,
      async (params) => {
        if (!this.activated) {
          throw new Error(
            "Extension is not active.",
          );
        }

        return this.executeCommand(
          params as ExtensionExecuteParams,
        );
      },
    );

    this.protocol.registerRequestHandler(
      EXTENSION_METHODS.ping,
      async () => ({
        ready: true,
        initialized: this.initialized,
        activated: this.activated,
      }),
    );
  }

  private async executeCommand(
    params: ExtensionExecuteParams,
  ): Promise<{
    success: boolean;
    output?: unknown;
    error?: string;
  }> {
    try {
      if (this.definition.execute) {
        const output =
          await this.definition.execute(params);

        return {
          success: true,
          output,
        };
      }

      const handler =
        this.commands.get(params.command);

      if (!handler) {
        return {
          success: false,
          error: `Unknown command: ${params.command}`,
        };
      }

      const output = await handler(
        params.input,
        params.context ?? {},
      );

      return {
        success: true,
        output,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  private sendLog(
    level: MocuLogParams["level"],
    message: string,
    data?: unknown,
  ): void {
    const params: MocuLogParams = {
      level,
      message,
      ...(data === undefined ? {} : { data }),
    };

    this.protocol.notify(
      HOST_METHODS.log,
      params,
    );
  }
}

export const createExtension = (
  definition: MocuExtensionDefinition = {},
): MocuExtension => {
  return new MocuExtension(definition);
};