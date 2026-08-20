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

import {
  runPersonalMemoryGate,
  type PersonalMemoryGateInput,
} from "./tools/personalMemory/personalMemoryGate";

import {
  generateMainAgentPolicyPrompt,
} from "./tools/personalMemory/generateMainAgentPrompt";

const MAX_TOOL_STEPS = 3;

/*
 * An empty project path is intentional.
 *
 * chat-agent.ts is used only when no project is selected, so the skill
 * loader must search global skills only.
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
  invoke: (
    args: {
      intent: string;
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
 * Replaces the latest human message with the cleaned current request.
 *
 * The /skill command is stripped in the input layer, so the request text
 * is already clean when it reaches the agent.
 */
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

/*
 * Adds selected global skill instructions to the existing chat-agent
 * system prompt.
 *
 * Keeping this helper local avoids requiring a signature change in
 * buildChatAgentSystemPrompt.
 */
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
 * Reads the skill names selected with the /skill command from the
 * RunnableConfig carried through the chat request.
 */
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

  /*
   * Consume the pending turn before starting the background task.
   * This prevents the same cycle from being processed more than once.
   */
  cycle.pendingTurn = null;

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
 * Builds the executor for tools available to the chat agent.
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
            getStringArg(
              toolArgs,
              "userRequest",
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
            getStringArg(
              toolArgs,
              "userRequest",
            ),
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name:
      "terminal_intent_executor",

    description:
      "Executes a terminal task based on a user intent.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      return terminalTool.invoke(
        {
          intent:
            getStringArg(
              toolArgs,
              "intent",
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
 * Executes one chat-agent tool call and creates the ToolMessage that must
 * be returned to the model.
 */
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

    let toolResult = "";

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

    /*
     * Keep the original text until the selected skills have been
     * resolved.
     */
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

    /*
     * Load the SKILL.md files for the skills selected with the /skill
     * command.
     *
     * The project path is intentionally empty because callChatAgent is
     * used when no project is selected. The skill loader must therefore
     * skip all project-skill filesystem operations and search only:
     *
     * BaseDirectory.AppData/skills/<skill-name>/SKILL.md
     */
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

    /*
     * The /skill command is stripped in the input layer, so the request
     * text sent to the model is the original user message unchanged.
     */
    const userText =
      rawUserText;

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

    /*
     * Preserve previous conversation messages while replacing the latest
     * raw message with the cleaned current user request.
     */
    const chatMessages =
      buildChatMessagesForCurrentRequest(
        state.messages,
        userText,
      );

    const conversationId =
      getConversationId(
        runnableConfig,
      );

    /*
     * This preserves the current three-message memory-cycle behavior:
     *
     * 1. Previous user message
     * 2. Previous assistant response
     * 3. Current user message
     */
    const currentMessageCompletesMemoryCycle =
      runPersonalMemoryGateForCurrentMessage(
        userText,
        conversationId,
      );

    /*
     * The policy generator is awaited because its result must be included
     * in the system prompt before the chat model is invoked.
     */
    const personalPolicyPromptPromise =
      generatePersonalPolicyPrompt(
        userText,
      );

    /*
     * Short-term and long-term memory retrieval are independent, so they
     * can run concurrently.
     */
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

    /*
     * Message-memory processing does not block the current response.
     */
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
      terminalExecutionTool(
        llm,
      ) as TerminalTool;

    const llmWithTools =
      llm.bindTools([
        scheduleTool,
        desktopVisionTool,
        terminalTool,
        perplexitySearchTool,
      ]);

    const toolExecutor =
      createToolExecutor(
        terminalTool,
        state,
        runnableConfig,
      );

    /*
     * Build the existing chat-agent prompt first.
     */
    const baseSystemPrompt =
      buildChatAgentSystemPrompt({
        shortMemoryContext,
        longTermMemoryContext,
        currentDateTime:
          getCurrentDateTime(),
        personalPolicyPrompt,
      });

    /*
     * Add the selected global SKILL.md contents to the system prompt.
     */
    const systemPrompt =
      addSkillsToChatSystemPrompt(
        baseSystemPrompt,
        skillResolution.skillsPrompt,
      );

    /*
     * The skill-enabled system prompt remains at the beginning of the
     * message list throughout all tool-calling steps.
     */
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

    let stepCount = 0;

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

      /*
       * Tool calls are executed sequentially because some operations may
       * depend on previous side effects or shared resources.
       */
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

      /*
       * systemPrompt remains in messagesToRun. Therefore, selected skill
       * instructions remain available during every tool-calling step.
       */
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

      stepCount += 1;
    }

    /*
     * If the model still requests tools after the limit, force a final
     * response using a model invocation without bound tools.
     */
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

    /*
     * Generate a clean final response after tools were used.
     *
     * The same skill-enabled system prompt is used here, so selected
     * skills remain available during final-answer generation.
     */
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

      /*
       * Return the clean final response object so metadata from an
       * intermediate tool-call response is not retained.
       */
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

    /*
     * Preserve the intentionally non-overlapping personal-memory cycle.
     */
    if (
      !currentMessageCompletesMemoryCycle
    ) {
      startNewPersonalMemoryCycle(
        conversationId,
        userText,
        finalAssistantContent,
      );
    }

    /*
     * Save the cleaned request rather than the internal /skill command.
     */
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