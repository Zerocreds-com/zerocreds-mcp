#!/usr/bin/env node

if (process.argv[2] === 'setup') {
  const { runSetup } = await import('./setup.js');
  await runSetup();
  process.exit(0);
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createSession, checkStatus, type CreateSessionArgs } from './client.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

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
              'Named destination (string, e.g. "os-keychain") or inline config object (e.g. {"type":"os_keychain","service":"zerocreds","account":"github"}). Omit to use ZEROCREDS_DEFAULT_DESTINATION env var. Recommended: "os-keychain" stores in macOS Keychain or Windows Credential Manager automatically.',
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: { type: { type: 'string' } },
                required: ['type'],
              },
            ],
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
    {
      name: 'zerocreds_ensure_server',
      description:
        'Ensures the ZeroCreds MCP server is running. Starts it if not already running. Returns server status and PID.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'zerocreds_create_session') {
    const result = await createSession(args as unknown as CreateSessionArgs);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  }

  if (name === 'zerocreds_check_status') {
    const { token } = args as { token: string };
    const result = await checkStatus(token);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  }

  if (name === 'zerocreds_ensure_server') {
    const result = await ensureServer();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// ── zerocreds_ensure_server implementation ──────────────────────────────────

async function ensureServer(): Promise<{ status: string; pid?: number; message: string }> {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const nodeBin = process.execPath;
  const serverScript = path.join(repoRoot, 'dist', 'index.js');

  // 1. Check if already running
  try {
    const { stdout } = await execAsync(
      `pgrep -f "node ${serverScript.replace(/ /g, '\\ ')}\"`,
      { timeout: 5000 },
    );
    const pids = stdout.trim().split('\n').filter(Boolean).map(Number);
    if (pids.length > 0) {
      console.log('✅ ZeroCreds MCP server is already running.');
      return { status: 'already_running', pid: pids[0], message: 'ZeroCreds MCP server is already running.' };
    }
  } catch {
    // pgrep returns non-zero when no match — that's expected, continue.
  }

  // 2. Read admin token (for logging only — never expose the value)
  const tokenPath = path.join(os.homedir(), '.config', 'zerocreds', 'local', 'admin-token');
  let hasToken = false;
  try {
    fs.accessSync(tokenPath, fs.constants.R_OK);
    hasToken = true;
  } catch {
    // token file missing — server may still start but will fail later
  }

  // 3. Start the server
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (hasToken) {
    env.ZEROCREDS_TOKEN = fs.readFileSync(tokenPath, 'utf8').trim();
  }

  // Spawn detached so it survives the parent process
  const { spawn } = await import('child_process');
  const child = spawn(nodeBin, [serverScript], {
    env,
    detached: true,
    stdio: 'inherit',
  });
  child.unref();

  const pid = child.pid;
  if (!pid) {
    return { status: 'error', message: 'Failed to spawn server process.' };
  }

  console.log(`🚀 Server process started with PID: ${pid}`);

  // 4. Wait for readiness (poll for process existence)
  const maxWaitMs = 5000;
  const pollInterval = 500;
  let waited = 0;
  while (waited < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    waited += pollInterval;
    try {
      const { stdout } = await execAsync(
        `pgrep -f "node ${serverScript.replace(/ /g, '\\ ')}\"`,
        { timeout: 3000 },
      );
      if (stdout.trim()) {
        return {
          status: 'started',
          pid,
          message: `ZeroCreds MCP server started (PID ${pid}).`,
        };
      }
    } catch {
      // process not yet visible — keep waiting
    }
  }

  return {
    status: 'timeout',
    pid,
    message: `Server process spawned (PID ${pid}) but did not become ready within ${maxWaitMs}ms.`,
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);