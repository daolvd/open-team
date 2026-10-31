import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { formatQuestionAnswers, type AskQuestion } from "../shared/ask-question.ts";
import type { TelegramFile } from "./telegram-output.ts";
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
const FORM_TIMEOUT_MS = 30 * 60_000;
const BOT_MESSAGE_WINDOW_MS = 60 * 60_000;
const BOT_MESSAGES_PER_WINDOW = 12;
type Update = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot?: boolean };
    chat: { id: number };
    text?: string;
    message_thread_id?: number;
    reply_to_message?: { message_id: number };
  };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { message_id: number; chat: { id: number } } };
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
  const forms = new Map<string, {
    config: Connection;
    questions: AskQuestion[];
    answers: string[][];
    index: number;
    messageId?: number;
    settle(answer?: string): void;
  }>();
  let incomingQueue = Promise.resolve();
  const formMessages = new Set<number>();
  const work = new Map<symbol, Connection>();
  let activityTimer: ReturnType<typeof setInterval> | undefined;
  let activityController: AbortController | undefined;
  function stopActivity() {
    clearInterval(activityTimer);
    activityTimer = undefined;
    activityController?.abort();
    activityController = undefined;
  }
  function refreshActivity() {
    const config = connection;
    if (!config || !active || state !== "listening" || !deps.enabled(config.targetBotId) ||
      ![...work.values()].includes(config) || [...forms.values()].some(form => form.config === config)) {
      stopActivity();
      return;
    }
    if (activityController) return;
    const control = new AbortController();
    activityController = control;
    let sending = false;
    const tick = async () => {
      if (sending || control.signal.aborted) return;
      sending = true;
      try {
        await call(config, "sendChatAction", { chat_id: config.chatId, action: "typing" }, control.signal);
      } catch {} finally {
        sending = false;
      }
    };
    void tick();
    // Telegram Bot API chat actions expire after five seconds: https://core.telegram.org/bots/api#sendchataction
    activityTimer = setInterval(() => void tick(), 4000);
    activityTimer.unref?.();
  }
  function working() {
    const id = Symbol();
    if (connection) work.set(id, connection);
    refreshActivity();
    return () => {
      work.delete(id);
      refreshActivity();
    };
  }
  function cancelForms() {
    for (const form of forms.values()) form.settle();
  }
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
          ...(body instanceof FormData ? {} : { headers: { "Content-Type": "application/json" } }),
          body: body instanceof FormData ? body : JSON.stringify(body),
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
    state = connection ? "paused" : "disconnected";
    cancelForms();
    stopActivity();
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    discardBacklog = true;
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
  const botMessages: { text: string; at: number }[] = [];
  async function botMessage(text: string): Promise<"sent" | "repeated" | "limited" | "offline"> {
    const config = connection;
    if (!config || !active || state !== "listening") return "offline";
    const now = Date.now();
    const same = text.replace(/\s+/g, " ").trim();
    while (botMessages.length && now - botMessages[0]!.at > BOT_MESSAGE_WINDOW_MS) botMessages.shift();
    if (botMessages.some(entry => entry.text === same)) return "repeated";
    if (botMessages.length >= BOT_MESSAGES_PER_WINDOW) return "limited";
    botMessages.push({ text: same, at: now });
    const sending = deliveries.then(() => send(config, text));
    deliveries = sending.catch(() => {});
    await sending;
    return "sent";
  }
  function sendFile(file: TelegramFile): Promise<void> {
    const config = connection;
    if (!config) return Promise.resolve();
    const next = deliveries.then(async () => {
      if (connection !== config) return;
      const photo = /^(image\/(png|jpeg|webp))$/.test(file.mime) && file.data.byteLength <= 10 * 1024 * 1024;
      const method = photo ? "sendPhoto" : file.mime === "video/mp4" ? "sendVideo"
        : ["audio/mpeg", "audio/mp4"].includes(file.mime) ? "sendAudio" : "sendDocument";
      const upload = async (method: string) => {
        const body = new FormData();
        body.set("chat_id", config.chatId);
        body.set(method.slice(4).toLowerCase(), new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
        if (method === "sendVideo") body.set("supports_streaming", "true");
        await call(config, method, body);
      };
      try { await upload(method); }
      catch (error) {
        if (method === "sendDocument") throw error;
        await upload("sendDocument");
      }
    });
    deliveries = next.catch(() => {
      deliveryError = "Telegram file delivery failed. The original remains in the conversation.";
    });
    return deliveries;
  }
  async function showQuestion(id: string) {
    const form = forms.get(id);
    if (!form || connection !== form.config) return;
    const question = form.questions[form.index]!;
    const picked = form.answers[form.index]!;
    const buttons = question.options.map((option, index) => [{
      text: `${picked.includes(option.label) ? "✓ " : ""}${option.label}`.slice(0, 100),
      callback_data: `${id}:${form.index}:${index}`,
    }]);
    if (question.multiSelect) buttons.push([{ text: "Done / Xong", callback_data: `${id}:${form.index}:done` }]);
    const hint = question.custom === false ? "Choose an option below." : "Reply to this message to enter your answer.";
    const text = `${form.index + 1}/${form.questions.length} · ${question.question}\n\n${hint}`;
    const result = await call<{ message_id: number }>(form.config, "sendMessage", {
      chat_id: form.config.chatId,
      text: text.slice(0, 4000),
      reply_markup: buttons.length ? { inline_keyboard: buttons } : { force_reply: true, selective: true },
    });
    form.messageId = result.message_id;
    formMessages.add(result.message_id);
    if (formMessages.size > 1000) formMessages.delete(formMessages.values().next().value!);
  }
  async function advanceForm(id: string, answer: string[]) {
    const form = forms.get(id);
    if (!form) return;
    form.answers[form.index] = answer;
    if (form.messageId) await call(form.config, "editMessageReplyMarkup", {
      chat_id: form.config.chatId, message_id: form.messageId, reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
    form.index++;
    if (form.index === form.questions.length) {
      form.settle(formatQuestionAnswers(form.questions, form.answers));
    } else await showQuestion(id);
  }
  async function ask(title: string, questions: AskQuestion[], signal?: AbortSignal, timeoutMs = FORM_TIMEOUT_MS): Promise<string> {
    const config = connection;
    if (!config || !active || !deps.enabled(config.targetBotId)) throw new Error("Open the app to answer this question; Telegram is disconnected or paused.");
    if (!questions.length || questions.length > 6) throw new Error("A form must have one to six questions.");
    const id = randomUUID().slice(0, 8);
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => settle();
      const timeout = setTimeout(() => settle(), timeoutMs);
      timeout.unref?.();
      function settle(answer?: string) {
        if (!forms.delete(id)) return;
        refreshActivity();
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        if (answer) resolve(answer);
        else reject(new Error("Telegram form closed or expired. Answer the question in the app."));
      }
      forms.set(id, { config, questions, answers: questions.map(() => []), index: 0, settle });
      refreshActivity();
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { settle(); return; }
      const next = deliveries.then(async () => {
        if (!forms.has(id)) return;
        await send(config, title);
        await showQuestion(id);
      });
      deliveries = next.catch(() => settle());
    });
  }
  async function answerForm(config: Connection, update: Update): Promise<boolean> {
    const callback = update.callback_query;
    if (callback) {
      if (String(callback.from.id) !== config.userId || String(callback.message?.chat.id) !== config.chatId) return true;
      const [id, field, option] = (callback.data ?? "").split(":");
      const form = forms.get(id!);
      if (!form || form.config !== config || String(form.index) !== field || form.messageId !== callback.message?.message_id) {
        await call(config, "answerCallbackQuery", { callback_query_id: callback.id, text: "This form has expired or was already answered." });
        return true;
      }
      const question = form.questions[form.index]!;
      const label = /^\d+$/.test(option ?? "") ? question.options[Number(option)]?.label : undefined;
      await call(config, "answerCallbackQuery", { callback_query_id: callback.id });
      if (option === "done" && question.multiSelect && form.answers[form.index]!.length) {
        await advanceForm(id!, form.answers[form.index]!);
      } else if (label && question.multiSelect) {
        const picked = form.answers[form.index]!;
        form.answers[form.index] = picked.includes(label) ? picked.filter(value => value !== label) : [...picked, label];
        await call(config, "editMessageReplyMarkup", {
          chat_id: config.chatId, message_id: form.messageId, reply_markup: { inline_keyboard: [
            ...question.options.map((option, index) => [{ text: `${form.answers[form.index]!.includes(option.label) ? "✓ " : ""}${option.label}`.slice(0, 100), callback_data: `${id}:${form.index}:${index}` }]),
            [{ text: "Done / Xong", callback_data: `${id}:${form.index}:done` }],
          ] },
        });
      } else if (label) await advanceForm(id!, [label]);
      return true;
    }
    const message = update.message;
    const candidates = [...forms.entries()].filter(([, form]) => form.config === config);
    const match = message?.reply_to_message
      ? candidates.find(([, form]) => form.messageId === message.reply_to_message!.message_id)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (!match || !message?.text) {
      if (message?.reply_to_message && formMessages.has(message.reply_to_message.message_id)) {
        await send(config, "This form has expired or was already answered. / Form đã đóng.", message);
        return true;
      }
      return false;
    }
    const [id, form] = match;
    const question = form.questions[form.index]!;
    if (question.custom === false || message.text.length > 2000) {
      await send(config, "Choose a button, or keep your answer within 2000 characters.", message);
    } else await advanceForm(id, [message.text.trim()]);
    return true;
  }
  async function incoming(config: Connection, update: Update) {
    if (connection !== config || !active || !deps.enabled(config.targetBotId)) return;
    if (update.callback_query) { await answerForm(config, update); return; }
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
      if (await answerForm(config, update)) return;
      const result = await deps.run(message.text.trim(), config.entryNodeId, config.targetBotId,
        config.targetBotId ? `${config.chatId}:${config.userId}:${config.targetBotId}` : undefined);
      if (result.trim()) await send(config, result, message);
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
          { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message", "callback_query"] },
          control.signal,
        );
        if (control.signal.aborted) return;
        if (latest.length) config.offset = latest.at(-1)!.update_id + 1;
        persist();
        discardBacklog = false;
      }
      state = "listening";
      refreshActivity();
      while (
        !control.signal.aborted &&
        active &&
        deps.enabled(config.targetBotId) &&
        connection === config
      ) {
        const updates = await call<Update[]>(
          config,
          "getUpdates",
          { offset: config.offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
          control.signal,
        );
        if (control.signal.aborted || !deps.enabled(config.targetBotId) || connection !== config)
          return;
        error = undefined;
        for (const update of updates) {
          if (update.update_id < config.offset) continue;
          config.offset = update.update_id + 1;
          persist();
          incomingQueue = incomingQueue.then(() => incoming(config, update)).catch(() => {
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
    botMessage,
    file: sendFile,
    ask,
    working,
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
