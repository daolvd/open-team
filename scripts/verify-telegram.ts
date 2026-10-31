import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment } from "./control-omb.ts";
import { fixtureApi } from "./testing/preview-fixture.ts";
import { waitForExit } from "../server/testing/cleanup.ts";

const fixture = await launchVerificationServer();
const sent: Array<{ method: string; body: any; messageId: number }> = [];
const updates: unknown[] = [];
let wake: (() => void) | undefined;
let child: ChildProcess | undefined;
let updateId = 0;
const stub = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  const method = req.url!.split("/").at(-1)!;
  const multipart = req.headers["content-type"]?.startsWith("multipart/form-data");
  const body = multipart ? Object.fromEntries(await new Request("http://fixture", {
    method: "POST", headers: { "content-type": req.headers["content-type"]! }, body: bytes,
  }).formData()) : JSON.parse(bytes.toString() || "{}");
  let result: unknown = {};
  if (method === "getMe") result = { username: "isolated_fixture_bot" };
  else if (method === "getWebhookInfo") result = { url: "" };
  else if (method === "getUpdates") {
    if (body.offset !== -1 && !updates.length) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 1000);
      wake = () => { clearTimeout(timer); resolve(); };
    });
    result = body.offset === -1 ? [] : updates.splice(0);
  } else {
    const messageId = 1000 + sent.length;
    sent.push({ method, body, messageId });
    result = { message_id: messageId };
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, result }));
});
const eventually = async <T>(read: () => Promise<T> | T, accept: (value: T) => boolean, label: string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}; see ${fixture.info.logPath}`);
};
const push = (update: object) => { updates.push({ update_id: ++updateId, ...update }); wake?.(); };
try {
  await new Promise<void>(resolve => stub.listen(0, "127.0.0.1", resolve));
  const address = stub.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  await waitForExit(fixture.child, { signal: "SIGTERM" });
  const preload = join(fixture.info.dataDir, "telegram-fixture.mjs");
  writeFileSync(preload, `const nativeFetch=globalThis.fetch;globalThis.fetch=(input,init)=>{const url=String(input);return nativeFetch(url.startsWith('https://api.telegram.org/bot123456:fixture-token/')?${JSON.stringify(origin)}+new URL(url).pathname:input,init)};`);
  const toolsFile = join(fixture.info.dataDir, "scripted-tools.json");
  writeFileSync(toolsFile, JSON.stringify([
    { server: "ogb", name: "ask_user", input: { question: "Which format?", choices: ["HTML", "PDF"] } },
    { server: "ogb", name: "ask_user", input: { question: "Project name?" } },
  ]));
  const attachments = join(fixture.info.dataDir, "attachments");
  mkdirSync(attachments, { recursive: true });
  const artifact = join(attachments, "telegram-proof.txt");
  writeFileSync(artifact, "Phone form completed; original file delivered.");
  const replyFile = join(fixture.info.dataDir, "reply.txt");
  writeFileSync(replyFile, `Form received. [Download result](${artifact})`);
  const env = verificationServerEnvironment({ FAKE_CLAUDE_TOOL_CALLS_FILE: toolsFile, FAKE_CLAUDE_REPLY_FILE: replyFile }, fixture.info.dataDir, Number(new URL(fixture.info.url).port));
  const log = openSync(fixture.info.logPath, "a", 0o600);
  child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, ...verificationServerArgs(env)], { env, stdio: ["ignore", log, log] });
  closeSync(log);
  const api = fixtureApi(fixture.info.url, { headers: { origin: fixture.info.url } });
  await eventually(async () => {
    try { return (await fetch(`${fixture.info.url}/api/health`)).ok; } catch { return false; }
  }, Boolean, "server startup");
  const bots = (await api("GET", "/api/bots")).bots;
  assert.equal(bots.length, 1);
  const bot = bots[0];
  assert.ok(bot);
  await api("PUT", "/api/workflows/telegram", { token: "123456:fixture-token", chatId: "123", userId: "456", targetBotId: bot.id });
  await eventually(() => api("GET", "/api/workflows/telegram"), status => status.state === "listening", "Telegram listening");
  assert.equal((await api("GET", "/api/workflows")).workflow.enabled, false);
  push({ message: { message_id: 1, chat: { id: 123 }, from: { id: 456 }, text: "Create a project using a phone form." } });
  const choice = await eventually(() => sent.find(row => row.method === "sendMessage" && row.body.reply_markup?.inline_keyboard), Boolean, "choice form");
  assert.ok(choice);
  const activity = () => sent.filter(row => row.method === "sendChatAction");
  assert.ok(activity().length > 0, "Task processing sends a typing indicator");
  assert.deepEqual(activity()[0]!.body, { chat_id: "123", action: "typing" });
  const waitingCount = activity().length;
  await new Promise(resolve => setTimeout(resolve, 4200));
  assert.equal(activity().length, waitingCount, "Typing pauses while waiting for a phone answer");
  push({ callback_query: { id: "phone-choice", from: { id: 456 }, message: { message_id: choice.messageId, chat: { id: 123 } }, data: choice.body.reply_markup.inline_keyboard[0][0].callback_data } });
  const text = await eventually(() => sent.find(row => row.method === "sendMessage" && row.body.reply_markup?.force_reply), Boolean, "text form");
  assert.ok(text);
  push({ message: { message_id: 2, chat: { id: 123 }, from: { id: 456 }, text: "Open Team", reply_to_message: { message_id: text.messageId } } });
  const first = (await eventually(() => api("GET", "/api/workflows/tasks"), result => result.tasks[0]?.status === "completed", "completed phone task")).tasks[0];
  assert.match(first.result, /Form received/);
  assert.ok(activity().length > waitingCount, "Typing resumes after phone answers");
  const completedCount = activity().length;
  await new Promise(resolve => setTimeout(resolve, 4200));
  assert.equal(activity().length, completedCount, "Typing stops after task completion");
  const upload = sent.find(row => row.method === "sendDocument");
  assert.ok(upload);
  assert.equal(await (upload.body.document as File).text(), "Phone form completed; original file delivered.");
  assert.equal((await api("GET", "/api/workflows/tasks")).tasks.length, 1);
  const messages = await runControlOmb(["messages", "--url", fixture.info.url, "--thread", first.threadId, "--limit", "30"]);
  const answers = (await api("GET", `/api/threads/${first.threadId}/messages?limit=30`)).messages
    .filter((row: any) => row.card?.answered === "answer").map((row: any) => row.card.answeredText);
  assert.deepEqual(answers, ["HTML", "Open Team"]);
  assert.equal(sent.some(row => /Task queued|Task started/i.test(row.body.text ?? "")), false);
  writeFileSync(toolsFile, "[]");
  writeFileSync(replyFile, "Continuing the same phone conversation.");
  push({ message: { message_id: 3, chat: { id: 123 }, from: { id: 456 }, text: "Continue that project." } });
  const second = (await eventually(() => api("GET", "/api/workflows/tasks"), result => result.tasks.length === 2 && result.tasks[0]?.status === "completed", "continuation task")).tasks[0];
  assert.equal(second.threadId, first.threadId);
  const progress = "Build 12 passed; waiting for your art approval.";
  writeFileSync(toolsFile, JSON.stringify([
    { server: "agents", name: "send_telegram", input: { text: progress } },
    { server: "agents", name: "send_telegram", input: { text: progress } },
  ]));
  writeFileSync(replyFile, "Progress sent.");
  const beforeProgress = sent.length;
  push({ message: { message_id: 4, chat: { id: 123 }, from: { id: 456 }, text: "Send me progress when something changes." } });
  const third = (await eventually(() => api("GET", "/api/workflows/tasks"), result => result.tasks.length === 3 && result.tasks[0]?.status === "completed", "progress task")).tasks[0];
  await eventually(() => sent.slice(beforeProgress).some(row => row.body.text === "Progress sent."), Boolean, "final reply after progress");
  assert.deepEqual(sent.slice(beforeProgress).filter(row => row.method === "sendMessage").map(row => row.body.text), [progress, "Progress sent."]);
  const progressRows = (await api("GET", `/api/threads/${third.threadId}/messages?limit=60`)).messages
    .filter((row: any) => row.tool?.name?.endsWith("send_telegram")).map((row: any) => ({ ok: row.tool.ok, output: row.tool.output }));
  assert.equal(progressRows.length, 2, JSON.stringify(progressRows));
  assert.match(String(progressRows[0].output), /Sent to Telegram/);
  assert.match(String(progressRows[1].output), /same message already went to Telegram/);
  const evidence = { ok: true, url: fixture.info.url, logPath: fixture.info.logPath, first, second, third, progressRows, messages, answers, deliveries: sent.map(row => ({ method: row.method, text: row.body.text, file: row.body.document?.name })) };
  mkdirSync(".omb-scratch", { recursive: true });
  writeFileSync(".omb-scratch/telegram-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: true, logPath: fixture.info.logPath, evidence: ".omb-scratch/telegram-evidence.json", verified: "typing while working, paused during phone input, stopped after completion, native choice and text forms, engine answers, file delivery, quiet queue, direct routing with workflow disabled, same-thread continuation, send_telegram progress with repeat refused" }));
} finally {
  await waitForExit(child, { signal: "SIGTERM" });
  await fixture.close();
  wake?.();
  stub.closeAllConnections();
  await new Promise<void>(resolve => stub.close(() => resolve()));
}
