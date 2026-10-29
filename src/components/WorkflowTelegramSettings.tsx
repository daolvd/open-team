import { useEffect, useState, type FormEvent } from "react";
import type { Bot } from "@/state/store";
import type {
  WorkflowDocument,
  WorkflowTelegramStatus,
} from "../../shared/workflow";

export type WorkflowTelegramConfig = {
  token: string;
  chatId: string;
  userId: string;
  entryNodeId: string;
  targetBotId?: string;
};
const control =
  "mt-2 w-full rounded-lg border border-hairline/60 bg-panel px-3 py-2.5 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";
export function WorkflowTelegramSettings({
  workflow,
  bots,
  status,
  dirty,
  busy,
  onConnect,
  onDisconnect,
}: {
  workflow: WorkflowDocument;
  bots: Bot[];
  status: WorkflowTelegramStatus;
  dirty: boolean;
  busy: boolean;
  onConnect(config: WorkflowTelegramConfig): Promise<boolean>;
  onDisconnect(): void;
}) {
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(status.chatId ?? "");
  const [userId, setUserId] = useState(status.userId ?? "");
  const [entryNodeId, setEntryNodeId] = useState(status.entryNodeId ?? "");
  const [mode, setMode] = useState<"bot" | "workflow">(status.connected && !status.targetBotId ? "workflow" : "bot");
  const [targetBotId, setTargetBotId] = useState(status.targetBotId ?? "");
  useEffect(() => {
    setChatId(status.chatId ?? "");
    setUserId(status.userId ?? "");
    setEntryNodeId(status.entryNodeId ?? "");
    setTargetBotId(status.targetBotId ?? "");
    if (status.connected) setMode(status.targetBotId ? "bot" : "workflow");
  }, [status.chatId, status.userId, status.entryNodeId, status.targetBotId, status.connected]);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (await onConnect({ token, chatId, userId, entryNodeId: mode === "workflow" ? entryNodeId : "",
      ...(mode === "bot" ? { targetBotId } : {}) })) setToken("");
  }
  return (
    <section
      aria-label="Telegram settings"
      className="min-w-0 flex-1 overflow-auto p-6 max-md:p-4"
    >
      <div className="max-w-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Telegram</h2>
          <span
            role="status"
            className={`rounded-md bg-panel px-3 py-1.5 text-xs ${status.state === "error" ? "text-danger" : "text-ink-secondary"}`}
          >
            {status.connected && status.username
              ? `@${status.username} · `
              : ""}
            {status.state}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
          Talk directly to one bot, or run your workflow from a selected step.
          Every message is tracked in Tasks and replies return to this chat.
        </p>
        <div className="my-6 border-l-2 border-accent pl-4 text-sm leading-relaxed text-ink-secondary">
          <p>{mode === "bot" ? "Telegram ↔ selected bot · one continuing conversation" : "Telegram → selected bot step → connected steps → lead summary"}</p>
          <p className="mt-2">
            Task receipt, start, step outputs, skipped steps, failures and final
            results return to this chat, including tasks added in the app. Long
            outputs are split across messages.
          </p>
        </div>
        {status.error && (
          <p role="alert" className="mb-4 text-sm text-danger">
            {status.error}
          </p>
        )}
        <form
          onSubmit={(event) => void connect(event)}
          className="space-y-5 rounded-xl border border-hairline/60 bg-panel p-5"
        >
          <label className="block text-xs text-ink-secondary">
            Bot token
            <input
              type="password"
              aria-label="Bot token"
              autoComplete="new-password"
              required={!status.connected}
              className={control}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={
                status.connected
                  ? "Saved token · leave empty to keep"
                  : "123456:token from BotFather"
              }
            />
            <span className="mt-2 block leading-relaxed">
              Create a dedicated bot with{" "}
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="text-accent-text underline"
              >
                @BotFather
              </a>
              . The token stays on this server and is never returned to the
              browser.
            </span>
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-xs text-ink-secondary">
              Telegram chat ID
              <input
                required
                inputMode="numeric"
                pattern="-?[0-9]+"
                className={control}
                value={chatId}
                onChange={(event) => setChatId(event.target.value)}
                placeholder="123456789 or -100…"
              />
            </label>
            <label className="block text-xs text-ink-secondary">
              Allowed user ID
              <input
                required
                inputMode="numeric"
                pattern="[0-9]+"
                className={control}
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="Your numeric Telegram user ID"
              />
            </label>
          </div>
          <p className="text-xs leading-relaxed text-ink-secondary">
            Use numeric IDs, not @usernames. Only this user in this chat can
            create tasks. Start a conversation with your Telegram bot before
            sending commands.
          </p>
          <label className="block text-xs text-ink-secondary">
            Message routing
            <select className={control} value={mode} onChange={event => setMode(event.target.value as "bot" | "workflow")}>
              <option value="bot">Talk directly to a bot</option>
              <option value="workflow">Run connected workflow steps</option>
            </select>
          </label>
          {mode === "bot" ? <label className="block text-xs text-ink-secondary">
            Telegram bot recipient
            <select aria-label="Telegram bot recipient" required className={control} value={targetBotId} onChange={event => setTargetBotId(event.target.value)}>
              <option value="">Choose a bot</option>
              {bots.filter(bot => !bot.hidden).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
            </select>
            <span className="mt-2 block leading-relaxed">Replies keep the same conversation. This bot can create tasks and assign teammates using its available tools.</span>
          </label> : <label className="block text-xs text-ink-secondary">
            Telegram input step
            <select
              required
              className={control}
              value={entryNodeId}
              onChange={(event) => setEntryNodeId(event.target.value)}
            >
              <option value="">Choose a workflow step</option>
              {workflow.nodes.map((node, index) => (
                <option key={node.id} value={node.id}>
                  {index + 1} ·{" "}
                  {bots.find((bot) => bot.id === node.botId)?.name ??
                    node.botId}{" "}
                  · {node.instruction.slice(0, 65) || "No step instruction"}
                </option>
              ))}
            </select>
          </label>}
          <p className="text-xs leading-relaxed text-ink-secondary">
            {mode === "bot"
              ? "Direct chat uses the bot’s normal instructions and routing. No need to enable the workflow. Keep this app’s server running."
              : dirty
              ? "Save workflow changes before connecting Telegram."
              : !workflow.enabled
                ? "Connected Telegram stays paused until you enable the workflow. Messages sent while disabled are discarded on activation."
                : "Keep this app's server running to receive Telegram commands."}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy || (mode === "workflow" && dirty) || (mode === "bot" ? !targetBotId : !workflow.nodes.length || !entryNodeId)}
              className="rounded-lg bg-accent px-4 py-2.5 text-sm text-white disabled:opacity-50"
            >
              {busy
                ? "Connecting…"
                : status.connected
                  ? "Update connection"
                  : "Connect Telegram"}
            </button>
            {status.connected && (
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border border-hairline/60 px-4 py-2.5 text-sm text-danger disabled:opacity-50"
                onClick={onDisconnect}
              >
                Disconnect Telegram
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
