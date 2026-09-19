/**
 * Normalization of MCP tool results for Mocu's existing text-based tool
 * result pipeline.
 *
 * Text, structured content, resource links, and embedded resources are
 * preserved in a bounded textual form. Binary content (images, audio) is
 * described explicitly rather than discarded silently. Resource links are
 * reported but never auto-fetched.
 */

import type { McpToolCallResult } from './types';
import { MAX_MCP_TOOL_RESULT_LENGTH } from './types';

type ContentBlock = {
  type: string;
  text?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  data?: string;
  resource?: {
    uri?: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
};

function formatByteCount(base64Length: number): number {
  return Math.floor((base64Length * 3) / 4);
}

function formatEmbeddedResource(block: ContentBlock): string {
  const resource = block.resource ?? {};
  const uri = resource.uri ?? '(unknown uri)';
  const mimeType = resource.mimeType ?? 'unknown type';

  if (typeof resource.text === 'string') {
    return `[embedded resource: ${uri} (${mimeType})]\n${resource.text}`;
  }

  if (typeof resource.blob === 'string') {
    return `[embedded resource: ${uri} (${mimeType}, binary content not displayed)]`;
  }

  return `[embedded resource: ${uri}]`;
}

function formatContentBlock(block: ContentBlock): string | null {
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : null;

    case 'image':
    case 'audio': {
      const mimeType = block.mimeType ?? 'unknown type';
      const size = typeof block.data === 'string'
        ? ` ~${formatByteCount(block.data.length)} bytes`
        : '';
      return `[${block.type}: ${mimeType}${size} — binary content not displayed]`;
    }

    case 'resource_link':
      return `[resource link: ${block.uri ?? '(unknown uri)'}${block.name ? ` (${block.name})` : ''}]`;

    case 'resource':
      return formatEmbeddedResource(block);

    default:
      return `[unsupported content block of type '${block.type}']`;
  }
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_MCP_TOOL_RESULT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_MCP_TOOL_RESULT_LENGTH)}\n\n[truncated: MCP tool output exceeded ${MAX_MCP_TOOL_RESULT_LENGTH} characters]`;
}

/**
 * Normalizes a raw MCP CallToolResult into Mocu's bounded textual form.
 * Distinguishes tool-reported errors (isError) from thrown errors: callers
 * receive this result either way and decide how to surface it.
 */
export function normalizeToolCallResult(raw: unknown): McpToolCallResult {
  if (!raw || typeof raw !== 'object') {
    return {
      text: truncateOutput(
        typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '',
      ),
      isError: false,
    };
  }

  const result = raw as {
    isError?: boolean;
    content?: ContentBlock[];
    structuredContent?: unknown;
  };

  const parts: string[] = [];

  for (const block of Array.isArray(result.content) ? result.content : []) {
    const formatted = formatContentBlock(block);
    if (formatted !== null && formatted.length > 0) {
      parts.push(formatted);
    }
  }

  let text = parts.join('\n').trim();

  if (result.structuredContent !== undefined) {
    let structuredText: string;
    try {
      structuredText = JSON.stringify(result.structuredContent, null, 2) ?? '';
    } catch {
      structuredText = String(result.structuredContent);
    }
    text = `${text}\n\n[structured output]\n${structuredText}`.trim();
  }

  if (!text && result.structuredContent === undefined) {
    text = 'The tool completed without a result.';
  }

  return {
    text: truncateOutput(text),
    isError: result.isError === true,
    ...(result.structuredContent !== undefined
      ? { structuredContent: result.structuredContent }
      : {}),
  };
}

/**
 * True when the error is a connection/transport problem rather than a tool
 * execution problem.
 */
export function isMcpTransportError(error: unknown): boolean {
  return error instanceof Error && error.name === 'McpTransportError';
}
