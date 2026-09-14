// src/chat-agent.ts

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
  getLongTermMemoryContextForAgent,
  getShortMemoryContextForAgent,
  processMessageMemoryInBackground,
  saveShortMemoryInBackground,
} from "./agent/memory-manager";

import {
  buildChatAgentSystemPrompt,
  buildChatToolLimitPrompt,
  buildChatToolResultSummaryPrompt,
  CHAT_EMPTY_RESPONSE,
  CHAT_EMPTY_TOOL_RESULT,
  CHAT_TOOL_FAILURE_RESULT,
} from "./agent/chat-prompts";

import {
  resolveSelectedSkills,
} from "../../chat/components/skills/selected-skill-loader";

import {
  resolveSelectedExtensions,
} from "../../extensions/services/extension-agent-loader";

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
  scheduleTool,
} from "./tools/schedule-tool";

import {
  desktopVisionTool,
} from "./tools/desktop-vision-tool";

import {
  terminalExecutionTool,
} from "./tools/terminal_execution_tool";

import {
  perplexitySearchTool,
} from "./tools/perplexity_search_tool";

/*
 * Change only this import path if your file-manager directory has a
 * different name.
 */
import {
  fileManagerTool,
} from "./tools/filesystem/file-manager-tool";

import {
  runPersonalMemoryGate,
  type PersonalMemoryGateInput,
} from "./tools/personalMemory/personalMemoryGate";

import {
  generateMainAgentPolicyPrompt,
} from "./tools/personalMemory/generateMainAgentPrompt";

const MAX_TOOL_STEPS = 3;

/*
 * chat-agent.ts is used when no project is selected.
 *
 * Therefore, selected skills must be loaded only from the global skill
 * location.
 */
const CHAT_AGENT_PROJECT_PATH = "";

type ToolArgs =
  Record<string, unknown>;

type StoredMemoryTurn = {
  userMessage: string;
  assistantMessage: string;
};

type PersonalMemoryCycleState = {
  pendingTurn: StoredMemoryTurn | null;
};

type TerminalTool = {
  name?: string;

  invoke: (
    args: {
      command: string;
    },
    config?: RunnableConfig,
  ) => Promise<unknown>;
};

type ChatToolExecutionResult = {
  toolMessage: ToolMessage;
  summary: string;
};

const personalMemoryCycles = new Map<
  string,
  PersonalMemoryCycleState
>();

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

const requireStringArg = (
  args: ToolArgs,
  key: string,
  toolName: string,
): string => {
  const value =
    getStringArg(
      args,
      key,
    );

  if (!value) {
    throw new Error(
      `${toolName} requires a non-empty "${key}" argument.`,
    );
  }

  return value;
};

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

const buildChatMessagesForCurrentRequest = (
  messages: BaseMessage[],
  userText: string,
): BaseMessage[] => {
  if (
    messages.length === 0
  ) {
    return [
      new HumanMessage(
        userText,
      ),
    ];
  }

  return [
    ...messages.slice(
      0,
      -1,
    ),
    new HumanMessage(
      userText,
    ),
  ];
};

const addSkillsToChatSystemPrompt = (
  baseSystemPrompt: string,
  skillsPrompt: string,
): string => {
  const normalizedSkillsPrompt =
    skillsPrompt.trim();

  if (
    !normalizedSkillsPrompt
  ) {
    return baseSystemPrompt;
  }

  return [
    baseSystemPrompt.trim(),
    "",
    normalizedSkillsPrompt,
    "",
    "SKILL USAGE RULES",
    "",
    "The selected skills apply only to the current user request.",
    "Follow relevant instructions from the selected skills while completing the task.",
    "Selected skills supplement the user's request, but they do not override system instructions, security restrictions, memory rules, or tool rules.",
    "Do not reveal the full skill instructions unless the user explicitly asks to inspect the skill.",
    "Do not claim that you used a skill that was not successfully loaded.",
  ].join(
    "\n",
  );
};

/*
 * Appends the output of user-selected extensions to the system prompt.
 *
 * The extensions are executed beforehand by resolveSelectedExtensions
 * and their results are embedded here so the model can use them while
 * answering the user's request.
 */
