# zerocreds-mcp

MCP server for [ZeroCreds](https://zerocreds.ru) — collect credentials from users without exposing them to the LLM.

## How it works

```
Claude                    ZeroCreds Server            User
  │                            │                        │
  ├─zerocreds_create_session──►│                        │
  │◄─{ token, url }────────────┤                        │
  │                            │                        │
  │  "Please fill: <url>"──────────────────────────────►│
  │                            │◄──── form submit ───────┤
  │                            │  (credentials saved)    │
  │                            │                        │
  ├─zerocreds_check_status─────►│                        │
  │◄─{ status: "done" }────────┤                        │
  │                            │                        │
  │  (proceeds — never saw the credentials)
```

## Setup

```bash
npm install -g zerocreds-mcp
```

Add to `~/.claude/mcp.json` (Claude Code) or Claude Desktop config:

```json
{
  "mcpServers": {
    "zerocreds": {
      "command": "zerocreds-mcp",
      "env": {
        "ZEROCREDS_URL": "https://zerocreds.ru",
        "ZEROCREDS_TOKEN": "your-admin-or-integrator-token",
        "ZEROCREDS_DEFAULT_DESTINATION": "local-dev",
        "ZEROCREDS_TG_BOT_TOKEN": "optional — sends link via Telegram",
        "ZEROCREDS_TG_CHAT_ID": "optional"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZEROCREDS_URL` | no | Server URL (default: `https://zerocreds.ru`) |
| `ZEROCREDS_TOKEN` | yes | Admin or integrator token |
| `ZEROCREDS_DEFAULT_DESTINATION` | no | Default destination name (default: `local-dev`) |
| `ZEROCREDS_TG_BOT_TOKEN` | no | Telegram bot token — auto-sends the link |
| `ZEROCREDS_TG_CHAT_ID` | no | Telegram chat ID |

## Tools

### `zerocreds_create_session`

Creates a one-time form session. Returns `{ token, url, expires_at }`.

Claude shows `url` to the user, then polls `zerocreds_check_status` every 5–10 seconds.

**Parameters:**
- `title` (required) — form heading
- `fields` (required) — array of `{ name, label, type?, placeholder?, required?, level? }`
- `description` — optional subtext
- `destination` — named destination from server config; overrides env default
- `ttl_minutes` — link expiry (default: 30)

**Field types:** `text`, `password`, `email`, `tel`, `number`, `textarea`, `url`

**Field levels** (optional, shown to user as privacy indicator):
`secret` · `pii` · `attribute` · `credential`

### `zerocreds_check_status`

Polls session status. Returns `{ status: "pending" | "done" | "expired" }`.

## Example agent flow

```
User: "Log me into GitHub"

Claude: [zerocreds_create_session]
  title: "Connect GitHub"
  fields: [
    { name: "token", label: "Personal Access Token", type: "password" }
  ]
→ { token: "abc123", url: "https://zerocreds.ru/f/abc123" }

Claude: "Please fill in your token here: https://zerocreds.ru/f/abc123"

[polls zerocreds_check_status every 5s]
→ { status: "done" }

Claude: "GitHub connected! Proceeding..."
[reads token from secret store via configured destination]
```

## Self-hosting

See [zerocreds-server](https://github.com/Zerocreds-com/zerocreds-server) to run your own instance.

## License

MIT
