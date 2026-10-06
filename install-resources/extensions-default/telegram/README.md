# Telegram Bridge for Mocu

Connects one private Telegram chat to saved Mocu agents. Agents can send labeled Telegram messages using the extension's `send_message` tool; the authorized user can reply to that message or use `/reply` and continue the same saved agent. Telegram requests run the selected saved agent through Mocu, so that agent can use its configured model and enabled tools/extensions.

## Build an installable ZIP

From this directory, run:

```powershell
npm run build      # refresh the local SDK copy and create Telegram-Bridge.zip
npm test           # run a JSON-RPC smoke test without needing a Telegram token
```

The build command copies the SDK into `vendor/mocu-sdk` and `vendor/mocu-contracts`, then creates `Telegram-Bridge.zip`. By default, a source checkout reads `install-resources/extension-system/`. To build from the globally installed SDK sources instead, set `MOCU_EXTENSION_SYSTEM_DIR` to Mocu's `<app-data directory>/extension-system` before running the build; the script copies the SDK into this extension before packaging. The ZIP contains the manifest, extension code, and a self-contained copy of the SDK; it does not require downloading the SDK from npm or accessing the global folder after installation.
For example, in PowerShell, after resolving Mocu's app-data directory into `$AppData`:

```powershell
$env:MOCU_EXTENSION_SYSTEM_DIR = Join-Path $AppData "extension-system"
npm run build
```
Run `npm test` for a local JSON-RPC smoke test. It does not use a real Telegram bot or require the bot token.

## Setup

1. Create a dedicated Telegram bot with **@BotFather** and copy its token.
2. Get your numeric Telegram user/chat ID (for example, message **@userinfobot**).
3. Install `Telegram-Bridge.zip` in Mocu using the Extensions page.
4. On the Telegram Bridge extension's Settings card, enter the bot token and your numeric private chat ID. Keep the token secret.
5. In a Mocu chat, run the **Start Telegram bot listener** command (`start_bot`). It verifies the bot and private chat, discards messages left over from when it was offline, and starts long polling. The extension process stays alive while Mocu is open.
6. Open your bot's private chat in Telegram and send `/help`.

The bot does not begin polling automatically. If Mocu or the extension process is closed/restarted, run `start_bot` again. Use `stop_bot` to stop it, `bot_status` to check it, or `list_agents` to list your saved agents.

## Telegram commands

- `/agents` — list saved agents.
- `/ask <exact agent name or id> <message>` — start a conversation or switch agents. Agent names with spaces are supported, e.g. `/ask IT Support Check my VPN settings`.
- `/reply <message>` — send a reply to the agent that most recently messaged the bot.
- `/continue <message>` — continue with the most recently selected agent.
- `/help` — show command help.
- A normal text message is sent to the most recently selected agent. Use Telegram's **Reply** action on a labeled agent message to route directly to that agent.

## Agent → Telegram messages

Enable the **Telegram Bridge** extension for the saved Mocu agent that should message you. Start the bot listener first. The agent can call `send_message` with, for example:

```json
{
  "agentName": "IT Support",
  "message": "Could you confirm whether I should restart the router now?"
}
```

The message is labeled with that exact saved agent's name, and replying to it routes the response back to the same agent. Agents that have the extension enabled can use this command; Mocu only exposes the extension's tools to agents where the user enables them.

## Privacy and behavior

- Only text in the one configured **private** chat is processed. Group messages and other chats are ignored; the private sender ID must match the configured chat ID.
- The bot token is a masked extension setting, never returned by `bot_status`, and must not be shared.
- Agent conversation context is kept in memory (up to 10 recent turns per agent) and cleared when the listener stops or the extension process restarts.
- Messages received while the bot is offline are discarded at startup rather than executed later without the user's awareness.
- The extension uses Telegram long polling; do not configure a webhook for this bot while using the bridge.
- Internet access to `api.telegram.org` is required. Telegram may split long replies into multiple messages.

## Files

- `manifest.json` — Mocu extension manifest, permissions, bot settings and agent-facing commands.
- `index.js` — Telegram Bot API long-poll listener and Mocu-agent routing.
- `vendor/mocu-sdk/` and `vendor/mocu-contracts/` — copied local Mocu SDK/runtime files used by the ZIP.
- `scripts/vendor-sdk.js` and `scripts/build.js` — refresh the vendored SDK and make the installable ZIP.
- `package.json` — build scripts; the extension has no external npm runtime dependencies.