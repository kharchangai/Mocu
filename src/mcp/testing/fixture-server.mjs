/**
 * Fixture MCP stdio server used by automated tests.
 *
 * Implements a real MCP server with the official SDK (never third-party
 * services): a paginated tool list, echo/fail/structured/image tools,
 * a tools/list_changed notification, resources and prompts capabilities,
 * and a deliberately unredacted stderr line for redaction tests.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const [, , fixtureArg = 'default'] = process.argv;

const pageOne = [
  {
    name: 'echo',
    description: 'Returns the input text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to echo.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'fail',
    description: 'Always returns a tool error.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'structured',
    description: 'Returns structured content.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'image',
    description: 'Returns an image content block.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'slow',
    description: 'Waits before answering (timeout tests).',
    inputSchema: {
      type: 'object',
      properties: { seconds: { type: 'number' } },
    },
  },
];

const pageTwo = [
  {
    name: 'echo-two',
    description: 'Second page tool used for pagination tests.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server(
  { name: 'mocu-fixture-server', version: '1.0.0' },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: {},
      prompts: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, (request) => {
  if (request.params?.cursor === 'page-2') {
    return { tools: pageTwo };
  }
  return {
    tools: pageOne,
    ...(request.params?.cursor ? {} : { nextCursor: 'page-2' }),
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  switch (name) {
    case 'echo': {
      const text = request.params.arguments?.text ?? '';
      return {
        content: [{ type: 'text', text: `echo: ${text}` }],
      };
    }

    case 'echo-two':
      return {
        content: [{ type: 'text', text: 'echo-two result' }],
      };

    case 'fail':
      return {
        isError: true,
        content: [{ type: 'text', text: 'the fixture tool failed' }],
      };

    case 'structured':
      return {
        content: [{ type: 'text', text: 'with structured' }],
        structuredContent: { answer: 42 },
      };

    case 'image':
      return {
        content: [
          {
            type: 'image',
            data: 'aGVsbG8gZml4dHVyZQ==',
            mimeType: 'image/png',
          },
        ],
      };

    case 'slow': {
      const seconds = Number(request.params.arguments?.seconds ?? 5);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      return {
        content: [{ type: 'text', text: `waited ${seconds}s` }],
      };
    }

    default:
      return {
        isError: true,
        content: [{ type: 'text', text: `unknown fixture tool: ${name}` }],
      };
  }
});

server.setRequestHandler(ListResourcesRequestSchema, () => ({
  resources: [
    {
      uri: 'fixture://resource-1',
      name: 'Fixture Resource',
      mimeType: 'text/plain',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, (request) => ({
  contents: [
    {
      uri: request.params.uri,
      mimeType: 'text/plain',
      text: 'resource body',
    },
  ],
}));

server.setRequestHandler(ListPromptsRequestSchema, () => ({
  prompts: [
    {
      name: 'fixture-prompt',
      description: 'A fixture prompt.',
    },
  ],
}));

// Deliberately leak a "secret" on stderr so tests can verify redaction.
if (fixtureArg === 'leak-stderr') {
  process.stderr.write('starting with token sk-very-secret-value-1234\n');
}

const transport = new StdioServerTransport();
await server.connect(transport);
