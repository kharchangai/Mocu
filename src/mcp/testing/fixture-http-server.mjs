/**
 * Fixture MCP HTTP servers used by automated tests (local only, no
 * third-party services):
 *
 * - streamable-http fixture built on the SDK's StreamableHTTPServerTransport
 *   (stateless mode).
 * - legacy SSE fixture built on the SDK's SSEServerTransport.
 *
 * Both expose the same tools as the stdio fixture and verify that Mocu
 * sends configured auth headers.
 */

import http from 'node:http';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const mode = process.argv[2] ?? 'streamable';
const expectedAuth = process.argv[3] ?? '';

let activeSseTransport = null;

function createMcpServer() {
  const server = new Server(
    { name: 'mocu-fixture-http', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Returns the input text.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [
      {
        type: 'text',
        text: `echo: ${request.params.arguments?.text ?? ''} (auth: ${expectedAuth ? 'seen' : 'none'})`,
      },
    ],
  }));

  return server;
}

if (mode === 'stdio') {
  const transport = new StdioServerTransport();
  await createMcpServer().connect(transport);
} else if (mode === 'streamable') {
  const httpServer = http.createServer((req, res) => {
    // Stateless mode: a fresh transport (and server) per request, as the
    // MCP SDK documents for stateless streamable HTTP servers.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    void createMcpServer()
      .connect(transport)
      .then(async () => {
        await transport.handleRequest(req, res);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        try {
          res.end();
        } catch {
          // already closed
        }
      });
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        process.stdout.write(`ready http://127.0.0.1:${address.port}/\n`);
      }
      resolve();
    });
  });
} else if (mode === 'sse') {
  const httpServer = http.createServer((req, res) => {
    const authorization = req.headers.authorization ?? '';

    if (expectedAuth && authorization !== expectedAuth) {
      res.statusCode = 401;
      res.end('unauthorized');
      return;
    }

    if (req.method === 'GET' && req.url === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      activeSseTransport = transport;
      void createMcpServer()
        .connect(transport)
        .catch((error) => {
          process.stderr.write(`fixture sse connect failed: ${error?.message ?? error}\n`);
        });
      return;
    }

    if (req.method === 'POST' && req.url?.startsWith('/messages')) {
      if (activeSseTransport) {
        void activeSseTransport.handlePostMessage(req, res).catch(() => {
          if (!res.headersSent) {
            res.statusCode = 500;
          }
          try {
            res.end();
          } catch {
            // already closed
          }
        });
      } else {
        res.statusCode = 404;
        res.end('no active sse session');
      }
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        process.stdout.write(
          `ready http://127.0.0.1:${address.port}/ mode=sse\n`,
        );
      }
      resolve();
    });
  });
}
