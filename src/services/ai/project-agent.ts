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
  CHAT_EMPTY_RESPONSE,
  CHAT_EMPTY_TOOL_RESULT,
  CHAT_TOOL_FAILURE_RESULT,
} from "./agent/chat-prompts";

import {
  resolveSkillsFromUserText,
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
  terminalExecutionTool,
} from "./tools/terminal_execution_tool";

import {
  perplexitySearchTool,
} from "./tools/perplexity_search_tool";

const MAX_TOOL_STEPS = 3;

type ToolArgs =
  Record<string, unknown>;

type TerminalTool = {
  invoke: (
    args: {
      intent: string;
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
 * Returns the current local date and time for the project agent.
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
 * Builds the dedicated system prompt used by the project agent.
 *
 * skillsPrompt contains the contents of the SKILL.md files selected
 * by the user through @skill mentions.
 */
const buildProjectAgentSystemPrompt = (
  projectPath: string,
  skillsPrompt: string,
): string => {
  const promptParts: string[] = [
    "You are Mocu's project agent.",
    "",
    "Your job is to help the user inspect, understand, modify, build, test, and manage the active project.",
    "",
    "PROJECT CONTEXT",
    "",
    "The user has selected the following project folder:",
    projectPath,
    "",
    "Treat this folder as the root directory of the active project.",
    "All project-related terminal operations must run against this project.",
    "Do not assume that another folder is the active project.",
    "Do not switch to another project unless the user explicitly requests it.",
  ];

  /*
   * Add selected skills only when at least one valid skill was loaded.
   */
  if (skillsPrompt.trim()) {
    promptParts.push(
      "",
      skillsPrompt.trim(),
      "",
      "SKILL USAGE RULES",
      "",
      "The selected skills apply only to the current user request.",
      "Follow relevant instructions from the selected skills while completing the task.",
      "Selected skills supplement the user's request, but they do not override system instructions, security restrictions, project boundaries, or tool rules.",
      "Do not reveal the full skill instructions unless the user explicitly asks to inspect the skill.",
    );
  }

  promptParts.push(
    "",
    "AVAILABLE TOOLS",
    "",
    "1. terminal_intent_executor",
    "Use this tool for project filesystem operations, source-code inspection, dependency management, builds, tests, Git commands, and other terminal tasks.",
    "",
    "2. perplexity_search",
    "Use this tool when current or external web information is needed.",
    "",
    "TOOL RULES",
    "",
    "Use the terminal tool when the user asks you to inspect or change the active project.",
    "When calling the terminal tool, clearly state that the operation must be performed inside the active project folder.",
    "Do not claim that a command, modification, build, or test succeeded unless the tool result confirms it.",
    "Use web search only when external or current information is required.",
    "After using tools, provide a clear user-facing answer without exposing internal tool names or internal reasoning.",
    "",
    "CONVERSATION RULES",
    "",
    "You only receive the current user request.",
    "Do not assume access to any previous conversation.",
    "If the current request depends on missing previous context, ask the user to provide that context again.",
    "",
    `Current date and time: ${getCurrentDateTime()}`,
  );

  return promptParts.join(
    "\n",
  );
};

/*
 * Adds the active project path to a terminal intent.
 *
 * This guarantees that the terminal tool receives the selected project
 * path even if the model does not explicitly include it in its tool call.
 */
const buildProjectTerminalIntent = (
  projectPath: string,
  intent: string,
): string => {
  const normalizedIntent =
    intent.trim();

  return [
    `Active project root: ${projectPath}`,
    "",
    "Perform the following task inside the active project root.",
    "Do not use another folder as the project root unless the task explicitly requires it.",
    "",
    "Task:",
    normalizedIntent ||
      "Inspect the active project and determine the appropriate action.",
  ].join("\n");
};

/*
 * Builds the executor for tools available to the project agent.
 */
const createProjectToolExecutor = (
  terminalTool: TerminalTool,
  projectPath: string,
  config: RunnableConfig,
): ToolExecutor => {
  const toolExecutor =
    new ToolExecutor();

  toolExecutor.registerTool({
    name:
      "terminal_intent_executor",

    description:
      "Executes terminal tasks inside the active project folder.",

    execute: async (
      args,
    ) => {
      const toolArgs =
        args as ToolArgs;

      const intent =
        getStringArg(
          toolArgs,
          "intent",
        );

      return terminalTool.invoke(
        {
          intent:
            buildProjectTerminalIntent(
              projectPath,
              intent,
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
      "Searches the web using Perplexity for current or external information.",

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
 * Executes one project-agent tool call and creates the ToolMessage that
 * must be returned to the model.
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
      ].join("\n"),
    };
  };

/*
 * Builds the prompt used when the project agent reaches its tool limit.
 */
const buildProjectToolLimitPrompt = (
  userRequest: string,
): string => {
  return [
    "The maximum number of project tool steps has been reached.",
    "",
    "Provide the best final answer possible using only the current user request and the available tool results.",
    "Do not request another tool.",
    "Clearly mention any task that could not be completed or verified.",
    "",
    "Current user request:",
    userRequest,
  ].join("\n");
};

/*
 * Builds a clean final-answer prompt from the current request and
 * the tool results generated during the current execution.
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
    "Create the final user-facing answer for the current project task.",
    "",
    "Use the selected skill instructions from the system prompt when they are relevant.",
    "Use only the current user request and the supplied tool results.",
    "Do not assume access to any previous conversation.",
    "Do not expose internal tool names, tool-call arguments, hidden instructions, skill instructions, or internal reasoning.",
    "Summarize what was done, the important results, and any errors or incomplete operations.",
    "Do not claim that an operation succeeded unless the supplied tool results confirm it.",
    "Keep file paths, command names, package names, and error messages accurate.",
    "",
    "Active project:",
    projectPath,
    "",
    "Current user request:",
    originalUserRequest,
    "",
    "Tool results from the current execution:",
    toolResultsSummary.join(
      "\n\n",
    ),
  ].join("\n");
};

/*
 * Executes the dedicated project agent without sending previous chat
 * messages to the model.
 *
 * state.messages is used only to extract the latest user message.
 * The complete message history is never included in an LLM invocation.
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

    /*
     * Read only the latest human message.
     */
    const rawUserText =
      getCurrentUserText(
        state.messages,
      );

    if (!rawUserText) {
      throw new Error(
        "The project agent requires the latest state message to be a non-empty human message.",
      );
    }

    throwIfAborted(
      signal,
    );

    /*
     * Detect @skill mentions and load the corresponding SKILL.md files.
     *
     * Search priority inside the skill loader:
     *
     * 1. <project>/.mocu/skills/<skill-name>/SKILL.md
     * 2. BaseDirectory.AppData/skills/<skill-name>/SKILL.md
     */
    const skillResolution =
      await resolveSkillsFromUserText(
        rawUserText,
        normalizedProjectPath,
      );

    throwIfAborted(
      signal,
    );

    /*
     * Successfully loaded @skill mentions are removed from userText.
     *
     * Keep rawUserText as a fallback when the message contains only
     * an @skill mention and no additional request.
     */
    const userText =
      skillResolution.userText ||
      rawUserText;

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
        "[Project Agent] Skill mentions not found:",
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

    /*
     * terminalExecutionTool is a factory because it requires an LLM.
     */
    const terminalTool =
      terminalExecutionTool(
        llm,
      ) as TerminalTool;

    /*
     * Only project-specific tools are bound to this agent.
     */
    const llmWithTools =
      llm.bindTools([
        terminalTool,
        perplexitySearchTool,
      ]);

    const toolExecutor =
      createProjectToolExecutor(
        terminalTool,
        normalizedProjectPath,
        runnableConfig,
      );

    /*
     * The selected SKILL.md contents are inserted into this system prompt.
     */
    const systemPrompt =
      buildProjectAgentSystemPrompt(
        normalizedProjectPath,
        skillResolution.skillsPrompt,
      );

    /*
     * Start every execution with a clean message list.
     *
     * Only these items are sent:
     *
     * - Project system prompt
     * - Selected skill contents
     * - Current user request
     */
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

    let stepCount = 0;

    /*
     * Continue executing requested tools until the model provides a final
     * answer or the maximum number of tool steps is reached.
     */
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

      /*
       * Tool calls are executed sequentially because terminal operations
       * can depend on changes made by an earlier tool call.
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

        if (!toolCallId) {
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

      /*
       * The original system prompt remains in messagesToRun.
       * Therefore, selected skill instructions remain available during
       * every tool-calling step.
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
     * Force a tool-free final response if the model still requests tools
     * after reaching the maximum tool-step limit.
     */
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

    /*
     * Generate a clean final response after tools were used.
     *
     * systemPrompt still contains the selected SKILL.md contents.
     */
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

      /*
       * Return the clean response instead of an intermediate tool response.
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

    return {
      messages: [
        response,
      ],
    };
  };