import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { assertToolScopeSupported } from "../../shared/tool-scope-support.ts";
import { PROVIDER_CREDENTIAL_ENV, stripWorkspaceCredentialEnv } from "../config.ts";
import type { ModelCatalog, ProviderAdapter, ProviderDriver, RuntimeEvent, RuntimeEventListener } from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { augmentedPath } from "../env-path.ts";
import { execCli, killCliTree, spawnCli } from "../procs.ts";
import { turnStdioMcpServers } from "./turn-mcp.ts";

const configSchema = z.object({ cli: z.string().min(1).default("zcode"), model: z.string().min(1).optional() });
type ZcodeConfig = z.output<typeof configSchema>;
type EventPayload<T = RuntimeEvent> = T extends RuntimeEvent ? Omit<T, "eventId" | "provider" | "providerInstanceId" | "threadId" | "createdAt" | "turnId"> : never;
const models: ModelCatalog = { default: "cli-default", options: [{ id: "cli-default", label: "Zcode CLI default", custom: true }] };
const resultSchema = z.object({
  sessionId: z.string().regex(/^sess_[\w-]+$/),
  response: z.string(),
  projection: z.object({ status: z.literal("idle") }),
});

// zcode-app-cli 3.16.3 merges project MCP and plugin settings after user settings.
// Refuse those projects rather than silently widening the owner's per-bot tool selection.
export function assertZcodeProject(cwd: string): void {
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    if (existsSync(join(folder, "zcode.json")) || existsSync(join(folder, ".zcode", "config.json"))) {
      throw new Error("Zcode project configuration can add tools outside this bot's selection. Use a folder without zcode.json/.zcode/config.json and import its MCP servers in Settings first.");
    }
    if (dirname(folder) === folder) break;
  }
}

