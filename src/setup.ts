import * as readline from 'readline/promises';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return rl.question(q);
}

async function choose(prompt: string, options: { label: string; value: string }[], defaultIdx = 0): Promise<string> {
  console.log(`\n${prompt}`);
  options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}${i === defaultIdx ? ' (default)' : ''}`));
  while (true) {
    const raw = (await ask(`> `)).trim();
    if (raw === '' && defaultIdx >= 0) return options[defaultIdx].value;
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= options.length) return options[n - 1].value;
    console.log(`  Enter a number between 1 and ${options.length}`);
  }
}

async function askSecret(prompt: string): Promise<string> {
  // Node doesn't have built-in password input; just ask plainly
  const val = (await ask(prompt)).trim();
  return val;
}

function mcpConfigPath(): string {
  // Claude Code: ~/.claude/mcp.json
  return path.join(os.homedir(), '.claude', 'mcp.json');
}

function claudeDesktopConfigPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  }
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

function writeConfig(configPath: string, serverConfig: Record<string, unknown>) {
  let existing: Record<string, unknown> = {};
  try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  const mcpServers = (existing.mcpServers as Record<string, unknown>) || {};
  mcpServers['zerocreds'] = serverConfig;
  existing.mcpServers = mcpServers;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}

export async function runSetup() {
  console.log('\n🔐 ZeroCreds MCP Setup\n');

  // 1. Server location
  const serverType = await choose('Where is your ZeroCreds server?', [
    { label: 'zerocreds.ru (hosted)', value: 'hosted' },
    { label: 'localhost (I run it locally)', value: 'local' },
    { label: 'Custom URL', value: 'custom' },
  ]);

  let serverUrl: string;
  if (serverType === 'hosted') {
    serverUrl = 'https://zerocreds.ru';
  } else if (serverType === 'local') {
    const port = (await ask('\nPort [3456]: ')).trim() || '3456';
    serverUrl = `http://localhost:${port}`;
  } else {
    serverUrl = (await ask('\nServer URL: ')).trim().replace(/\/$/, '');
  }

  // 2. Auth token
  console.log('');
  const token = await askSecret('Admin or integrator token: ');
  if (!token) { console.error('Token is required.'); process.exit(1); }

  // 3. Default destination
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const destOptions = [
    ...(isMac ? [{ label: 'macOS Keychain (recommended)', value: 'os-keychain' }] : []),
    ...(isWin ? [{ label: 'Windows Credential Manager (recommended)', value: 'os-keychain' }] : []),
    { label: 'Local files (~/' + path.join('agent-tokens', 'local') + '/)', value: 'local-dev' },
    { label: 'GCP Secret Manager', value: 'gcp' },
    { label: 'AWS Secrets Manager', value: 'aws' },
    { label: 'HashiCorp Vault', value: 'vault' },
  ];
  const destChoice = await choose('Where should credentials be stored?', destOptions);

  let defaultDest = destChoice;
  let extraNote = '';

  if (destChoice === 'gcp') {
    defaultDest = 'gcp-prod';
    extraNote = '\n⚠️  Add your GCP destination to ~/zerocreds-destinations.json as "gcp-prod".';
  } else if (destChoice === 'aws') {
    defaultDest = 'aws-prod';
    extraNote = '\n⚠️  Add your AWS destination to ~/zerocreds-destinations.json as "aws-prod".';
  } else if (destChoice === 'vault') {
    defaultDest = 'vault-prod';
    extraNote = '\n⚠️  Add your Vault destination to ~/zerocreds-destinations.json as "vault-prod".';
  }

  // 4. Telegram notifications (optional)
  const wantTg = (await ask('\nSend credential links via Telegram? [y/N]: ')).trim().toLowerCase();
  let tgConfig: Record<string, string> = {};
  if (wantTg === 'y') {
    const tgToken = await askSecret('Telegram bot token: ');
    const tgChatId = await ask('Telegram chat ID: ');
    if (tgToken && tgChatId) {
      tgConfig = {
        ZEROCREDS_TG_BOT_TOKEN: tgToken.trim(),
        ZEROCREDS_TG_CHAT_ID: tgChatId.trim(),
      };
    }
  }

  // 5. Which client to configure
  const clientChoice = await choose('Which client to configure?', [
    { label: 'Claude Code (recommended)', value: 'code' },
    { label: 'Claude Desktop', value: 'desktop' },
    { label: 'Both', value: 'both' },
  ]);

  // Build server config
  const serverConfig = {
    type: 'stdio',
    command: 'npx',
    args: ['zerocreds-mcp'],
    env: {
      ZEROCREDS_URL: serverUrl,
      ZEROCREDS_TOKEN: token,
      ZEROCREDS_DEFAULT_DESTINATION: defaultDest,
      ...tgConfig,
    },
  };

  // Write config(s)
  const written: string[] = [];
  if (clientChoice === 'code' || clientChoice === 'both') {
    const p = mcpConfigPath();
    writeConfig(p, serverConfig);
    written.push(p);
  }
  if (clientChoice === 'desktop' || clientChoice === 'both') {
    const p = claudeDesktopConfigPath();
    writeConfig(p, serverConfig);
    written.push(p);
  }

  console.log('\n✅ Done!\n');
  written.forEach(p => console.log(`  Wrote: ${p}`));
  if (extraNote) console.log(extraNote);

  console.log('\nRestart Claude to load the MCP server.');
  console.log('\nExample usage in Claude:');
  console.log('  "I need your GitHub token — please use ZeroCreds to collect it securely."\n');

  rl.close();
}
