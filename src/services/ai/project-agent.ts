// src/project-agent.ts

import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import type {
  RunnableConfig,
} from "@langchain/core/runnables";

import {
  isAbortError,
  throwIfAborted,
} from "./agent/abort";

import {
  dispatchAgentActivity,
  getTextContent,
  getToolResultText,
} from "./agent/helpers";

import {
  dispatchAgentToolActivity,
} from "../../chat/services/toolActivity";

import {
  dispatchMemorySaveActivity,
} from "../../chat/services/memoryActivity";

import {
  CHAT_EMPTY_RESPONSE,
  CHAT_EMPTY_TOOL_RESULT,
  CHAT_TOOL_FAILURE_RESULT,
} from "./agent/chat-prompts";

import {
  resolveSelectedSkills,
} from "../../chat/components/skills/selected-skill-loader";

import {
  loadExtensionAgentTools,
} from "../../extensions/services/extension-agent-tools";

import {
  ToolExecutor,
} from "./agent/tool-executor";

import {
  GraphState,
} from "./state";

import {
  getAsyncLLM,
} from "./llm";

import {
  terminalExecutionTool,
} from "./tools/terminal_execution_tool";

import {
  perplexitySearchTool,
} from "./tools/perplexity_search_tool";

import {
  saveProjectMemory,
} from "../../chat/project/memory/saveProjectMemory";

import {
  buildProjectMemoryPrompt,
  retrieveProjectMemory,
  type PreviousConversationTurn,
  type ProjectMemoryRetrievalResult,
} from "../../chat/project/memory/memory-retrieval/memoryRetrievalPipeline";

const MAX_TOOL_STEPS = 5;

type ToolArgs =
  Record<string, unknown>;

type TerminalTool = {
  invoke: (
    args: {
      command: string;
    },
    config?: RunnableConfig,
  ) => Promise<unknown>;
};

type ProjectToolExecutionResult = {
  toolMessage: ToolMessage;
  summary: string;
};

/*
 * Returns a normalized string argument from a tool-call argument object.
 */
const getStringArg = (
  args: ToolArgs,
  key: string,
): string => {
  const value =
    args[key];

  return typeof value === "string"
    ? value.trim()
    : "";
};

/*
 * Returns only the latest human message from the graph state.
 *
 * The complete state message history is never sent to the model.
 */
const getCurrentUserText = (
  messages: BaseMessage[],
): string => {
  const lastMessage =
    messages[
      messages.length - 1
    ];

  if (!lastMessage) {
    return "";
  }

  if (
    lastMessage.getType() !==
    "human"
  ) {
    return "";
  }

  return getTextContent(
    lastMessage.content,
  ).trim();
};

/*
 * Extracts the immediately previous live conversation turn.
 */
const getPreviousConversationTurn = (
  messages: BaseMessage[],
): PreviousConversationTurn | null => {
  for (
    let index = messages.length - 1;
    index >= 0;
    index -= 1
  ) {
    const message =
      messages[index];

    if (
      message.getType() !==
      "ai"
    ) {
      continue;
    }

    const agentResponse =
      getTextContent(
        message.content,
      ).trim();

    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const previousMessage =
        messages[
          previousIndex
        ];

      if (
        previousMessage.getType() !==
        "human"
      ) {
        continue;
      }

      const userMessage =
        getTextContent(
          previousMessage.content,
        ).trim();

      if (
        !userMessage ||
        !agentResponse
      ) {
        return null;
      }

      return {
        userMessage,
        agentResponse,
      };
    }

    return null;
  }

  return null;
};

/*
 * Saves the completed turn in project memory without blocking
 * the final response.
 */