export const ZcodeDriver: ProviderDriver<ZcodeConfig> = {
  driverKind: "zcode",
  metadata: { displayName: "Zcode CLI", supportsMultipleInstances: true, access: "custom" },
  models,
  install: {
    command: { darwin: "npm install -g zcode-app-cli", linux: "npm install -g zcode-app-cli", win32: "npm install -g zcode-app-cli" },
    needsNode: true,
    docsUrl: "https://github.com/kingsword09/zcode-cli",
    signInCommand: "zcode login zai",
  },
  decodeConfig: (raw) => configSchema.parse(raw ?? {}),
  defaultConfig: () => configSchema.parse({}),
  async create(input) {
    const { config } = input;
    const listeners = new Set<RuntimeEventListener>();
    const running = new Map<string, { turnId: string; child?: ChildProcess; stopped: boolean; done: Promise<void> }>();
    const env: NodeJS.ProcessEnv = { ...process.env, ...input.environment, PATH: augmentedPath() };
    stripWorkspaceCredentialEnv(env);
    for (const key of PROVIDER_CREDENTIAL_ENV) if (!(key in input.environment)) delete env[key];
    const adapter: ProviderAdapter = {
      provider: "zcode",
      capabilities: {
        sessionModelSwitch: "unsupported", agentsMcp: true, composioMcp: true, browserMcp: true,
        dataMcp: true, highlevelMcp: true, deviceMcp: true, customMcp: true,
        localComputerMcp: true, strictResume: true, engineAdmission: true,
      },
      async sendTurn(turn) {
        if (running.has(turn.threadId)) throw new Error("Zcode is already running this conversation.");
        if ((turn.approvalMode ?? "full") !== "full") throw new Error("Zcode headless turns require Full access. Its terminal permission prompts cannot be answered in this app.");
        if (turn.guestConfined) throw new Error("Zcode does not support confined guest turns.");
        if (turn.images?.length) throw new Error("Zcode image input is not supported by this driver.");
        assertToolScopeSupported("zcode", turn.toolScope);
        const cwd = turn.cwd ?? process.cwd();
        assertZcodeProject(cwd);
        const resume = turn.sessionReset ? undefined : turn.resumeCursor;
        if (resume !== undefined && (typeof resume !== "string" || !/^sess_[\w-]+$/.test(resume))) throw new Error("Invalid Zcode session cursor; start a new conversation.");
        const turnId = newId();
        const emit = (event: EventPayload) => {
          const frame = { ...event, eventId: newEventId(), provider: "zcode", providerInstanceId: input.instanceId, threadId: turn.threadId, turnId, createdAt: new Date().toISOString() } as RuntimeEvent;
          for (const listener of listeners) listener(frame);
        };
        const state = { turnId, child: undefined as ChildProcess | undefined, stopped: false, done: Promise.resolve() };
        running.set(turn.threadId, state);
        state.done = (async () => {
          let scratch: string | undefined;
          try {
            await turn.engineAdmission?.("process");
            if (state.stopped) return;
            scratch = mkdtempSync(join(tmpdir(), "omb-zcode-"));
            const settingsFile = join(scratch, "setting.json");
            const servers = turnStdioMcpServers(turn);
            writeFileSync(settingsFile, JSON.stringify({
              features: { mcp: servers.length > 0, memory: false },
              plugins: { enabled: false }, hooks: { enabled: false },
              mcp: { servers: Object.fromEntries(servers.map(({ name, ...server }) => [name, { type: "stdio", ...server }])) },
            }), { mode: 0o600 });
            const args = ["--prompt", [turn.system, turn.text].filter(Boolean).join("\n\n"), "--cwd", cwd, "--json", "--no-color", "--mode", "yolo", "--workflow-mode", "disabled", "--disallowed-tools", "AskUserQuestion,EnterPlanMode,ExitPlanMode"];
            const model = turn.model ?? config.model;
            if (model && model !== "cli-default") args.push("--model", model);
            if (typeof resume === "string") args.push("--resume", resume);
            emit({ type: "turn.started" });
            const child = state.child = spawnCli(config.cli, args, { cwd, env: { ...env, ZCODE_CLI_SETTINGS_FILE: settingsFile }, stdio: ["pipe", "pipe", "pipe"] }, "bot");
            child.stdin.end();
            let stdout = "";
            let overflow = false;
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk: string) => {
              if (overflow) return;
              stdout += chunk;
              if (Buffer.byteLength(stdout) > 8 * 1024 * 1024) { overflow = true; stdout = ""; void killCliTree(child); }
            });
            child.stderr.resume();
            const code = await new Promise<number | null>((accept, reject) => { child.once("error", reject); child.once("close", accept); });
            if (state.stopped) return;
            if (overflow) throw new Error("Zcode returned too much output.");
            if (code !== 0) throw new Error("Zcode could not finish. Check zcode login zai, the selected model and CLI configuration in an isolated terminal.");
            let result: z.output<typeof resultSchema>;
            try { result = resultSchema.parse(JSON.parse(stdout)); }
            catch { throw new Error("Zcode did not return a completed JSON result. Check the installed CLI version and provider configuration."); }
            if (resume && resume !== result.sessionId) throw new Error("Zcode resumed a different session; the result was refused. Start a new conversation.");
            emit({ type: "session.started", sessionId: result.sessionId, model: model ?? null });
            emit({ type: "item.completed", itemId: newId(), itemType: "assistant_text", text: result.response });
            emit({ type: "turn.completed", ok: true });
          } catch (error) {
            if (!state.stopped) {
              emit({ type: "item.completed", itemType: "assistant_text", text: error instanceof Error ? error.message : "Zcode failed.", synthetic: true });
              emit({ type: "turn.completed", ok: false, stopReason: "error" });
            }
          } finally {
            if (state.stopped) emit({ type: "turn.completed", ok: false, stopReason: "interrupted" });
            if (scratch) rmSync(scratch, { recursive: true, force: true });
            running.delete(turn.threadId);
          }
        })();
        return { turnId };
      },
      async interruptTurn(threadId, turnId) {
        const state = running.get(threadId);
        if (!state || (turnId && state.turnId !== turnId)) return;
        state.stopped = true;
        if (state.child) await killCliTree(state.child);
      },
      respondToRequest: async () => "unavailable",
      hasSession: (threadId) => running.has(threadId),
      enginePid: (threadId) => running.get(threadId)?.child?.pid,
      async stopAll() {
        const states = [...running.entries()];
        await Promise.all(states.map(([threadId]) => adapter.interruptTurn(threadId)));
        await Promise.all(states.map(([, state]) => state.done));
      },
      onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    };
    return {
      instanceId: input.instanceId, driverKind: "zcode", displayName: input.displayName, enabled: input.enabled,
      models: config.model ? { default: config.model, options: [{ id: config.model, label: config.model, custom: true }, ...models.options] } : models,
      adapter,
      snapshot: () => new Promise((accept) => execCli(config.cli, ["--version"], { env, timeout: 8_000, maxBuffer: 64 * 1024 }, (error, stdout) => accept(error
        ? { state: "unavailable", reason: "Zcode CLI not found. Install zcode-app-cli and run zcode login zai." }
        : { state: "available", version: stdout.trim().slice(0, 160) || null }))),
      dispose: () => adapter.stopAll(),
    };
  },
};
