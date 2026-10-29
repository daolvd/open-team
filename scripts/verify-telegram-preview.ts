import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { telegramHtmlPreview } from "../server/telegram-html-preview.ts";
import { ensureUiBrowser } from "./testing/control-omb-ui.ts";

let requests = 0;
const trap = createServer((_req, res) => { requests++; res.end("External resource"); });
try {
  await new Promise<void>(resolve => trap.listen(0, "127.0.0.1", resolve));
  const address = trap.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await ensureUiBrowser();
  const screenshot = await telegramHtmlPreview(browser.chrome, `<!doctype html><html><head>
    <style>body{font:20px system-ui;padding:40px;background:#f6f7fa;color:#243047}input{padding:12px}</style>
    </head><body><h1>Project brief</h1><p id="status">Scripts blocked</p>
    <label>Project name <input value="Open Team"></label>
    <img src="${origin}/image"><iframe src="${origin}/frame"></iframe>
    <script>document.querySelector('#status').textContent='EXECUTED';fetch('${origin}/script')</script>
    </body></html>`);
  assert.deepEqual(Buffer.from(screenshot).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(requests, 0);
  mkdirSync(".omb-scratch", { recursive: true });
  writeFileSync(".omb-scratch/telegram-html-preview.png", screenshot);
  console.log(JSON.stringify({ ok: true, requests, evidence: ".omb-scratch/telegram-html-preview.png", limitation: "Static sandboxed preview; original HTML and native Telegram forms are delivered separately." }));
} finally {
  trap.closeAllConnections();
  await new Promise<void>(resolve => trap.close(() => resolve()));
}
