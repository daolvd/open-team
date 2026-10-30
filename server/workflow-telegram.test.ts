import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createWorkflowTelegram } from "./workflow-telegram.ts";

const cleanup: (() => void)[] = [];
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "omb-telegram-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const updates: unknown[] = [];
  const sent: Record<string, unknown>[] = [];
  const offsets: number[] = [];
  const uploads: { method: string; body: FormData }[] = [];
  const actions: { method: string; body: Record<string, unknown> }[] = [];
  let wake: (() => void) | undefined;
  let enabled = false;
  let reply = "Finished";
  let failure = false;
  let deliveryFails = false;
  let webhookUrl = "";
  let activityFails = false;
  const calls: { input: string; entry: string; bot?: string; conversation?: string }[] = [];
  const bridge = createWorkflowTelegram({
    dataDir: dir,
    enabled: () => enabled,
    validEntry: (id) => id === "step-b",
    validBot: (id) => id === "fixture",
    run: async (input, entry, bot, conversation) => {
      calls.push({ input, entry, ...(bot ? { bot, conversation } : {}) });
      if (failure) throw new Error("A workflow is already running.");
      return reply;
    },
    fetch: (async (url, options) => {
      const method = String(url).split("/").at(-1);
      if (options?.body instanceof FormData) {
        uploads.push({ method: method!, body: options.body });
        return Response.json({ ok: true, result: {} });
      }
      const body = JSON.parse(String(options?.body));
      if (method === "sendChatAction") {
        actions.push({ method, body });
        if (activityFails) throw new Error("Typing unavailable");
        return Response.json({ ok: true, result: true });
      }
      if (method === "editMessageReplyMarkup" || method === "answerCallbackQuery") {
        actions.push({ method, body });
        return Response.json({ ok: true, result: {} });
      }
      if (method === "getMe")
        return Response.json({ ok: true, result: { username: "fixture_bot" } });
      if (method === "getWebhookInfo")
        return Response.json({ ok: true, result: { url: webhookUrl } });
      if (method === "sendMessage") {
        if (deliveryFails) throw new Error(`Cannot fetch ${url}`);
        sent.push(body);
        return Response.json({ ok: true, result: { message_id: 1000 + sent.length } });
      }
      offsets.push(body.offset);
      if (body.offset === -1) {
        updates.splice(0);
        return Response.json({ ok: true, result: [] });
      }
      if (!updates.length)
        await new Promise<void>((resolve) => {
          wake = resolve;
          options?.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
      return Response.json({ ok: true, result: updates.splice(0) });
    }) as typeof fetch,
  });
  cleanup.push(bridge.stop);
  const push = (id: number, text: string, chat = 123, user = 456) => {
    updates.push({
      update_id: id,
      message: { message_id: id, chat: { id: chat }, from: { id: user }, text },
    });
    wake?.();
  };
  return {
    dir,
    bridge,
    calls,
    sent,
    offsets,
    uploads,
    actions,
    update: (update: unknown) => { updates.push(update); wake?.(); },
    push,
    enable: (value: boolean) => {
      enabled = value;
      bridge.refresh();
    },
    reply: (text: string) => {
      reply = text;
    },
    fail: () => {
      failure = true;
    },
    failDelivery: () => {
      deliveryFails = true;
    },
    webhook: (url: string) => {
      webhookUrl = url;
    },
    failActivity: () => { activityFails = true; },
  };
}
const config = {
  token: "123456:fixture-token",
  chatId: "123",
  userId: "456",
  entryNodeId: "step-b",
};
it("routes direct messages to the chosen fixture bot with a stable conversation identity", async () => {
  const f = fixture();
  await expect(f.bridge.configure({ ...config, targetBotId: "fixture" })).rejects.toThrow();
  await expect(f.bridge.configure({ ...config, entryNodeId: "", targetBotId: "missing" })).rejects.toThrow(/available bot/);
  await f.bridge.configure({ ...config, entryNodeId: "", targetBotId: "fixture" });
  f.bridge.start();
  f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  f.push(1, "Hello fixture");
  await expect.poll(() => f.sent.length).toBe(1);
  f.push(2, "Continue that task");
  await expect.poll(() => f.sent.length).toBe(2);
  expect(f.calls).toEqual([
    { input: "Hello fixture", entry: "", bot: "fixture", conversation: "123:456:fixture" },
    { input: "Continue that task", entry: "", bot: "fixture", conversation: "123:456:fixture" },
  ]);
  expect(f.bridge.status()).toMatchObject({ targetBotId: "fixture", entryNodeId: "" });
});
it("connects privately, waits for enable, routes authorized input and replies to the same Telegram message", async () => {
  const f = fixture();
  await f.bridge.configure(config);
  f.bridge.start();
  expect(f.bridge.status()).toMatchObject({
    connected: true,
    state: "paused",
    username: "fixture_bot",
  });
  expect(JSON.stringify(f.bridge.status())).not.toContain(config.token);
  expect(statSync(join(f.dir, "workflow-telegram.json")).mode & 0o777).toBe(
    0o600,
  );
  f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  f.push(1, "unauthorized chat", 999);
  await expect.poll(() => f.offsets.includes(2)).toBe(true);
  f.push(2, "unauthorized person", 123, 999);
  await expect.poll(() => f.offsets.includes(3)).toBe(true);
  f.push(3, "Build my feature");
  await expect.poll(() => f.sent.length).toBe(1);
  expect(f.calls).toEqual([{ input: "Build my feature", entry: "step-b" }]);
  expect(f.sent[0]).toMatchObject({
    chat_id: "123",
    text: "Finished",
    reply_parameters: { message_id: 3 },
  });
  expect(
    JSON.parse(readFileSync(join(f.dir, "workflow-telegram.json"), "utf8"))
      .offset,
  ).toBe(4);
  f.enable(false);
  f.push(4, "must not run while disabled");
  await Promise.resolve();
  expect(f.calls).toHaveLength(1);
  f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  expect(f.calls).toHaveLength(1);
  f.bridge.disconnect();
  expect(f.bridge.status().connected).toBe(false);
});
it("splits long replies, reports dispatch refusal and rejects invalid entry settings", async () => {
  const f = fixture();
  await expect(
    f.bridge.configure({ ...config, entryNodeId: "missing" }),
  ).rejects.toThrow(/input step/i);
  await f.bridge.configure(config);
  f.bridge.start();
  f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  const report = "X".repeat(3999) + "😀" + "Y".repeat(2000);
  f.reply(report);
  f.push(10, "long report");
  await expect.poll(() => f.sent.length).toBe(2);
  expect(f.sent.map((s) => s.text).join("")).toBe(report);
  expect(f.sent[0]?.text).toBe("X".repeat(3999));
  f.fail();
  f.push(11, "busy");
  await expect.poll(() => f.sent.length).toBe(3);
  expect(f.sent[2]?.text).toContain("Cannot accept this task");
});
it("refuses existing webhooks and retains redacted delivery failures after successful polling", async () => {
  const f = fixture();
  f.webhook("https://example.test/hook");
  await expect(f.bridge.configure(config)).rejects.toThrow(/existing webhook/);
  expect(f.bridge.status().connected).toBe(false);
  f.webhook("");
  await f.bridge.configure(config);
  f.bridge.start();
  f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  f.failDelivery();
  await f.bridge.notify("A retained task result");
  f.push(1, "wrong chat", 999);
  await expect.poll(() => f.offsets.includes(2)).toBe(true);
  expect(f.bridge.status().error).toContain("outputs remain in Tasks");
  expect(JSON.stringify(f.bridge.status())).not.toContain(config.token);
});

it("uploads binary images, videos, audio and documents with their original names", async () => {
  const f = fixture();
  await f.bridge.configure(config);
  for (const [name, mime, method, field] of [
    ["photo.png", "image/png", "sendPhoto", "photo"],
    ["demo.mp4", "video/mp4", "sendVideo", "video"],
    ["voice.mp3", "audio/mpeg", "sendAudio", "audio"],
    ["preview.html", "text/html", "sendDocument", "document"],
  ]) {
    await f.bridge.file({ name: name!, mime: mime!, data: new Uint8Array([0, 255, 12]) });
    const upload = f.uploads.at(-1)!;
    expect(upload.method).toBe(method);
    expect(upload.body.get("chat_id")).toBe("123");
    const file = upload.body.get(field!) as File;
    expect(file.name).toBe(name);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([0, 255, 12]));
  }
});

