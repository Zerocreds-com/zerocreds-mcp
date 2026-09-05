#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createSession, checkStatus, type CreateSessionArgs } from './client.js';

const server = new Server(
  { name: 'zerocreds-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'zerocreds_create_session',
      description:
        'Creates a ZeroCreds credential collection session. Returns a one-time URL for the user to enter their credentials — the values go directly to the secret store and NEVER appear in the LLM context. Use this whenever you need a password, API token, or any sensitive data from the user. After calling this, show the URL to the user, then poll zerocreds_check_status every 5–10 seconds until status is "done".',
      inputSchema: {
        type: 'object' as const,
        properties: {
          title: {
            type: 'string',
            description: 'Form heading shown to the user (e.g. "Connect GitHub")',
          },
          description: {
            type: 'string',
            description: 'Optional subtext / instructions on the form',
          },
          fields: {
            type: 'array',
            description: 'Fields to collect from the user',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Field key (alphanumeric + _)' },
                label: { type: 'string', description: 'Label shown on the form' },
                type: {
                  type: 'string',
                  enum: ['text', 'password', 'email', 'tel', 'number', 'textarea', 'url'],
                  description: 'Input type (default: text; use password for secrets)',
                },
                placeholder: { type: 'string' },
                required: { type: 'boolean', description: 'Default: true' },
                level: {
                  type: 'string',
                  enum: ['secret', 'pii', 'attribute', 'credential'],
                  description: 'Sensitivity level shown to the user (optional)',
                },
              },
              required: ['name', 'label'],
            },
          },
          destination: {
            description:
              'Named destination (string, e.g. "local-dev") or inline config object (e.g. {"type":"local_file","uid":"local","filename":"github"}). Omit to use ZEROCREDS_DEFAULT_DESTINATION env var. For local Mac storage use inline: {"type":"local_file","uid":"local","filename":"<service-name>"}.',
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                },
                required: ['type'],
              },
            ],
          },
          ttl_minutes: {
            type: 'number',
            description: 'Link expiry in minutes (default: 30, max: 1440)',
          },
        },
        required: ['title', 'fields'],
      },
    },
    {
      name: 'zerocreds_check_status',
      description:
        'Checks whether the user has submitted the ZeroCreds form. Returns "pending" (still waiting), "done" (credentials saved successfully — you can now proceed), or "expired" (link timed out — create a new session if needed). Poll every 5–10 seconds after showing the URL to the user.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          token: {
            type: 'string',
            description: 'Session token returned by zerocreds_create_session',
          },
        },
        required: ['token'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'zerocreds_create_session') {
    const result = await createSession(args as unknown as CreateSessionArgs);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  }

  if (name === 'zerocreds_check_status') {
    const { token } = args as { token: string };
    const result = await checkStatus(token);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
