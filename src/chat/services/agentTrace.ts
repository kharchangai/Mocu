// src/chat/services/agentTrace.ts
//
// Live trace of ONE model call of an agent turn.
//
// Every model call of the chat / project / custom agents gets a trace:
//
//   - reasoning deltas stream into a "thought" entry shown as gray
//     italic text, word by word while the model works (pi style)
//   - ordinary text streams into a "note" entry: one quiet ↳ row with
//     a growing preview; click it to read the full text
//
// The response bubble is only used by the FINAL call of the turn (or
// when an intermediate call turns out to need no tools at all), so the
// agent's answer arrives at the very end instead of appearing and
// jumping around while the agent works.

import type { BaseMessage, AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';

import {
  dispatchAgentAnswerDelta,
  dispatchAgentToolActivity,
} from './toolActivity';
import {
  streamChatModelWithTrace,
  type StreamableChatModel,
} from '../../services/ai/model-stream';

let traceCounter = 0;

export type AgentModelTrace = {
  /*
   * Clears the live answer preview before the call starts.
   */
  begin: () => void;

  onThinking: (accumulated: string) => void;

  onText: (accumulated: string) => void;

  /*
   * Closes the trace once the model call finished.
   */
  finish: (options: {
    hasToolCalls: boolean;
  }) => void;
};

/*
 * NOTE: begin() must run at the start of every attempt of a model
 * call, so a retried request replaces its trace cleanly instead of
 * visibly shrinking and re-growing the streamed text.
 */

export type AgentModelTraceOptions = {
  /*
   * 'tools'  — this call is bound to tools. Its text becomes a ↳ note
   *            row (click to read) unless the call turns out to need
   *            no tools at all, in which case it IS the answer.
   * 'answer' — the final response call of the turn: its text streams
   *            directly into the response at the end.
   */
  mode?: 'tools' | 'answer';

  /*
   * In 'tools' mode: promote the text to the response when the call
   * finishes without tool calls. Turn off when a final summary call
   * follows anyway (tool-limit path).
   */
  convertToAnswer?: boolean;
};

export const invokeAgentModelWithTrace = async ({
  chatId,
  model,
  messages,
  config,
  mode = 'tools',
}: {
  chatId: string;
  model: StreamableChatModel;
  messages: BaseMessage[];
  config?: unknown;
  mode?: 'tools' | 'answer';
}): Promise<AIMessage> => {
  const trace = createAgentModelTrace(chatId, { mode });

  try {
    const response = await streamChatModelWithTrace({
      model,
      messages,
      config: config as RunnableConfig | undefined,
      handlers: {
        onStart: trace.begin,
        onThinking: trace.onThinking,
        onText: trace.onText,
      },
    });
    trace.finish({ hasToolCalls: Boolean(response.tool_calls?.length) });
    return response;
  } catch (error) {
    // Close any in-progress thought row if the provider fails mid-stream.
    trace.finish({ hasToolCalls: false });
    throw error;
  }
};

export const createAgentModelTrace = (
  chatId: string | undefined,
  options: AgentModelTraceOptions = {},
): AgentModelTrace => {
  const mode = options.mode ?? 'tools';
  const convertToAnswer =
    options.convertToAnswer ?? mode === 'tools';

  const traceId = `trace-${Date.now().toString(36)}-${(traceCounter += 1)}`;

  const thoughtId = `${traceId}-think`;
  const noteId = `${traceId}-note`;

  let thinking = '';
  let text = '';

  const dispatchThought = (
    status: 'running' | 'done',
  ): void => {
    dispatchAgentToolActivity({
      id: thoughtId,
      tool: 'thought',
      kind: 'thought',
      text: thinking,
      status,
      chatId,
    });
  };

  return {
    /*
     * Called at the start of EVERY attempt of this model call (the
     * model wrappers retry). Resets the accumulated text and puts an
     * empty thought row in place right away, so the row is there from
     * the very first token instead of popping in later.
     */
    begin: () => {
      thinking = '';
      text = '';

      dispatchThought('running');
      dispatchAgentAnswerDelta({ chatId, text: '' });
    },

    onThinking: (accumulated) => {
      if (!accumulated) {
        return;
      }

      thinking = accumulated;

      dispatchThought('running');
    },

    onText: (accumulated) => {
      text = accumulated;

      /*
       * Final call: stream straight into the response at the end.
       * Every other call: stream into the ↳ note row, so the response
       * area never fills up mid-turn and then jumps around.
       */
      if (mode === 'answer') {
        dispatchAgentAnswerDelta({
          chatId,
          text: accumulated,
        });

        return;
      }

      if (!accumulated) {
        return;
      }

      dispatchAgentToolActivity({
        id: noteId,
        tool: 'note',
        kind: 'note',
        text: accumulated,
        status: 'running',
        chatId,
      });
    },

    finish: ({ hasToolCalls }) => {
      /*
       * Always close the thought row, even when the model produced no
       * reasoning: an empty finished row renders as nothing, while a
       * row left "running" would spin forever.
       */
      dispatchThought('done');

      if (mode === 'answer' || !text.trim()) {
        return;
      }

      /*
       * The call needed no tools: its text was the answer all along.
       * Drop the note row and reveal it as the response — this only
       * happens at the end of the turn, where the answer belongs.
       */
      const promoteToAnswer =
        !hasToolCalls && convertToAnswer;

      dispatchAgentToolActivity({
        id: noteId,
        tool: 'note',
        kind: 'note',
        text: promoteToAnswer ? '' : text,
        status: 'done',
        chatId,
      });

      if (promoteToAnswer) {
        dispatchAgentAnswerDelta({
          chatId,
          text,
        });
      }
    },
  };
};