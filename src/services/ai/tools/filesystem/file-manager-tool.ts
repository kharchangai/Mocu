import {
  tool,
  type StructuredToolInterface,
} from "@langchain/core/tools";

import type {
  RunnableConfig,
} from "@langchain/core/runnables";

import {
  createAgent,
} from "langchain";

import {
  z,
} from "zod";

import {
  getAsyncLLM,
} from "../../llm";

import {
  folderOperationsTool,
} from "./folder-operations-tool";

import {
  FILE_AGENT_SYSTEM_PROMPT,
} from "./prompt";

/**
 * Options used when creating a custom file-manager tool.
 */
export interface CreateFileManagerToolOptions {
  /**
   * Additional low-level tools available only to the internal file agent.
   *
   * folderOperationsTool is always included automatically.
   *
   * Examples:
   * - writeFileTool
   * - editFileTool
   * - moveItemTool
   * - copyItemTool
   */
  internalTools?: StructuredToolInterface[];

  /**
   * Name exposed to the main agent.
   *
   * Default: file_manager
   */
  name?: string;

  /**
   * Description exposed to the main agent.
   */
  description?: string;
}

/**
 * Input accepted by the high-level file_manager tool.
 *
 * The main agent only needs to provide:
 * - location
 * - task
 */
export const fileManagerInputSchema = z.object({
  location: z
    .string()
    .trim()
    .min(
      1,
      "A root location is required.",
    )
    .describe(
      "The absolute path of the root directory where the requested file operation must be performed.",
    ),

  task: z
    .string()
    .trim()
    .min(
      1,
      "A file-management task is required.",
    )
    .describe(
      "A clear and complete description of the requested file or directory operation.",
    ),
});

export type FileManagerInput = z.infer<
  typeof fileManagerInputSchema
>;

type MessageLike = {
  content?: unknown;
  role?: string;
  type?: string;
  _getType?: () => string;
};

type AgentResultLike = {
  messages?: unknown;
};

/**
 * Converts LangChain message content to plain text.
 */
function messageContentToText(
  content: unknown,
): string {
  if (
    typeof content === "string"
  ) {
    return content;
  }

  if (
    content === null ||
    content === undefined
  ) {
    return "";
  }

  if (
    !Array.isArray(
      content,
    )
  ) {
    try {
      const serialized =
        JSON.stringify(
          content,
        );

      return (
        serialized ??
        String(
          content,
        )
      );
    } catch {
      return String(
        content,
      );
    }
  }

  return content
    .map(
      (
        part,
      ): string => {
        if (
          typeof part ===
          "string"
        ) {
          return part;
        }

        if (
          !part ||
          typeof part !==
            "object"
        ) {
          return "";
        }

        if (
          "text" in part &&
          typeof (
            part as {
              text?: unknown;
            }
          ).text ===
            "string"
        ) {
          return (
            part as {
              text: string;
            }
          ).text;
        }

        if (
          "content" in
            part &&
          typeof (
            part as {
              content?: unknown;
            }
          ).content ===
            "string"
        ) {
          return (
            part as {
              content: string;
            }
          ).content;
        }

        try {
          const serialized =
            JSON.stringify(
              part,
            );

          return (
            serialized ??
            ""
          );
        } catch {
          return "";
        }
      },
    )
    .filter(
      (
        part,
      ) =>
        part.trim().length >
        0,
    )
    .join(
      "\n",
    );
}

/**
 * Checks whether a message is an AI/assistant message.
 */
function isAIMessage(
  message: MessageLike,
): boolean {
  if (
    typeof message._getType ===
    "function"
  ) {
    return (
      message._getType() ===
      "ai"
    );
  }

  if (
    typeof message.type ===
    "string"
  ) {
    return (
      message.type ===
      "ai"
    );
  }

  if (
    typeof message.role ===
    "string"
  ) {
    return (
      message.role ===
        "assistant" ||
      message.role ===
        "ai"
    );
  }

  /*
   * Some LangChain message implementations do not expose role or type
   * as enumerable properties.
   */
  return true;
}

/**
 * Extracts the final assistant response from the internal agent state.
 */
function getFinalResponse(
  messages: unknown,
): string {
  if (
    !Array.isArray(
      messages,
    )
  ) {
    return "The file agent finished without returning any messages.";
  }

  for (
    let index =
      messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      messages[index];

    if (
      !message ||
      typeof message !==
        "object"
    ) {
      continue;
    }

    const candidate =
      message as MessageLike;

    if (
      !isAIMessage(
        candidate,
      )
    ) {
      continue;
    }

    const text =
      messageContentToText(
        candidate.content,
      ).trim();

    if (
      text.length > 0
    ) {
      return text;
    }
  }

  return "The file agent finished without returning a final response.";
}

/**
 * Creates the user request sent to the internal file-management agent.
 */