it("collects a phone form with choices, multi-select and free text without queuing answers as tasks", async () => {
  const f = fixture();
  await f.bridge.configure(config);
  f.bridge.start(); f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  const answer = f.bridge.ask("Project brief", [
    { question: "Platform?", options: [{ label: "Web" }, { label: "Mobile" }], custom: false },
    { question: "Features?", options: [{ label: "Chat" }, { label: "Files" }], multiSelect: true },
    { question: "Deadline?", options: [] },
  ]);
  await expect.poll(() => f.sent.length).toBe(2);
  const first = f.sent[1] as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
  const data = first.reply_markup.inline_keyboard[0]![0]!.callback_data;
  let update = 1;
  const click = (data: string, messageId: number, user = 456) => f.update({ update_id: update++, callback_query: { id: String(update), from: { id: user }, message: { message_id: messageId, chat: { id: 123 } }, data } });
  click(data, 1002, 999);
  click(data, 9999);
  await expect.poll(() => f.actions.length).toBe(1);
  expect(f.sent).toHaveLength(2);
  click(data, 1002);
  click(data, 1002);
  await expect.poll(() => f.sent.length).toBe(3);
  const id = data.split(":")[0];
  click(`${id}:1:0`, 1003);
  click(`${id}:1:1`, 1003);
  click(`${id}:1:done`, 1003);
  await expect.poll(() => f.sent.length).toBe(4);
  expect(f.sent[3]).toMatchObject({ text: expect.stringContaining("Deadline?"), reply_markup: { force_reply: true } });
  f.update({ update_id: update++, message: { message_id: 30, from: { id: 456 }, chat: { id: 123 }, text: "Friday", reply_to_message: { message_id: 1004 } } });
  await expect(answer).resolves.toMatch(/Q: Platform\?\nA: Web[\s\S]*A: Chat, Files[\s\S]*A: Friday/);
  expect(f.calls).toHaveLength(0);
  f.update({ update_id: update++, message: { message_id: 31, from: { id: 456 }, chat: { id: 123 }, text: "old answer", reply_to_message: { message_id: 1004 } } });
  await expect.poll(() => f.sent.length).toBe(5);
  expect(f.calls).toHaveLength(0);
});

