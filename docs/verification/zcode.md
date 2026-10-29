# Zcode CLI

## Configure

Add **Zcode CLI** in **Settings → Engines**, install `zcode-app-cli`, then run
`zcode login zai` in your own terminal. This integration targets the third-party
[zcode-cli launcher](https://github.com/kingsword09/zcode-cli), qualified with
package version `3.16.3-39` and native runtime `0.17.0`. A custom executable path
and `provider/model` model identifier may be configured on the engine instance.

Headless turns require **Full access**. The driver cannot answer terminal
permission prompts, accept image inputs, switch models within a session, or
stream intermediate tool activity into the transcript. Final text, failures and
interruptions are reported. Sessions resume with the persisted native session ID;
an invalid or mismatched session fails rather than silently starting over.

**Scan CLI skills and MCP** discovers servers from
`~/.zcode/cli/setting.json`, or an absolute `ZCODE_CLI_SETTINGS_FILE` override.
Review and enable imported MCP servers per bot. Claude/Codex skills and custom
skills remain independently assignable; no Zcode skill format is assumed.

Each turn receives a private temporary settings file containing only its selected
MCP servers. Plugins, hooks, native memory and native workflow mode are disabled.
Projects with `zcode.json` or `.zcode/config.json` in their ancestor directories
are refused because the native CLI merges their settings after the supplied
settings file. Import their MCP servers and use a folder without those files.

## Isolated verification

```sh
pnpm exec vitest run server/drivers/zcode.test.ts server/setup-import.test.ts
OMB_ZCODE_NATIVE_E2E=1 OMB_ZCODE_CLI=/absolute/path/to/zcode pnpm exec vitest run server/drivers/zcode.native.test.ts
```

The native fixture owns a temporary home, provider config, credentials path and
session database. Its loopback provider requests `read_notes` from the repository's
fake stdio MCP, then returns scripted text. A second native turn resumes the
same session and retains the first input. No personal sign-in or paid model is
used. This proves the CLI/driver/MCP/session contract, not model intelligence or
external Playwright/browser-use connectivity.

Driver contract tests additionally cover cancellation, private-file cleanup,
output limits, malformed/incomplete results, credential isolation and project
configuration refusal. Live Telegram delivery requires separately configured
Telegram credentials and is not exercised by these fixtures.