function createFileAgentRequest({
  location,
  task,
}: FileManagerInput): string {
  return `
Complete the following file-management task.

ROOT LOCATION:
${location}

TASK:
${task}

TOOL ARGUMENT MAPPING:
- Pass ROOT LOCATION as rootLocation to folder_operations.
- Pass only a relative path inside ROOT LOCATION as path.
- Use "." as path when the operation targets ROOT LOCATION itself.

SECURITY REQUIREMENTS:
- ROOT LOCATION is the only permitted filesystem root.
- Never access any path outside ROOT LOCATION.
- Never pass an absolute path as the path argument.
- Never use ".." in a relative path.
- Never delete ROOT LOCATION itself.
- Reject any operation that attempts to escape ROOT LOCATION.

OPERATION REQUIREMENTS:
- Use folder_operations for supported folder and file operations.
- Inspect existing files and directories when necessary.
- Preserve unrelated files and content.
- Use the safest available operation.
- Do not report success until all required tool calls succeed.
- If a required capability is unavailable, clearly state which capability is missing.
- Return a concise summary of completed operations and affected relative paths.
`.trim();
}

/**
 * Creates the internal tool list and removes duplicate tool names.
 *
 * folderOperationsTool has priority over any additional tool with the
 * same name.
 */
function createInternalTools(
  additionalTools: StructuredToolInterface[],
): StructuredToolInterface[] {
  const allTools:
    StructuredToolInterface[] = [
      folderOperationsTool,
      ...additionalTools,
    ];

  const uniqueTools =
    new Map<
      string,
      StructuredToolInterface
    >();

  for (
    const currentTool
    of allTools
  ) {
    if (
      !uniqueTools.has(
        currentTool.name,
      )
    ) {
      uniqueTools.set(
        currentTool.name,
        currentTool,
      );
    }
  }

  return [
    ...uniqueTools.values(),
  ];
}

/**
 * Creates the internal file-management sub-agent.
 */
async function createInternalFileAgent(
  tools: StructuredToolInterface[],
) {
  /*
   * Change this to getAsyncLLM("cheap") if your LLM loader supports
   * model tiers and you want a cheaper model for file routing.
   */
  const model =
    await getAsyncLLM();

  return createAgent({
    model,
    tools,
    systemPrompt:
      FILE_AGENT_SYSTEM_PROMPT,
  });
}

type InternalFileAgent =
  Awaited<
    ReturnType<
      typeof createInternalFileAgent
    >
  >;

/**
 * Creates a high-level file_manager tool.
 *
 * This tool is exposed to the main agent. It delegates the actual
 * filesystem work to an internal file-management agent.
 */
export function createFileManagerTool(
  options: CreateFileManagerToolOptions = {},
) {
  const {
    internalTools = [],

    name =
      "file_manager",

    description = `
Perform file and directory operations inside a specified root location.

Use this tool when the user asks to:
- Create folders
- Delete files or folders
- List directory contents
- Search for files or folders
- Read UTF-8 text files
- Perform any other operation supported by the internal file tools

Input:
- location: absolute path of the permitted root directory
- task: complete description of the requested filesystem work

The internal file agent selects and executes the required low-level tools.
All filesystem access is restricted to the supplied root location.
`.trim(),
  } = options;

  if (
    !Array.isArray(
      internalTools,
    )
  ) {
    throw new TypeError(
      "internalTools must be an array of LangChain tools.",
    );
  }

  const availableTools =
    createInternalTools(
      internalTools,
    );

  /*
   * The sub-agent is created lazily when file_manager is first invoked.
   *
   * The promise is cached so concurrent calls do not create multiple
   * identical agents.
   */
  let fileAgentPromise:
    Promise<InternalFileAgent> | null =
      null;

  async function getFileAgent():
    Promise<InternalFileAgent> {
    if (
      !fileAgentPromise
    ) {
      fileAgentPromise =
        createInternalFileAgent(
          availableTools,
        );
    }

    try {
      return await fileAgentPromise;
    } catch (
      error
    ) {
      /*
       * Clear a rejected initialization promise so the next invocation
       * can retry.
       */
      fileAgentPromise =
        null;

      throw error;
    }
  }

  return tool(
    async (
      {
        location,
        task,
      }: FileManagerInput,
      config?: RunnableConfig,
    ): Promise<string> => {
      const normalizedLocation =
        location.trim();

      const normalizedTask =
        task.trim();

      try {
        if (
          config?.signal
            ?.aborted
        ) {
          throw new Error(
            "The file operation was cancelled.",
          );
        }

        const fileAgent =
          await getFileAgent();

        if (
          config?.signal
            ?.aborted
        ) {
          throw new Error(
            "The file operation was cancelled.",
          );
        }

        const result =
          (await fileAgent.invoke(
            {
              messages: [
                {
                  role:
                    "user",

                  content:
                    createFileAgentRequest({
                      location:
                        normalizedLocation,

                      task:
                        normalizedTask,
                    }),
                },
              ],
            },
            config,
          )) as AgentResultLike;

        if (
          config?.signal
            ?.aborted
        ) {
          throw new Error(
            "The file operation was cancelled.",
          );
        }

        return getFinalResponse(
          result.messages,
        );
      } catch (
        error
      ) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : String(
                error,
              );

        return [
          "The file task could not be completed.",
          `Location: ${normalizedLocation}`,
          `Error: ${errorMessage}`,
        ].join(
          "\n",
        );
      }
    },
    {
      name,
      description,
      schema:
        fileManagerInputSchema,
    },
  );
}

/**
 * Ready-to-use file-management tool exposed to the main agent.
 *
 * Import this value directly into chat-agent.ts or project-agent.ts.
 */
export const fileManagerTool =
  createFileManagerTool();

export default fileManagerTool;