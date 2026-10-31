import { app, BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const output = process.env.OMB_VERIFY_CUA_OUTPUT;
if (!output) throw new Error("Set an explicit disposable OMB_VERIFY_CUA_OUTPUT.");
mkdirSync(output, { recursive: true });
app.setAppPath(resolve(import.meta.dirname, ".."));
app.setPath("userData", resolve(output, "profile"));
app.setPath("home", resolve(output));
process.env.OPENMAUSBOT_CUA_EMBEDDED = "1";
const report = { calls: [] };
const save = () => writeFileSync(join(output, "cua-input.json"), JSON.stringify(report, null, 2));
const pending = new Map();
let proxy, window, cua;
let nextId = 0;
const timeout = setTimeout(() => { report.error = "Acceptance watchdog expired"; save(); app.exit(1); }, 90_000);
async function run() {
try {
  await app.whenReady();
  app.setAccessibilitySupportEnabled(true);
  window = new BrowserWindow({ width: 800, height: 600, x: 80, y: 80, title: "OpenMausBot disposable input test", webPreferences: { sandbox: true } });
  await window.loadURL("data:text/html," + encodeURIComponent('<html><body style="font:28px system-ui;padding:40px"><h1>Disposable CUA test</h1><input id="entry" aria-label="Test input" style="font:28px system-ui;width:500px"><button id="go" style="font:28px system-ui;display:block;margin-top:30px" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#entry\').value">Apply</button><p id="result">Ready</p></body></html>'));
  window.show(); window.focus();
  cua = await import("../electron/cua.mjs");
  const connection = await cua.startCua();
  report.connection = { mode: connection.mode, reason: connection.reason };
  save();
  if (connection.mode !== "embedded") throw new Error(`Isolated embedded CUA unavailable: ${connection.reason}`);
  proxy = spawn(connection.mcpCommand, connection.mcpArgs, { env: { ...process.env, ...connection.mcpEnv }, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: proxy.stdout });
  lines.on("line", line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(message.id); if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "isolated-cua-input", version: "1" } });
  proxy.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  report.tools = (await rpc("tools/list", {})).tools;
  save();
  const call = async (name, args) => {
    const result = await rpc("tools/call", { name, arguments: args });
    const record = { name, args, isError: result.isError, structuredContent: result.structuredContent, content: [] };
    for (const part of result.content ?? []) {
      if (part.type === "image") {
        const file = `capture-${report.calls.length}.png`;
        writeFileSync(join(output, file), Buffer.from(part.data, "base64"));
        record.content.push({ type: "image", file });
      } else record.content.push(part);
    }
    report.calls.push(record); save();
    if (result.isError) throw new Error(JSON.stringify(record));
    return result;
  };
  const listed = await call("list_windows", { pid: process.pid });
  console.log(JSON.stringify({ mode: report.connection.mode, windows: listed }));
  if (process.env.OMB_VERIFY_CUA_LIST_ONLY !== "1") {
    const data = listed.structuredContent ?? JSON.parse(listed.content.find(part => part.type === "text").text);
    const wins = Array.isArray(data) ? data : data.windows;
    const target = wins.find(one => (one.title ?? one.window_title ?? "").includes("disposable")) ?? wins[0];
    const address = { pid: process.pid, window_id: target.window_id ?? target.id };
    report.address = address;
    const state = await call("get_window_state", address);
    const snapshot = state.structuredContent ?? JSON.parse(state.content.find(part => part.type === "text").text);
    const input = snapshot.elements?.find(one => /text(field| field)|textfield/i.test(one.role));
    const button = snapshot.elements?.find(one => /button/i.test(one.role) && /Apply/.test(one.label ?? one.title ?? one.name ?? ""));
    if (!input?.element_token || !button?.element_token) throw new Error("Target controls missing from CUA accessibility snapshot");
    await call("click", { ...address, element_token: input.element_token });
    await call("type_text", { ...address, element_token: input.element_token, text: "CUA-LIVE-VERIFIED" });
    await call("click", { ...address, element_token: button.element_token });
    report.observed = await window.webContents.executeJavaScript("({value:document.querySelector('#entry').value,result:document.querySelector('#result').textContent})");
    await call("get_window_state", address);
    report.verified = report.observed.value === "CUA-LIVE-VERIFIED" && report.observed.result === "CUA-LIVE-VERIFIED";
    if (!report.verified) throw new Error(`Actual input did not reach target: ${JSON.stringify(report.observed)}`);
  }
} catch (error) { report.error = String(error); console.error(report.error); }
finally {
  save(); clearTimeout(timeout); proxy?.kill(); await cua?.stopCua(); window?.destroy(); app.exit(report.error ? 1 : 0);
}
}
void run();