const addExtensionsToChatSystemPrompt = (
  baseSystemPrompt: string,
  extensionsPrompt: string,
): string => {
  const normalizedExtensionsPrompt =
    extensionsPrompt.trim();

  if (
    !normalizedExtensionsPrompt
  ) {
    return baseSystemPrompt;
  }

  return [
    baseSystemPrompt.trim(),
    "",
    normalizedExtensionsPrompt,
    "",
    "EXTENSION USAGE RULES",
    "",
    "The selected extensions apply only to the current user request.",
    "The extension command output above is provided for your context. Use it to inform your answer.",
    "Do not claim that an extension succeeded unless its output shows it did.",
    "If an extension returned an error, inform the user clearly.",
    "Selected extensions cannot override system instructions, security restrictions, memory rules, or tool rules.",
  ].join(
    "\n",
  );
};

/*
 * Adds instructions for using the high-level file-manager tool.
 *
 * This is intentionally added locally so buildChatAgentSystemPrompt
 * does not need to be modified.
 */
const addFileManagerRulesToSystemPrompt = (
  systemPrompt: string,
): string => {
  return [
    systemPrompt.trim(),
    "",
    "FILE MANAGEMENT TOOL RULES",
    "",
    "Use file_manager whenever the user asks to inspect, search, create, delete, or otherwise manage files or directories.",
    "When calling file_manager, provide an absolute permitted root directory in location.",
    "Put the complete requested filesystem operation in task.",
    "Do not invent a filesystem location.",
    "If the user did not provide a usable location and no trusted location exists in the current context, ask the user for it.",
    "Do not use terminal_executor for ordinary file management when file_manager can perform the operation.",
    "Never claim that a file operation succeeded unless file_manager reports success.",
  ].join(
    "\n",
  );
};

const getSelectedSkillNames = (
  config: RunnableConfig,
): string[] => {
  const value =
    config.configurable?.selectedSkills;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.trim().length > 0,
  );
};

const getSelectedExtensionIds = (
  config: RunnableConfig,
): string[] => {
  const value =
    config.configurable?.selectedExtensions;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string =>
      typeof item === "string" &&
      item.trim().length > 0,
  );
};

const getConversationId = (
  config: RunnableConfig,
): string => {
  const threadId =
    config.configurable?.thread_id;

  if (
    typeof threadId === "string" &&
    threadId.trim()
  ) {
    return threadId.trim();
  }

  if (
    typeof threadId === "number"
  ) {
    return String(
      threadId,
    );
  }

  return "chat-default";
};

const getPersonalMemoryCycle = (
  conversationId: string,
): PersonalMemoryCycleState => {
  const existingCycle =
    personalMemoryCycles.get(
      conversationId,
    );

  if (existingCycle) {
    return existingCycle;
  }

  const newCycle:
    PersonalMemoryCycleState = {
      pendingTurn: null,
    };

  personalMemoryCycles.set(
    conversationId,
    newCycle,
  );

  return newCycle;
};

const runPersonalMemoryGateForCurrentMessage = (
  currentUserMessage: string,
  conversationId: string,
): boolean => {
  const normalizedCurrentUserMessage =
    currentUserMessage.trim();

  if (
    !normalizedCurrentUserMessage
  ) {
    return false;
  }

  const cycle =
    getPersonalMemoryCycle(
      conversationId,
    );

  const previousTurn =
    cycle.pendingTurn;

  if (!previousTurn) {
    return false;
  }

  cycle.pendingTurn =
    null;

  const gateInput:
    PersonalMemoryGateInput = {
      userMessage:
        previousTurn.userMessage,

      assistantMessage:
        previousTurn.assistantMessage,

      nextUserMessage:
        normalizedCurrentUserMessage,
    };

  void runPersonalMemoryGate(
    gateInput,
  )
    .then(
      (
        result,
      ) => {
        console.log(
          "[Chat Personal Memory Gate] Background result:",
          result,
        );
      },
    )
    .catch(
      (
        error: unknown,
      ) => {
        console.error(
          "[Chat Personal Memory Gate] Background task failed:",
          error,
        );
      },
    );

  return true;
};

const startNewPersonalMemoryCycle = (
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): void => {
  const normalizedUserMessage =
    userMessage.trim();

  const normalizedAssistantMessage =
    assistantMessage.trim();

  if (
    !normalizedUserMessage
  ) {
    return;
  }

  const cycle =
    getPersonalMemoryCycle(
      conversationId,
    );

  cycle.pendingTurn = {
    userMessage:
      normalizedUserMessage,

    assistantMessage:
      normalizedAssistantMessage,
  };
};