it("cancels a waiting form on pause and sends no empty queue acknowledgement", async () => {
  const f = fixture();
  await f.bridge.configure(config);
  f.bridge.start(); f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  f.reply(""); f.push(1, "start");
  await expect.poll(() => f.calls.length).toBe(1);
  expect(f.sent).toHaveLength(0);
  const answer = f.bridge.ask("Input", [{ question: "Name?", options: [] }]);
  const rejection = expect(answer).rejects.toThrow(/closed or expired/);
  await expect.poll(() => f.sent.length).toBe(2);
  f.enable(false);
  await rejection;
});

it("keeps typing through overlapping work, pauses for phone input and stops on completion or disconnect", async () => {
  const f = fixture();
  await f.bridge.configure(config);
  f.bridge.start(); f.enable(true);
  await expect.poll(() => f.bridge.status().state).toBe("listening");
  vi.useFakeTimers();
  cleanup.push(() => vi.useRealTimers());
  const typing = () => f.actions.filter(action => action.method === "sendChatAction");
  const finish = f.bridge.working();
  const finishOther = f.bridge.working();
  expect(typing()).toEqual([{ method: "sendChatAction", body: { chat_id: "123", action: "typing" } }]);
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(3);
  finishOther(); finishOther();
  await vi.advanceTimersByTimeAsync(4000);
  expect(typing()).toHaveLength(4);
  const abort = new AbortController();
  const answer = f.bridge.ask("Input", [{ question: "Name?", options: [] }], abort.signal);
  const rejection = expect(answer).rejects.toThrow(/closed or expired/);
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(4);
  abort.abort();
  await rejection;
  expect(typing()).toHaveLength(5);
  finish();
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(5);
  f.failActivity();
  const finishFailed = f.bridge.working();
  await vi.advanceTimersByTimeAsync(4000);
  await f.bridge.notify("Completed despite typing failure");
  expect(f.sent.at(-1)?.text).toBe("Completed despite typing failure");
  expect(f.bridge.status().error).toBeUndefined();
  f.enable(false);
  const pausedCount = typing().length;
  await vi.advanceTimersByTimeAsync(8000);
  expect(typing()).toHaveLength(pausedCount);
  f.bridge.disconnect();
  await vi.advanceTimersByTimeAsync(8000);
  finishFailed();
  expect(typing()).toHaveLength(pausedCount);
});