const saveProjectMemoryInBackground = (
  userMessage: string,
  agentResponse: string,
  projectPath: string,
): void => {
  /*
   * Tell the chat UI the memory save started, so the small mind icon
   * starts blinking below the agent response.
   */
  dispatchMemorySaveActivity({
    status: "saving",
    projectPath,
  });

  void saveProjectMemory({
    userMessage,
    agentResponse,
    projectPath,
  })
    .then(
      (
        result,
      ) => {
        /*
         * Save complete: the mind icon stops blinking.
         */
        dispatchMemorySaveActivity({
          status: "done",
          projectPath,
        });

        console.log(
          "[Project Memory] Turn processed successfully:",
          {
            storageType:
              result.storageType,

            databasePath:
              result.databasePath,

            turnId:
              result.processResult.turnId,

            windowId:
              result.processResult.windowId,

            episodeId:
              result.processResult.episodeId,
          },
        );
      },
    )
    .catch(
      (
        error: unknown,
      ) => {
        /*
         * Save failed: the mind icon switches to the error state.
         */
        dispatchMemorySaveActivity({
          status: "error",
          projectPath,
        });

        console.error(
          "[Project Memory] Failed to save turn:",
          error,
        );
      },
    );
};

/*
 * Returns the current local date and time.
 */
const getCurrentDateTime =
  (): string => {
    return new Date().toLocaleString(
      "en-US",
      {
        weekday:
          "long",
        year:
          "numeric",
        month:
          "long",
        day:
          "numeric",
        hour:
          "2-digit",
        minute:
          "2-digit",
        second:
          "2-digit",
      },
    );
  };

/*
 * Builds a compact system prompt for Mocu.
 */
const buildProjectAgentSystemPrompt = (
  projectPath: string,
  skillsPrompt: string,
  extensionToolsPrompt: string,
  relatedMemoryPrompt: string,
): string => {
  const promptParts: string[] = [
    "You are Mocu, a helpful AI assistant.",
    "",
    "PROJECT PATH",
    projectPath,
  ];

  if (
    skillsPrompt.trim()
  ) {
    promptParts.push(
      "",
      skillsPrompt.trim(),
    );
  }

  if (
    extensionToolsPrompt.trim()
  ) {
    promptParts.push(
      "",
      extensionToolsPrompt.trim(),
    );
  }

  if (
    relatedMemoryPrompt.trim()
  ) {
    promptParts.push(
      "",
      relatedMemoryPrompt.trim(),
    );
  }

  promptParts.push(
    "",
    "AVAILABLE TOOLS",
    "terminal_executor, perplexity_search",
    "",
    `Current date and time: ${getCurrentDateTime()}`,
  );

  return promptParts.join(
    "\n",
  );
};

/*
 * Builds the executor for tools available to Mocu.
 */
const createProjectToolExecutor = (
  terminalTool: TerminalTool,
  config: RunnableConfig,
): ToolExecutor => {
  const toolExecutor =
    new ToolExecutor();

  toolExecutor.registerTool({
    name:
      "terminal_executor",

    description:
      "Executes a terminal command inside the active project folder.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return terminalTool.invoke(
        {
          command:
            getStringArg(
              toolArgs,
              "command",
            ),
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name:
      "perplexity_search",

    description:
      "Searches the web for current or external information.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return perplexitySearchTool.invoke(
        {
          query:
            getStringArg(
              toolArgs,
              "query",
            ),
        },
        config,
      );
    },
  });

  return toolExecutor;
};

/*
 * Executes one tool call and builds its ToolMessage.
 */
