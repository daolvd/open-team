import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
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
  let wake: (() => void) | undefined;
  let enabled = false;
  let reply = "Finished";
  let failure = false;
  let deliveryFails = false;
  let webhookUrl = "";
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
      const body = JSON.parse(String(options?.body));
      if (method === "getMe")
        return Response.json({ ok: true, result: { username: "fixture_bot" } });
      if (method === "getWebhookInfo")
        return Response.json({ ok: true, result: { url: webhookUrl } });
      if (method === "sendMessage") {
        if (deliveryFails) throw new Error(`Cannot fetch ${url}`);
        sent.push(body);
        return Response.json({ ok: true, result: {} });
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
