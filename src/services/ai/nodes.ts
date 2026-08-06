// main-agent.ts

import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import { RunnableConfig } from "@langchain/core/runnables";

import {
  isAbortError,
  throwIfAborted,
} from "./agent/abort";

import {
  getTextContent,
  getToolResultText,
  stripMarkdown,
  dispatchAgentActivity,
} from "./agent/helpers";

import {
  getLongTermMemoryContextForAgent,
  getShortMemoryContextForAgent,
  processMessageMemoryInBackground,
  saveShortMemoryInBackground,
} from "./agent/memory-manager";

import {
  buildMainAgentSystemPrompt,
  buildToolResultSummaryPrompt,
} from "./agent/prompts";

import { GraphState } from "./state";
import { getAsyncLLM } from "./llm";

import { ToolExecutor } from "./agent/tool-executor";

import { scheduleTool } from "./tools/schedule-tool";
import { desktopVisionTool } from "./tools/desktop-vision-tool";
import { terminalExecutionTool } from "./tools/terminal_execution_tool";
import { perplexitySearchTool } from "./tools/perplexity_search_tool";

import {
  runPersonalMemoryGate,
  PersonalMemoryGateInput,
} from "./tools/personalMemory/personalMemoryGate";

import { generateMainAgentPolicyPrompt } from "./tools/personalMemory/generateMainAgentPrompt";

const MAX_STEPS = 3;

type ToolArgs = Record<string, unknown>;

type StoredMemoryTurn = {
  userMessage: string;
  assistantMessage: string;
};

/**
 * Personal-memory cycle state for a single conversation.
 *
 * The cycle always uses exactly three messages:
 *
 *   1. user message
 *   2. assistant response
 *   3. next user message
 *
 * After the gate runs, the assistant response generated for the
 * third message is intentionally ignored and a brand new cycle starts.
 */
type PersonalMemoryCycleState = {
  pendingTurn: StoredMemoryTurn | null;
};

/**
 * Cycle state is kept per conversation so that different chats
 * never mix their interactions.
 */
const personalMemoryCycles = new Map<
  string,
  PersonalMemoryCycleState
>();

const getStringArg = (
  args: ToolArgs,
  key: string,
): string => {
  const value = args[key];

  return typeof value === "string" ? value : "";
};

const getConversationId = (
  config: RunnableConfig,
): string => {
  const threadId = config.configurable?.thread_id;

  if (
    typeof threadId === "string" &&
    threadId.trim()
  ) {
    return threadId.trim();
  }

  if (typeof threadId === "number") {
    return String(threadId);
  }

  return "default";
};

const getPersonalMemoryCycle = (
  conversationId: string,
): PersonalMemoryCycleState => {
  const existingCycle =
    personalMemoryCycles.get(conversationId);

  if (existingCycle) {
    return existingCycle;
  }

  const newCycle: PersonalMemoryCycleState = {
    pendingTurn: null,
  };

  personalMemoryCycles.set(
    conversationId,
    newCycle,
  );

  return newCycle;
};

/**
 * Consumes the stored user/assistant turn and sends it to the
 * personal-memory gate together with the current user message.
 *
 * The pending turn is cleared before the background task starts,
 * so the same interaction can never be processed twice.
 *
 * Returns true when the current user message completed a cycle.
 * In that case the response generated for this message must not
 * be stored as the beginning of the next cycle.
 */
const runPersonalMemoryGateForCurrentMessage = (
  currentUserMessage: string,
  conversationId: string,
): boolean => {
  if (!currentUserMessage.trim()) {
    return false;
  }

  const cycle =
    getPersonalMemoryCycle(conversationId);

  const previousTurn = cycle.pendingTurn;

  if (!previousTurn) {
    return false;
  }

  // Consume the pending turn immediately.
  cycle.pendingTurn = null;

  const gateInput: PersonalMemoryGateInput = {
    userMessage: previousTurn.userMessage,
    assistantMessage:
      previousTurn.assistantMessage,
    nextUserMessage: currentUserMessage,
  };

  void runPersonalMemoryGate(gateInput)
    .then((result) => {
      console.log(
        "[Personal Memory Gate] Background result:",
        result,
      );
    })
    .catch((error: unknown) => {
      console.error(
        "[Personal Memory Gate] Background task failed:",
        error,
      );
    });

  return true;
};

/**
 * Starts a new personal-memory cycle by storing the current
 * user message together with the assistant response.
 */
