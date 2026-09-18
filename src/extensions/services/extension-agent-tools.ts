import { tool } from "@langchain/core/tools";

import type {
  StructuredToolInterface,
} from "@langchain/core/tools";

import { z } from "zod";

import type {
  InstalledExtension,
} from "../types/extension";

import {
  normalizeExtensionOutput,
} from "./extension-agent-loader";

import {
  scanInstalledExtensions,
} from "./extension-scanner";

import {
  executeExtensionCommand,
} from "./extension-service";

import {
  dispatchAgentToolActivity,
} from "../../chat/services/toolActivity";

import type {
  ToolExecutor,
} from "../../services/ai/agent/tool-executor";

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOLS_PER_AGENT = 24;

/**
 * One installed extension command exposed as an agent tool.
 */
export interface ExtensionToolEntry {
  /** Tool name as exposed to the model (e.g. extension_pi_node_ask). */
  name: string;

  /** Human-readable description injected into the system prompt. */
  description: string;
}

/**
 * Everything an agent needs to expose installed extensions as tools:
 * bindable LangChain tools, registration into a ToolExecutor, and a
 * system-prompt section describing them.
 */
export interface ExtensionAgentToolSet {
  /** LangChain tool instances for llm.bindTools(). */
  tools: StructuredToolInterface[];

  /** Tool metadata for prompt building and logging. */
  entries: ExtensionToolEntry[];

  /** Register matching executors into a ToolExecutor. */
  registerAll: (executor: ToolExecutor) => void;

  /** Ready-to-append system prompt section, or an empty string. */
  prompt: string;

  /**
   * Selected extension IDs that were not found among installed
   * extensions. Empty when no selection was made.
   */
  missingExtensions: string[];
}

const sanitizeToolNamePart = (
  value: string,
): string => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "ext"
  );
};

const buildExtensionToolName = (
  extensionId: string,
  commandId: string,
  usedNames: Set<string>,
): string => {
  const base = `extension_${sanitizeToolNamePart(
    extensionId,
  )}_${sanitizeToolNamePart(commandId)}`
    .slice(0, MAX_TOOL_NAME_LENGTH)
    .replace(/_+$/, "");

  let name = base;
  let suffix = 2;

  while (usedNames.has(name)) {
    const suffixText = `_${suffix}`;

    name = `${base.slice(
      0,
      MAX_TOOL_NAME_LENGTH - suffixText.length,
    )}${suffixText}`;

    suffix += 1;
  }

  usedNames.add(name);

  return name;
};

const buildExtensionToolDescription = (
  extension: InstalledExtension,
  commandId: string,
  title: string | undefined,
  description: string | undefined,
): string => {
  const detail =
    description ??
    title ??
    extension.manifest.description;

  if (detail) {
    return `${extension.manifest.name} extension, command "${commandId}". ${detail}`;
  }

  return `${extension.manifest.name} extension, command "${commandId}"`;
};

/**
 * Builds the extension tools prompt.
 */
const buildExtensionToolsPrompt = (
  entries: ExtensionToolEntry[],
): string => {
  if (entries.length === 0) {
    return "";
  }

  const toolLines = entries
    .map(
      (entry) =>
        `- ${entry.name}: ${entry.description}`,
    )
    .join("\n");

  return [
    "The user explicitly selected the following extensions for this request.",
    "Use these tools when the user's request matches them, and do what the user asked.",
    "",
    toolLines,
  ].join("\n");
};

/**
 * Loads extension commands as agent tools.
 *
 * Only extensions explicitly selected by the user are exposed as tools.
 * An empty selection returns an empty tool set. This is important because
 * exposing every installed extension on every request can make the model
 * invoke an extension unexpectedly (and starts its child process) even when
 * the user did not ask for one.
 *
 * Selected extensions are not executed here. They are only exposed to
 * the model as callable tools.
 *
 * Failures do not block the agent. An empty tool set is returned when
 * scanning the installed extensions fails.
 */
