import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";
import type { WorkflowTelegramStatus } from "../shared/workflow.ts";

const settings = z.object({
  token: z
    .string()
    .trim()
    .regex(/^\d+:[A-Za-z0-9_-]+$/, "Enter a BotFather token."),
  chatId: z
    .string()
    .trim()
    .regex(/^-?\d+$/, "Enter a numeric Telegram chat ID."),
  userId: z
    .string()
    .trim()
    .regex(/^\d+$/, "Enter your numeric Telegram user ID."),
  entryNodeId: z.string().default(""),
  targetBotId: z.string().min(1).optional(),
}).refine(value => Boolean(value.entryNodeId) !== Boolean(value.targetBotId));
type Connection = z.infer<typeof settings> & {
  username: string;
  offset: number;
};
type Update = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot?: boolean };
    chat: { id: number };
    text?: string;
    message_thread_id?: number;
  };
};

export function createWorkflowTelegram(deps: {
  dataDir: string;
  enabled(targetBotId?: string): boolean;
  validEntry(id: string): boolean;
  validBot?(id: string): boolean;
  run(input: string, entryNodeId: string, targetBotId?: string, conversationKey?: string): Promise<string>;
  fetch?: typeof fetch;
}) {
  const file = join(deps.dataDir, "workflow-telegram.json");
  let connection: Connection | undefined = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : undefined;
  let active = false;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let state: WorkflowTelegramStatus["state"] = connection
    ? "paused"
    : "disconnected";
  let error: string | undefined;
  let deliveryError: string | undefined;
  let deliveries = Promise.resolve();
  let discardBacklog = true;
  function persist() {
    mkdirSync(deps.dataDir, { recursive: true });
    writeFileAtomic(file, JSON.stringify(connection), { mode: 0o600 });
  }
  async function call<T>(
    config: Connection | z.infer<typeof settings>,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response;
    try {
      response = await (deps.fetch ?? fetch)(
        `https://api.telegram.org/bot${config.token}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
            : AbortSignal.timeout(15000),
        },
      );
    } catch {
      throw new Error(
        "Cannot reach Telegram. Check your connection and bot token.",
      );
    }
    const result = (await response.json()) as { ok: boolean; result: T };
    if (!response.ok || !result.ok)
      throw new Error(
        `Telegram ${method} failed (${response.status}). Check the token, chat access and existing polling connections.`,
      );
    return result.result;
  }
  function status(): WorkflowTelegramStatus {
    return {
      connected: Boolean(connection),
      state,
      ...(connection
        ? {
            username: connection.username,
            chatId: connection.chatId,
            userId: connection.userId,
            entryNodeId: connection.entryNodeId,
            targetBotId: connection.targetBotId,
          }
        : {}),
      ...(deliveryError || error ? { error: deliveryError || error } : {}),
    };
  }
  function pause() {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    discardBacklog = true;
    state = connection ? "paused" : "disconnected";
  }
  async function send(
    config: Connection,
    text: string,
    message?: Update["message"],
  ) {
    // Telegram Bot API sendMessage accepts at most 4096 UTF-16 characters.
    for (let at = 0; at < text.length; ) {
      if (connection !== config) return;
      let end = Math.min(at + 4000, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
      await call(config, "sendMessage", {
        chat_id: config.chatId,
        text: text.slice(at, end),
        ...(message
          ? {
              reply_parameters: {
                message_id: message.message_id,
                allow_sending_without_reply: true,
              },
              ...(message.message_thread_id
                ? { message_thread_id: message.message_thread_id }
                : {}),
            }
          : {}),
      });
      at = end;
    }
  }
  function notify(text: string): Promise<void> {
    const config = connection;
    if (!config || !text.trim()) return Promise.resolve();
    const next = deliveries.then(() => send(config, text));
    deliveries = next.catch(() => {
      deliveryError =
        "Telegram delivery failed. Check the token and chat permissions; outputs remain in Tasks.";
    });
    return deliveries;
  }
  async function incoming(config: Connection, update: Update) {
    const message = update.message;
    if (
      !message?.text?.trim() ||
      message.from?.is_bot ||
      String(message.chat.id) !== config.chatId ||
      String(message.from?.id) !== config.userId
    )
      return;
    if (!deps.enabled(config.targetBotId) || connection !== config || !active) return;
    try {
      const result = await deps.run(message.text.trim(), config.entryNodeId, config.targetBotId,
        config.targetBotId ? `${config.chatId}:${config.userId}:${config.targetBotId}` : undefined);
      await send(config, result || "Task received.", message);
    } catch {
      await send(
        config,
        config.targetBotId
          ? "Cannot accept this task. Check that the selected bot is available."
          : "Cannot accept this task. Check that the workflow is enabled and its input step is available.",
        message,
      );
    }
  }
  async function poll(config: Connection, control: AbortController) {
    try {
      // Discard the backlog on activation so commands sent while disabled never execute later.
      if (discardBacklog) {
        const latest = await call<Update[]>(
          config,
          "getUpdates",
          { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message"] },
          control.signal,
        );
        if (control.signal.aborted) return;
        if (latest.length) config.offset = latest.at(-1)!.update_id + 1;
        persist();
        discardBacklog = false;
      }
      state = "listening";
      while (
        !control.signal.aborted &&
        active &&
        deps.enabled(config.targetBotId) &&
        connection === config
      ) {
        const updates = await call<Update[]>(
          config,
          "getUpdates",
          { offset: config.offset, timeout: 25, allowed_updates: ["message"] },
          control.signal,
        );
        if (control.signal.aborted || !deps.enabled(config.targetBotId) || connection !== config)
          return;
        error = undefined;
        for (const update of updates) {
          if (update.update_id < config.offset) continue;
          config.offset = update.update_id + 1;
          persist();
          void incoming(config, update).catch(() => {
            deliveryError =
              "Telegram reply failed. Check chat access; task results remain in the app.";
          });
        }
      }
    } catch {
      if (control.signal.aborted) return;
      error =
        "Telegram polling failed. Check token, connectivity and whether this bot already has a webhook or another poller.";
      state = "error";
      timer = setTimeout(() => {
        if (controller !== control) return;
        controller = undefined;
        refresh();
      }, 5000);
      timer.unref();
    }
  }
  function refresh() {
    if (!active || !connection || !deps.enabled(connection.targetBotId)) {
      pause();
      return;
    }
    if (controller) return;
    const control = new AbortController();
    controller = control;
    state = "connecting";
    void poll(connection, control);
  }
  return {
    status,
    notify,
    refresh,
    start() {
      active = true;
      refresh();
    },
    stop() {
      active = false;
      pause();
    },
    async configure(input: unknown) {
      const raw = typeof input === "object" && input !== null ? input : {};
      const parsed = settings.safeParse({
        ...raw,
        token: Reflect.get(raw, "token") || connection?.token,
      });
      if (!parsed.success)
        throw new Error(
          "Enter a valid bot token, numeric chat/user IDs and input step.",
        );
      if (parsed.data.targetBotId ? !deps.validBot?.(parsed.data.targetBotId) : !deps.validEntry(parsed.data.entryNodeId))
        throw new Error("Choose an available bot or workflow input step.");
      const me = await call<{ username: string }>(parsed.data, "getMe", {});
      const webhook = await call<{ url: string }>(
        parsed.data,
        "getWebhookInfo",
        {},
      );
      if (webhook.url)
        throw new Error(
          "This Telegram bot has an existing webhook. Remove it or use a dedicated bot before connecting.",
        );
      pause();
      connection = { ...parsed.data, username: me.username, offset: 0 };
      error = undefined;
      deliveryError = undefined;
      persist();
      refresh();
      return status();
    },
    disconnect() {
      pause();
      connection = undefined;
      error = undefined;
      deliveryError = undefined;
      rmSync(file, { force: true });
      state = "disconnected";
      return status();
    },
  };
}