const startNewPersonalMemoryCycle = (
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
): void => {
  if (!userMessage.trim()) {
    return;
  }

  const cycle =
    getPersonalMemoryCycle(conversationId);

  cycle.pendingTurn = {
    userMessage,
    assistantMessage,
  };
};

const getPolicyPromptText = (
  value: unknown,
): string => {
  if (typeof value === "string") {
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
    typeof value.policyPrompt === "string"
  ) {
    return value.policyPrompt.trim();
  }

  return "";
};

const appendPolicyToSystemPrompt = (
  systemPrompt: string,
  policyPrompt: string,
): string => {
  if (!policyPrompt.trim()) {
    return systemPrompt;
  }

  return [
    systemPrompt,
    "",
    "## Personal Memory Policy",
    policyPrompt.trim(),
  ].join("\n");
};

const createToolExecutor = (
  terminalTool: {
    invoke: (
      args: ToolArgs,
      config?: RunnableConfig,
    ) => Promise<unknown>;
  },
  state: typeof GraphState.State,
  config: RunnableConfig,
): ToolExecutor => {
  const toolExecutor = new ToolExecutor();

  toolExecutor.registerTool({
    name: "schedule_action",
    description:
      "Creates, updates, or manages schedule actions.",
    execute: async (args) => {
      const toolArgs = args as ToolArgs;

      return scheduleTool.invoke(
        {
          userRequest: getStringArg(
            toolArgs,
            "userRequest",
          ),
          chatHistory: state.messages,
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name: "desktop_vision_action",
    description:
      "Performs desktop vision actions.",
    execute: async (args) => {
      const toolArgs = args as ToolArgs;

      return desktopVisionTool.invoke(
        {
          userRequest: getStringArg(
            toolArgs,
            "userRequest",
          ),
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name: "terminal_intent_executor",
    description:
      "Executes a terminal task based on a user intent.",
    execute: async (args) => {
      const toolArgs = args as ToolArgs;

      return terminalTool.invoke(
        {
          intent: getStringArg(toolArgs, "intent"),
        },
        config,
      );
    },
  });

  toolExecutor.registerTool({
    name: "perplexity_search",
    description:
      "Searches the web using Perplexity.",
    execute: async (args) => {
      const toolArgs = args as ToolArgs;

      return perplexitySearchTool.invoke(
        {
          query: getStringArg(toolArgs, "query"),
        },
        config,
      );
    },
  });

  return toolExecutor;
};

export const callMainAgent = async (
  state: typeof GraphState.State,
  config?: RunnableConfig,
) => {
  const runnableConfig = config ?? {};
  const signal = runnableConfig.signal;

  throwIfAborted(signal);

  const lastMessage =
    state.messages[state.messages.length - 1];

  const userText = lastMessage
    ? getTextContent(lastMessage.content).trim()
    : "";

  const conversationId =
    getConversationId(runnableConfig);

  /*
   * The personal-memory gate runs in the background.
   *
   * It receives:
   * - previous user message
   * - previous agent response
   * - current user message
   *
   * The main agent continues immediately and does not wait for it.
   *
   * When this returns true, the current message completed a cycle,
   * so the response generated below will be ignored by the cycle.
   */
  const currentMessageCompletesMemoryCycle =
    runPersonalMemoryGateForCurrentMessage(
      userText,
      conversationId,
    );

  /*
   * Every current user message is sent to the policy generator.
   * We wait for it because its result must be injected into the
   * main agent system prompt before the agent is invoked.
   */
  let personalPolicyPrompt = "";

  try {
    const generatedPolicy =
      await generateMainAgentPolicyPrompt(userText);

    personalPolicyPrompt =
      getPolicyPromptText(generatedPolicy);
  } catch (error: unknown) {
    console.error(
      "[Main Agent Policy] Failed to generate personal policy prompt:",
      error,
    );
  }

  throwIfAborted(signal);

  const shortMemoryContext =
    await getShortMemoryContextForAgent(
      userText,
      signal,
    );

  processMessageMemoryInBackground(
    userText,
    signal,
  );

  const relevantMemoryContext =
    await getLongTermMemoryContextForAgent(
      userText,
      signal,
    );

  throwIfAborted(signal);

  const llm = await getAsyncLLM("expensive");

  throwIfAborted(signal);

  const terminalTool = terminalExecutionTool(llm);

  const llmWithTools = llm.bindTools([
    scheduleTool,
    desktopVisionTool,
    terminalTool,
    perplexitySearchTool,
  ]);

  const toolExecutor = createToolExecutor(
    terminalTool,
    state,
    runnableConfig,
  );

  const currentDateTime = new Date().toLocaleString(
    "en-US",
    {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );

  const baseSystemPrompt =
    buildMainAgentSystemPrompt({
      shortMemoryContext,
      longTermMemoryContext: relevantMemoryContext,
      currentDateTime,
    });

  const systemPrompt = appendPolicyToSystemPrompt(
    baseSystemPrompt,
    personalPolicyPrompt,
  );

  let messagesToRun: BaseMessage[] = [
    new SystemMessage(systemPrompt),
    ...state.messages,
  ];

  let response = await llmWithTools.invoke(
    messagesToRun,
    runnableConfig,
  );

  throwIfAborted(signal);

  const toolResultsSummary: string[] = [];
  let stepCount = 0;

  while (
    response.tool_calls &&
    response.tool_calls.length > 0 &&
    stepCount < MAX_STEPS
  ) {
    throwIfAborted(signal);

    console.log(
      `[Main Agent] Tool call detected (Step ${stepCount + 1}):`,
      response.tool_calls,
    );

    const toolMessages: ToolMessage[] = [];

    for (const toolCall of response.tool_calls) {
      throwIfAborted(signal);

      const toolCallId = toolCall.id;

      if (!toolCallId) {
        throw new Error(
          `Missing tool call ID for ${toolCall.name}.`,
        );
      }

      let toolResult = "";

      dispatchAgentActivity(toolCall.name);

      try {
        const rawToolResult = await toolExecutor.execute(
          toolCall.name,
          (toolCall.args ?? {}) as ToolArgs,
        );

        throwIfAborted(signal);

        toolResult = getToolResultText(rawToolResult);
      } catch (toolError) {
        if (isAbortError(toolError)) {
          throw toolError;
        }

        console.error(
          `[Main Agent] Error executing ${toolCall.name}:`,
          toolError,
        );

        toolResult =
          "The requested operation failed. Continue naturally.";
      } finally {
        dispatchAgentActivity(null);
      }

      const normalizedToolResult =
        toolResult ||
        "Task completed successfully.";

      toolMessages.push(
        new ToolMessage({
          content: normalizedToolResult,
          tool_call_id: toolCallId,
          name: toolCall.name,
        }),
      );

      toolResultsSummary.push(
        `[Result from ${toolCall.name} in Step ${stepCount + 1}]: ${normalizedToolResult}`,
      );
    }

    throwIfAborted(signal);

    messagesToRun = [
      ...messagesToRun,
      response,
      ...toolMessages,
    ];

    response = await llmWithTools.invoke(
      messagesToRun,
      runnableConfig,
    );

    throwIfAborted(signal);

    stepCount += 1;
  }

  let finalAssistantContent = "";

  if (toolResultsSummary.length > 0) {
    throwIfAborted(signal);

    const cleanContextPrompt =
      buildToolResultSummaryPrompt({
        originalUserRequest:
          userText || "the user's request",
        toolResultsSummary,
      });

    const cleanMessages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...state.messages,
      new HumanMessage(cleanContextPrompt),
    ];

    const plainLlm = await getAsyncLLM();

    throwIfAborted(signal);

    const finalResponse = await plainLlm.invoke(
      cleanMessages,
      runnableConfig,
    );

    throwIfAborted(signal);

    finalAssistantContent = stripMarkdown(
      getTextContent(finalResponse.content),
    );
  } else {
    finalAssistantContent = stripMarkdown(
      getTextContent(response.content),
    );
  }

  if (!finalAssistantContent) {
    finalAssistantContent =
      "Task completed successfully.";
  }

  response.content = finalAssistantContent;

  /*
   * Store this turn only if the current user message did not
   * complete the previous cycle.
   *
   * If it did complete the cycle, this assistant response is
   * intentionally ignored and the next user message starts
   * a completely new cycle.
   */
  if (!currentMessageCompletesMemoryCycle) {
    startNewPersonalMemoryCycle(
      conversationId,
      userText,
      finalAssistantContent,
    );
  }

  const completedMessages: BaseMessage[] = [
    ...state.messages,
    response,
  ];

  saveShortMemoryInBackground(
    completedMessages,
  );

  return {
    messages: [response],
  };
};