const executeProjectToolCall =
  async ({
    toolExecutor,
    toolName,
    toolArgs,
    toolCallId,
    stepNumber,
    signal,
  }: {
    toolExecutor: ToolExecutor;
    toolName: string;
    toolArgs: ToolArgs;
    toolCallId: string;
    stepNumber: number;
    signal?: AbortSignal;
  }): Promise<ProjectToolExecutionResult> => {
    throwIfAborted(
      signal,
    );

    dispatchAgentActivity(
      toolName,
    );

    /*
     * The chat activity feed shows a collapsible box per tool call,
     * so it receives the arguments up front and the result afterwards.
     * (The avatar keeps using the simple mocu_activity event above.)
     */
    dispatchAgentToolActivity({
      id: toolCallId,
      tool: toolName,
      args: toolArgs,
      status: "running",
    });

    let toolResult =
      "";

    try {
      const rawToolResult =
        await toolExecutor.execute(
          toolName,
          toolArgs,
          { toolCallId, toolName },
        );

      throwIfAborted(
        signal,
      );

      toolResult =
        getToolResultText(
          rawToolResult,
        ).trim();
    } catch (
      error: unknown
    ) {
      if (
        isAbortError(
          error,
        )
      ) {
        throw error;
      }

      console.error(
        `[Project Agent] Error executing ${toolName}:`,
        error,
      );

      toolResult =
        CHAT_TOOL_FAILURE_RESULT;
    } finally {
      dispatchAgentActivity(
        null,
      );
    }

    const normalizedToolResult =
      toolResult ||
      CHAT_EMPTY_TOOL_RESULT;

    dispatchAgentToolActivity({
      id: toolCallId,
      tool: toolName,
      args: toolArgs,
      result: normalizedToolResult,
      status:
        normalizedToolResult ===
        CHAT_TOOL_FAILURE_RESULT
          ? "error"
          : "done",
    });

    return {
      toolMessage:
        new ToolMessage({
          content:
            normalizedToolResult,

          tool_call_id:
            toolCallId,

          name:
            toolName,
        }),

      summary: [
        `[Tool result: ${toolName}]`,
        `[Step: ${stepNumber}]`,
        normalizedToolResult,
      ].join(
        "\n",
      ),
    };
  };

/*
 * Builds the prompt used when the tool-step limit is reached.
 */
const buildProjectToolLimitPrompt = (
  userRequest: string,
): string => {
  return [
    "Tool limit reached.",
    "Answer using the available results.",
    "Mention anything incomplete or unverified.",
    "",
    "REQUEST",
    userRequest,
  ].join(
    "\n",
  );
};

/*
 * Builds a compact final-answer prompt from the request and tool results.
 */
const buildProjectToolResultSummaryPrompt = ({
  originalUserRequest,
  projectPath,
  toolResultsSummary,
}: {
  originalUserRequest: string;
  projectPath: string;
  toolResultsSummary: string[];
}): string => {
  return [
    "Answer the request using the results below.",
    "Report important results, errors, and incomplete work accurately.",
    "",
    "PROJECT PATH",
    projectPath,
    "",
    "REQUEST",
    originalUserRequest,
    "",
    "RESULTS",
    toolResultsSummary.join(
      "\n\n",
    ),
  ].join(
    "\n",
  );
};

/*
 * Reads selected skill names from RunnableConfig.
 */
const getSelectedSkillNames = (
  config: RunnableConfig,
): string[] => {
  const value =
    config.configurable?.selectedSkills;

  if (
    !Array.isArray(
      value,
    )
  ) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.trim().length > 0,
  );
};

/*
 * Reads selected extension IDs from RunnableConfig.
 */
const getSelectedExtensionIds = (
  config: RunnableConfig,
): string[] => {
  const value =
    config.configurable?.selectedExtensions;

  if (
    !Array.isArray(
      value,
    )
  ) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.trim().length > 0,
  );
};

/*
 * Executes Mocu without sending the complete chat history to the model.
 */