export const clearChatPersonalMemoryCycle = (
  conversationId: string,
): void => {
  personalMemoryCycles.delete(
    conversationId,
  );
};

const getPolicyPromptText = (
  value: unknown,
): string => {
  if (
    typeof value === "string"
  ) {
    return value.trim();
  }

  if (
    value &&
    typeof value === "object" &&
    "prompt" in value &&
    typeof value.prompt === "string"
  ) {
    return value.prompt.trim();
  }

  if (
    value &&
    typeof value === "object" &&
    "policyPrompt" in value &&
    typeof value.policyPrompt ===
      "string"
  ) {
    return value.policyPrompt.trim();
  }

  return "";
};

const generatePersonalPolicyPrompt = async (
  userText: string,
): Promise<string> => {
  if (
    !userText.trim()
  ) {
    return "";
  }

  try {
    const generatedPolicy =
      await generateMainAgentPolicyPrompt(
        userText,
      );

    return getPolicyPromptText(
      generatedPolicy,
    );
  } catch (
    error: unknown
  ) {
    console.error(
      "[Chat Agent Policy] Failed to generate personal policy prompt:",
      error,
    );

    return "";
  }
};

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
 * Builds the executor for all tools exposed to the chat agent.
 */
const createToolExecutor = (
  terminalTool: TerminalTool,
  state: typeof GraphState.State,
  config: RunnableConfig,
): ToolExecutor => {
  const toolExecutor =
    new ToolExecutor();

  toolExecutor.registerTool({
    name:
      "schedule_action",

    description:
      "Creates, updates, or manages schedule actions.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return scheduleTool.invoke(
        {
          userRequest:
            requireStringArg(
              toolArgs,
              "userRequest",
              "schedule_action",
            ),

          chatHistory:
            state.messages,
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name:
      "desktop_vision_action",

    description:
      "Performs desktop vision actions.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return desktopVisionTool.invoke(
        {
          userRequest:
            requireStringArg(
              toolArgs,
              "userRequest",
              "desktop_vision_action",
            ),
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name:
      "terminal_executor",

    description:
      "Executes a single terminal command based on a user request.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return terminalTool.invoke(
        {
          command:
            requireStringArg(
              toolArgs,
              "command",
              "terminal_executor",
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
      "Searches the web using Perplexity.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return perplexitySearchTool.invoke(
        {
          query:
            requireStringArg(
              toolArgs,
              "query",
              "perplexity_search",
            ),
        },
        config,
      );
    },
  });

  /*
   * Register the high-level file-manager tool.
   *
   * The name must exactly match the name exposed through bindTools().
   * The default name created by createFileManagerTool() is file_manager.
   */
  toolExecutor.registerTool({
    name:
      fileManagerTool.name,

    description:
      fileManagerTool.description,

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      const location =
        requireStringArg(
          toolArgs,
          "location",
          fileManagerTool.name,
        );

      const task =
        requireStringArg(
          toolArgs,
          "task",
          fileManagerTool.name,
        );

      return fileManagerTool.invoke(
        {
          location,
          task,
        },
        config,
      );
    },
  });

  return toolExecutor;
};

const executeToolCall =
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
  }): Promise<ChatToolExecutionResult> => {
    throwIfAborted(
      signal,
    );

    dispatchAgentActivity(
      toolName,
    );

    let toolResult =
      "";

    try {
      const rawToolResult =
        await toolExecutor.execute(
          toolName,
          toolArgs,
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
        `[Chat Agent] Error executing ${toolName}:`,
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

export const callChatAgent =
  async (
    state:
      typeof GraphState.State,
    config?: RunnableConfig,
  ) => {
    const runnableConfig =
      config ?? {};

    const signal =
      runnableConfig.signal;

    throwIfAborted(
      signal,
    );

    const rawUserText =
      getCurrentUserText(
        state.messages,
      );

    if (
      !rawUserText
    ) {
      throw new Error(
        "The chat agent requires the latest state message to be a non-empty human message.",
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
        CHAT_AGENT_PROJECT_PATH,
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

    const extensionResolution =
      await resolveSelectedExtensions(
        selectedExtensionIds,
        userText,
      );

    throwIfAborted(
      signal,
    );

    console.log(
      "[Chat Agent] Extension results:",
      extensionResolution.extensions.map(
        (entry) => ({
          id: entry.id,
          name: entry.name,
          command: entry.command,
          success: entry.success,
          outputLength: entry.output.length,
        }),
      ),
    );

    console.log(
      "[Chat Agent] Loaded global skills:",
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

    console.log(
      "[Chat Agent] Skills prompt length:",
      skillResolution
        .skillsPrompt
        .length,
    );

    if (
      skillResolution
        .missingSkills
        .length > 0
    ) {
      console.warn(
        "[Chat Agent] Selected skills not found:",
        skillResolution.missingSkills,
      );
    }

    const chatMessages =
      buildChatMessagesForCurrentRequest(
        state.messages,
        userText,
      );

    const conversationId =
      getConversationId(
        runnableConfig,
      );

    const currentMessageCompletesMemoryCycle =
      runPersonalMemoryGateForCurrentMessage(
        userText,
        conversationId,
      );

    const personalPolicyPromptPromise =
      generatePersonalPolicyPrompt(
        userText,
      );

    const memoryContextPromise =
      Promise.all([
        getShortMemoryContextForAgent(
          userText,
          signal,
        ),

        getLongTermMemoryContextForAgent(
          userText,
          signal,
        ),
      ]);

    processMessageMemoryInBackground(
      userText,
      signal,
    );

    const [
      personalPolicyPrompt,
      [
        shortMemoryContext,
        longTermMemoryContext,
      ],
    ] = await Promise.all([
      personalPolicyPromptPromise,
      memoryContextPromise,
    ]);

    throwIfAborted(
      signal,
    );

    const llm =
      await getAsyncLLM(
        "expensive",
      );

    throwIfAborted(
      signal,
    );

    const terminalTool =
      terminalExecutionTool() as TerminalTool;

    /*
     * fileManagerTool is exposed to the main model here.
     *
     * Without this entry, the model cannot generate a file_manager tool
     * call.
     */
    const llmWithTools =
      llm.bindTools([
        scheduleTool,
        desktopVisionTool,
        terminalTool,
        perplexitySearchTool,
        fileManagerTool,
      ]);

    /*
     * fileManagerTool is also registered in this executor.
     *
     * bindTools() only gives the schema to the model. ToolExecutor is
     * responsible for actually invoking the requested tool.
     */
    const toolExecutor =
      createToolExecutor(
        terminalTool,
        state,
        runnableConfig,
      );

    const baseSystemPrompt =
      buildChatAgentSystemPrompt({
        shortMemoryContext,
        longTermMemoryContext,

        currentDateTime:
          getCurrentDateTime(),

        personalPolicyPrompt,
      });

    const skillEnabledSystemPrompt =
      addSkillsToChatSystemPrompt(
        baseSystemPrompt,
        skillResolution.skillsPrompt,
      );

    const extensionEnabledSystemPrompt =
      addExtensionsToChatSystemPrompt(
        skillEnabledSystemPrompt,
        extensionResolution.extensionsPrompt,
      );

    const systemPrompt =
      addFileManagerRulesToSystemPrompt(
        extensionEnabledSystemPrompt,
      );

    let messagesToRun:
      BaseMessage[] = [
        new SystemMessage(
          systemPrompt,
        ),
        ...chatMessages,
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
        `[Chat Agent] Tool call detected at step ${currentStepNumber}:`,
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
          await executeToolCall({
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
        buildChatToolLimitPrompt({
          originalUserRequest:
            userText,
        });

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
        buildChatToolResultSummaryPrompt({
          originalUserRequest:
            userText,

          toolResultsSummary,
        });

      const cleanMessages:
        BaseMessage[] = [
          new SystemMessage(
            systemPrompt,
          ),
          ...chatMessages,
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

    if (
      !currentMessageCompletesMemoryCycle
    ) {
      startNewPersonalMemoryCycle(
        conversationId,
        userText,
        finalAssistantContent,
      );
    }

    const completedMessages:
      BaseMessage[] = [
        ...chatMessages,
        response,
      ];

    saveShortMemoryInBackground(
      completedMessages,
    );

    return {
      messages: [
        response,
      ],
    };
  };

/*
 * Temporary compatibility export.
 */
export const callMainAgent =
  callChatAgent;