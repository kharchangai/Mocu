// src/chat/services/cancelledRun.ts
//
// The checkpoint written to a conversation when the user cancels a running
// agent job.
//
// The checkpoint is a normal assistant message so it survives reloads and
// becomes part of the history the agent reads on the next turn, but its
// content is STRUCTURED:
//
//   MOCU_CANCELLED_RUN_V1 {json on one line}
//   <short readable summary>
//
// The JSON first line lets the chat render a compact card (instead of a
// wall of text), the readable tail keeps the message meaningful for the
// model and for plain-text consumers.

import type { AgentToolActivity } from './toolActivity';

export const CANCELLED_RUN_MARKER = 'MOCU_CANCELLED_RUN_V1';

export type CancelledRunToolStatus =
  | 'done'
  | 'error'
  | 'cancelled';

export type CancelledRunTool = {
  name: string;
  status: CancelledRunToolStatus;
  input: string;
};

export type CancelledRunData = {
  userPrompt: string;
  partialAnswer: string;
  tools: CancelledRunTool[];
  createdAt: string;
};

/*
 * Keep the persisted checkpoint small: the full tool log already lives in
 * the committed activity boxes attached to the same message, so the
 * checkpoint only carries a compact overview of it.
 */
const MAX_JSON_CHARS = 6_000;
const MAX_PARTIAL_ANSWER_CHARS = 4_000;
const MAX_TOOL_INPUT_CHARS = 240;
const MAX_TOOLS = 40;

function clamp(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

/** One-line summary of a tool input, mirroring the chat trace preview. */
function describeToolInput(
  args: Record<string, unknown> | undefined,
): string {
  if (!args) {
    return '';
  }

  for (const key of ['command', 'query', 'task', 'path', 'url']) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return clamp(value.trim(), MAX_TOOL_INPUT_CHARS);
    }
  }

  if (Object.keys(args).length === 0) {
    return '';
  }

  try {
    return clamp(JSON.stringify(args), MAX_TOOL_INPUT_CHARS);
  } catch {
    return '';
  }
}

function normalizeToolStatus(
  status: AgentToolActivity['status'],
): CancelledRunToolStatus {
  if (status === 'error') {
    return 'error';
  }

  if (status === 'running' || status === 'cancelled') {
    return 'cancelled';
  }

  return 'done';
}

function toCancelledRunTools(
  activities: AgentToolActivity[],
): CancelledRunTool[] {
  const tools: CancelledRunTool[] = [];

  for (const activity of activities) {
    if ((activity.kind ?? 'tool') !== 'tool') {
      continue;
    }

    tools.push({
      name: activity.tool,
      status: normalizeToolStatus(activity.status),
      input: describeToolInput(activity.args),
    });

    if (tools.length >= MAX_TOOLS) {
      break;
    }
  }

  return tools;
}

/**
 * Builds the checkpoint message for a cancelled run.
 *
 * The payload is deliberately compact — the per-tool log is already
 * persisted with this message through the activity store, so repeating it
 * here would only bloat the history the next turn has to read.
 */
export function buildCancelledRunMessage({
  userPrompt,
  partialAnswer,
  activities,
}: {
  userPrompt: string;
  partialAnswer: string;
  activities: AgentToolActivity[];
}): string {
  let payload: CancelledRunData = {
    userPrompt: userPrompt.trim(),
    partialAnswer: clamp(
      partialAnswer.trim(),
      MAX_PARTIAL_ANSWER_CHARS,
    ),
    tools: toCancelledRunTools(activities),
    createdAt: new Date().toISOString(),
  };

  let encoded = JSON.stringify(payload);

  if (encoded.length > MAX_JSON_CHARS) {
    payload = {
      ...payload,
      partialAnswer: '',
      tools: payload.tools.slice(0, 10),
    };
    encoded = JSON.stringify(payload);
  }

  const summaryLines = [
    'Task cancelled by the user before it finished.',
    'Everything completed so far is kept: this message, the tool log and the partial answer. Send a message to continue from this point.',
  ];

  if (payload.partialAnswer) {
    summaryLines.push('', `Partial answer:\n${payload.partialAnswer}`);
  }

  if (payload.tools.length > 0) {
    summaryLines.push(
      '',
      `Tool actions before cancellation: ${payload.tools
        .map((tool) => tool.name)
        .join(', ')}`,
    );
  }

  return `${CANCELLED_RUN_MARKER} ${encoded}\n${summaryLines.join('\n')}`;
}

/**
 * Reads a cancellation checkpoint back out of a message, or returns null
 * for every ordinary assistant message.
 */
export function parseCancelledRunMessage(
  content: string,
): CancelledRunData | null {
  if (!content.startsWith(CANCELLED_RUN_MARKER)) {
    return null;
  }

  const firstBreak = content.indexOf('\n');
  const header =
    firstBreak === -1
      ? content.slice(CANCELLED_RUN_MARKER.length)
      : content.slice(CANCELLED_RUN_MARKER.length, firstBreak);

  try {
    const parsed: unknown = JSON.parse(header.trim());

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = parsed as Partial<CancelledRunData>;

    if (typeof candidate.userPrompt !== 'string') {
      return null;
    }

    return {
      userPrompt: candidate.userPrompt,
      partialAnswer:
        typeof candidate.partialAnswer === 'string'
          ? candidate.partialAnswer
          : '',
      tools: Array.isArray(candidate.tools)
        ? candidate.tools.filter(
            (tool): tool is CancelledRunTool =>
              Boolean(tool) &&
              typeof tool === 'object' &&
              typeof (tool as CancelledRunTool).name === 'string',
          )
        : [],
      createdAt:
        typeof candidate.createdAt === 'string'
          ? candidate.createdAt
          : '',
    };
  } catch (error) {
    console.warn(
      '[Cancelled Run] Failed to parse a cancellation checkpoint:',
      error,
    );

    return null;
  }
}