export const callProjectAgent =
  async (
    state:
      typeof GraphState.State,
    projectPath: string,
    config?: RunnableConfig,
  ) => {
    const runnableConfig =
      config ?? {};

    const signal =
      runnableConfig.signal;

    throwIfAborted(
      signal,
    );

    const normalizedProjectPath =
      projectPath.trim();

    if (
      !normalizedProjectPath
    ) {
      throw new Error(
        "The project agent requires a non-empty project folder path.",
      );
    }

    const rawUserText =
      getCurrentUserText(
        state.messages,
      );

    if (
      !rawUserText
    ) {
      throw new Error(
        "The project agent requires the latest state message to be a non-empty human message.",
      );
    }

    throwIfAborted(
      signal,
    );

    const selectedSkillNames =
      getSelectedSkillNames(
        runnableConfig,
      );

    const skillResolution =
      await resolveSelectedSkills(
        selectedSkillNames,
        normalizedProjectPath,
      );

    throwIfAborted(
      signal,
    );

    const userText =
      rawUserText;

    const selectedExtensionIds =
      getSelectedExtensionIds(
        runnableConfig,
      );

    throwIfAborted(
      signal,
    );

    /*
     * Run memory retrieval for the current user message.
     * Retrieval failures do not block the agent.
     */
    let memoryResult:
      | ProjectMemoryRetrievalResult
      | null = null;

    try {
      memoryResult =
        await retrieveProjectMemory({
          userMessage:
            userText,

          projectPath:
            normalizedProjectPath,

          previousTurn:
            getPreviousConversationTurn(
              state.messages,
            ),
        });
    } catch (
      error: unknown
    ) {
      console.warn(
        "[Project Agent] Memory retrieval failed:",
        error,
      );
    }

    const relatedMemoryPrompt =
      buildProjectMemoryPrompt(
        memoryResult,
      );

    if (
      memoryResult?.memoryContext
    ) {
      console.log(
        "[Project Agent] Memory context found:",
        {
          memoryRequired:
            memoryResult.memoryRequired,

          gateConfidence:
            memoryResult.gateDecision.confidence,

          hasTemporalMemory:
            memoryResult.temporalMemory !== null,

          graphMemoryLength:
            memoryResult.graphMemoryContext.length,

          estimatedTokens:
            memoryResult.estimatedTokens,
        },
      );
    } else {
      console.log(
        "[Project Agent] No memory context found.",
      );
    }

    console.log(
      "[Project Agent] Running for project:",
      normalizedProjectPath,
    );

    console.log(
      "[Project Agent] Loaded skills:",
      skillResolution.skills.map(
        (
          skill,
        ) => ({
          name:
            skill.name,

          source:
            skill.source,

          path:
            skill.path,

          contentLength:
            skill.content.length,
        }),
      ),
    );

    if (
      skillResolution
        .missingSkills
        .length > 0
    ) {
      console.warn(
        "[Project Agent] Selected skills not found:",
        skillResolution.missingSkills,
      );
    }

    const llm =
      await getAsyncLLM(
        "expensive",
      );

    throwIfAborted(
      signal,
    );

    const terminalTool =
      terminalExecutionTool({
        projectPath:
          normalizedProjectPath,
      }) as TerminalTool;

    /*
     * Expose extension commands as callable tools so the agent can run
     * them itself when the user asks to use an extension (or a task
     * matches one). Extensions are never executed up front; when the
     * user selected specific extensions, only those are offered as
     * tools. Failures never block the agent.
     */
    const extensionTools =
      await loadExtensionAgentTools(
        selectedExtensionIds,
      );

    if (
      extensionTools.missingExtensions.length > 0
    ) {
      console.warn(
        "[Project Agent] Selected extensions not found:",
        extensionTools.missingExtensions,
      );
    }

    if (
      extensionTools.entries.length > 0
    ) {
      console.log(
        "[Project Agent] Extension tools available:",
        extensionTools.entries.map(
          (
            entry,
          ) => entry.name,
        ),
      );
    }

    /*
     * Expose tools to the model.
     */
    const llmWithTools =
      llm.bindTools([
        terminalTool,
        perplexitySearchTool,
        ...extensionTools.tools,
      ]);

    /*
     * Register tools for execution.
     */
    const toolExecutor =
      createProjectToolExecutor(
        terminalTool,
        runnableConfig,
      );

    extensionTools.registerAll(
      toolExecutor,
    );

    const systemPrompt =
      buildProjectAgentSystemPrompt(
        normalizedProjectPath,
        skillResolution.skillsPrompt,
        extensionTools.prompt,
        relatedMemoryPrompt,
      );

    let messagesToRun:
      BaseMessage[] = [
        new SystemMessage(
          systemPrompt,
        ),

        new HumanMessage(
          userText,
        ),
      ];

    let response =
      await llmWithTools.invoke(
        messagesToRun,
        runnableConfig,
      );

    throwIfAborted(
      signal,
    );

    const toolResultsSummary:
      string[] = [];

    let stepCount =
      0;

    while (
      response.tool_calls
        ?.length &&
      stepCount <
        MAX_TOOL_STEPS
    ) {
      throwIfAborted(
        signal,
      );

      const currentStepNumber =
        stepCount + 1;

      console.log(
        `[Project Agent] Tool call detected at step ${currentStepNumber}:`,
        response.tool_calls,
      );

      const toolMessages:
        ToolMessage[] = [];

      for (
        const toolCall
        of response.tool_calls
      ) {
        throwIfAborted(
          signal,
        );

        const toolCallId =
          toolCall.id;

        if (
          !toolCallId
        ) {
          throw new Error(
            `Missing tool call ID for ${toolCall.name}.`,
          );
        }

        const {
          toolMessage,
          summary,
        } =
          await executeProjectToolCall({
            toolExecutor,

            toolName:
              toolCall.name,

            toolArgs:
              (
                toolCall.args ??
                {}
              ) as ToolArgs,

            toolCallId,

            stepNumber:
              currentStepNumber,

            signal,
          });

        toolMessages.push(
          toolMessage,
        );

        toolResultsSummary.push(
          summary,
        );
      }

      throwIfAborted(
        signal,
      );

      messagesToRun = [
        ...messagesToRun,
        response,
        ...toolMessages,
      ];

      response =
        await llmWithTools.invoke(
          messagesToRun,
          runnableConfig,
        );

      throwIfAborted(
        signal,
      );

      stepCount +=
        1;
    }

    if (
      response.tool_calls
        ?.length &&
      stepCount >=
        MAX_TOOL_STEPS
    ) {
      const toolLimitPrompt =
        buildProjectToolLimitPrompt(
          userText,
        );

      const plainLlm =
        await getAsyncLLM();

      throwIfAborted(
        signal,
      );

      response =
        await plainLlm.invoke(
          [
            ...messagesToRun,
            response,

            new HumanMessage(
              toolLimitPrompt,
            ),
          ],
          runnableConfig,
        );

      throwIfAborted(
        signal,
      );
    }

    let finalAssistantContent =
      "";

    if (
      toolResultsSummary.length >
      0
    ) {
      const summaryPrompt =
        buildProjectToolResultSummaryPrompt({
          originalUserRequest:
            userText,

          projectPath:
            normalizedProjectPath,

          toolResultsSummary,
        });

      const cleanMessages:
        BaseMessage[] = [
          new SystemMessage(
            systemPrompt,
          ),

          new HumanMessage(
            summaryPrompt,
          ),
        ];

      const plainLlm =
        await getAsyncLLM();

      throwIfAborted(
        signal,
      );

      const finalResponse =
        await plainLlm.invoke(
          cleanMessages,
          runnableConfig,
        );

      throwIfAborted(
        signal,
      );

      finalAssistantContent =
        getTextContent(
          finalResponse.content,
        ).trim();

      response =
        finalResponse;
    } else {
      finalAssistantContent =
        getTextContent(
          response.content,
        ).trim();
    }

    if (
      !finalAssistantContent
    ) {
      finalAssistantContent =
        CHAT_EMPTY_RESPONSE;
    }

    response.content =
      finalAssistantContent;

    saveProjectMemoryInBackground(
      userText,
      finalAssistantContent,
      normalizedProjectPath,
    );

    return {
      messages: [
        response,
      ],
    };
  };