export const loadExtensionAgentTools =
  async (
    selectedExtensionIds: string[] = [],
  ): Promise<ExtensionAgentToolSet> => {
    let installed: InstalledExtension[] = [];

    try {
      installed = await scanInstalledExtensions();
    } catch (error) {
      console.error(
        "[Extension Tools] Failed to scan installed extensions:",
        error,
      );

      return {
        tools: [],
        entries: [],
        registerAll: () => undefined,
        prompt: "",
        missingExtensions: [],
      };
    }

    /*
     * Restrict the tool set to explicitly selected extensions and track
     * selected extension IDs that are not installed.
     */
    const requestedIds = selectedExtensionIds
      .map((id) => id.trim())
      .filter(Boolean);

    const missingExtensions: string[] = [];

    /*
     * Extensions are opt-in per request. The chat input exposes them through
     * /extension, so a normal message must not start or advertise installed
     * extension processes just because they happen to exist on disk.
     */
    if (requestedIds.length === 0) {
      return {
        tools: [],
        entries: [],
        registerAll: () => undefined,
        prompt: "",
        missingExtensions: [],
      };
    }

    const requestedIdSet = new Set(requestedIds);

    const installedIds = new Set(
      installed.map(
        (extension) => extension.manifest.id,
      ),
    );

    for (const id of requestedIds) {
      if (!installedIds.has(id)) {
        missingExtensions.push(id);
      }
    }

    installed = installed.filter((extension) =>
      requestedIdSet.has(extension.manifest.id),
    );

    const usedNames = new Set<string>();

    const tools: StructuredToolInterface[] = [];

    const entries: ExtensionToolEntry[] = [];

    const executors = new Map<
      string,
      (
        args: unknown,
        context?: Record<string, unknown>,
      ) => Promise<unknown>
    >();

    let toolLimitReached = false;

    for (const extension of installed) {
      if (toolLimitReached) {
        break;
      }

      for (
        const command of
        extension.manifest.commands ?? []
      ) {
        if (tools.length >= MAX_TOOLS_PER_AGENT) {
          console.warn(
            `[Extension Tools] Tool limit (${MAX_TOOLS_PER_AGENT}) reached; skipping remaining extension commands.`,
          );

          toolLimitReached = true;
          break;
        }

        const toolName = buildExtensionToolName(
          extension.manifest.id,
          command.id,
          usedNames,
        );

        const description =
          buildExtensionToolDescription(
            extension,
            command.id,
            command.title,
            command.description,
          );

        const runCommand = async (
          args: unknown,
          context?: Record<string, unknown>,
        ): Promise<unknown> => {
          const input =
            (
              args as Record<string, unknown> | null
            )?.input ?? null;

          /*
           * Commands with streaming enabled are marked as streaming before
           * the first progress notification arrives.
           */
          const toolCallId = context?.toolCallId;

          if (
            command.streaming &&
            typeof toolCallId === "string"
          ) {
            dispatchAgentToolActivity({
              id: toolCallId,

              tool:
                typeof context?.toolName === "string"
                  ? context.toolName
                  : `extension_${extension.manifest.id}`,

              status: "running",
              streaming: true,
            });
          }

          const result =
            await executeExtensionCommand<unknown>(
              extension,
              command.id,
              input,
              context,
            );

          return normalizeExtensionOutput(result);
        };

        executors.set(toolName, runCommand);

        tools.push(
          tool(
            async ({
              input,
            }: {
              input?: unknown;
            }) => {
              return await runCommand({ input });
            },
            {
              name: toolName,
              description,

              schema: z.object({
                input: z
                  .union([
                    z.record(
                      z.string(),
                      z.unknown(),
                    ),
                    z.string(),
                  ])
                  .optional()
                  .describe(
                    "Input expected by the extension command.",
                  ),
              }),
            },
          ),
        );

        entries.push({
          name: toolName,
          description,
        });
      }
    }

    return {
      tools,
      entries,

      registerAll: (executor: ToolExecutor) => {
        for (const [name, run] of executors) {
          executor.registerTool({
            name,

            description:
              entries.find(
                (entry) => entry.name === name,
              )?.description ??
              "Extension command tool.",

            execute: async (args, context) =>
              run(args, context),
          });
        }
      },

      prompt: buildExtensionToolsPrompt(entries),

      missingExtensions,
    };
  };