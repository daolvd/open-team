import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInstance, RuntimeEvent, SendTurnInput } from "../contracts.ts";
import { ZcodeDriver } from "./zcode.ts";

const roots: string[] = [];
const instances: ProviderInstance[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map(instance => instance.dispose()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function fixture(mode = "ok") {
  const root = mkdtempSync(join(tmpdir(), "omb-zcode-test-"));
  roots.push(root);
  const cli = join(root, "zcode-fixture");
  const dump = join(root, "request.json");
  writeFileSync(cli, `#!${process.execPath}
import {readFileSync,writeFileSync,statSync} from 'node:fs';
const args=process.argv.slice(2);
if(args[0]==='--version'){console.log('fixture-zcode');process.exit(0)}
const file=process.env.ZCODE_CLI_SETTINGS_FILE;
writeFileSync(process.env.FIXTURE_DUMP, JSON.stringify({args,file,settings:JSON.parse(readFileSync(file,'utf8')),mode:statSync(file).mode&511,secret:process.env.ANTHROPIC_API_KEY,owner:process.env.OMB_OPENAI_API_KEY}));
const mode=process.env.FIXTURE_MODE;
if(mode==='hang')setInterval(()=>{},1000);
else if(mode==='overflow')process.stdout.write('x'.repeat(9*1024*1024));
else if(mode==='bad')console.log('not JSON');
else if(mode==='exit')process.exit(3);
else console.log(JSON.stringify({sessionId:mode==='mismatch'?'sess_other':'sess_fixture',response:'Xin chào 🐱',projection:{status:mode==='waiting'?'waiting':'idle'}}));
`, { mode: 0o700 });
  const instance = await ZcodeDriver.create({ instanceId: "zcode-fixture", enabled: true, displayName: "Fixture", environment: {
    HOME: root, USERPROFILE: root, FIXTURE_DUMP: dump, FIXTURE_MODE: mode,
  }, config: ZcodeDriver.decodeConfig({ cli }) });
  instances.push(instance);
  const events: RuntimeEvent[] = [];
  instance.adapter.onEvent(event => events.push(event));
  const send = async (extra: Partial<SendTurnInput> = {}) => {
    const ack = await instance.adapter.sendTurn({ threadId: "thread-zcode", cwd: root, text: "Test", approvalMode: "full", ...extra });
    await expect.poll(() => events.some(event => event.type === "turn.completed" && event.turnId === ack.turnId)).toBe(true);
    await expect.poll(() => instance.adapter.hasSession("thread-zcode")).toBe(false);
    return events.filter(event => event.turnId === ack.turnId);
  };
  return { root, dump, instance, events, send };
}

describe("Zcode headless driver", () => {
  it("passes persona, model, selected MCP and strict resume through private per-turn settings", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-leak");
    vi.stubEnv("OMB_OPENAI_API_KEY", "workspace-only");
    const f = await fixture();
    const events = await f.send({ system: "You are Scout", model: "fixture/model", resumeCursor: "sess_fixture", integrations: {
      agents: { command: "node", args: ["agents.js"], env: { OMB_COMMS_TOKEN: "scoped" } },
      browser: { command: "node", args: ["browser.js"], env: {} },
    } });
    const request = JSON.parse(readFileSync(f.dump, "utf8"));
    expect(request.args).toEqual(expect.arrayContaining(["--prompt", "You are Scout\n\nTest", "--model", "fixture/model", "--resume", "sess_fixture", "--mode", "yolo"]));
    expect(request.settings).toMatchObject({ features: { mcp: true, memory: false }, plugins: { enabled: false }, hooks: { enabled: false }, mcp: { servers: {
      agents: { type: "stdio", command: "node", args: ["agents.js"], env: { OMB_COMMS_TOKEN: "scoped" } }, browser: { type: "stdio" },
    } } });
    expect(request.secret).toBeUndefined();
    expect(request.owner).toBeUndefined();
    if (process.platform !== "win32") expect(request.mode).toBe(0o600);
    expect(existsSync(request.file)).toBe(false);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "session.started", sessionId: "sess_fixture" }),
      expect.objectContaining({ type: "item.completed", text: "Xin chào 🐱" }),
      expect.objectContaining({ type: "turn.completed", ok: true }),
    ]));
    expect(await f.instance.snapshot()).toMatchObject({ state: "available", version: "fixture-zcode" });
  });

  it.each(["bad", "exit", "waiting", "mismatch", "overflow"])("fails closed for %s results", async mode => {
    const f = await fixture(mode);
    const events = await f.send({ resumeCursor: "sess_fixture" });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false });
    expect(events.some(event => event.type === "session.started")).toBe(false);
  });

  it("refuses approval prompts, invalid cursors and project configuration before spawning", async () => {
    const f = await fixture();
    const base = { threadId: "thread-zcode", cwd: f.root, text: "Test" };
    await expect(f.instance.adapter.sendTurn({ ...base, approvalMode: "ask" })).rejects.toThrow(/Full access/);
    await expect(f.instance.adapter.sendTurn({ ...base, resumeCursor: "other-engine" })).rejects.toThrow(/cursor/);
    mkdirSync(join(f.root, "child"));
    writeFileSync(join(f.root, "zcode.json"), "{}");
    await expect(f.instance.adapter.sendTurn({ ...base, cwd: join(f.root, "child") })).rejects.toThrow(/project configuration/);
    expect(existsSync(f.dump)).toBe(false);
  });

  it("interrupts its own child and removes capability-bearing settings", async () => {
    const f = await fixture("hang");
    const ack = await f.instance.adapter.sendTurn({ threadId: "thread-zcode", cwd: f.root, text: "Wait" });
    await expect.poll(() => existsSync(f.dump)).toBe(true);
    await expect(f.instance.adapter.sendTurn({ threadId: "thread-zcode", cwd: f.root, text: "Again" })).rejects.toThrow(/already running/);
    await f.instance.adapter.interruptTurn("thread-zcode", ack.turnId);
    await expect.poll(() => f.instance.adapter.hasSession("thread-zcode")).toBe(false);
    expect(f.events.at(-1)).toMatchObject({ type: "turn.completed", stopReason: "interrupted" });
    expect(existsSync(JSON.parse(readFileSync(f.dump, "utf8")).file)).toBe(false);
  });
});
