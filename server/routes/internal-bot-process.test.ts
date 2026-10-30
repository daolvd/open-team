import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { botDesignSchema } from "../../shared/bot-design.ts";
import { botDesignPath } from "../bot-design.ts";
import { json, readBody } from "../harness/http.ts";
import type { BotRecord } from "../store.ts";
import { createBotDesignService } from "./bot-design.ts";
import { createInternalBotProcessRoutes } from "./internal-bot-process.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});
const bot = (id: string, extra: Partial<BotRecord> = {}): BotRecord => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", soul: "", notifications: true, color: "blue", unread: false,
  createdAt: 1, resumeCursors: {}, modelSelection: { instanceId: "claude", model: "sonnet" }, section: "Work", ...extra,
});
const design = { identity: "Researcher", method: "Verify evidence and remember project decisions.", steps: [
  { id: "inspect", title: "Inspect", instruction: "Read project files" },
  { id: "test", title: "Test", instruction: "Check behavior" },
  { id: "report", title: "Report", instruction: "Save durable findings with memory_update and report evidence" },
], edges: [{ from: "inspect", to: "report" }, { from: "test", to: "report", contains: "passed" }] };
async function serve() {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-chief-process-"));
  folders.push(dataDir);
  const state = { caller: bot("chief", { chiefOfStaff: true }), active: true, expireOnRead: false };
  const worker = bot("worker", { cwd: dataDir });
  const bots = [worker, bot("outside", { section: "Private" }), bot("hidden", { hidden: true }), bot("other-owner", { visibility: { people: ["other@example.com"] } })];
  const run = vi.fn(async () => "passed");
  const service = createBotDesignService({ dataDir, consultants: () => [], available: (id) => bots.some((bot) => bot.id === id && !bot.hidden), run, interrupt: async () => {}, activity: () => [], propose: async () => "" });
  const route = createInternalBotProcessRoutes({ dataDir, bot: () => state.caller, bots: () => bots,
    requireActive: () => { if (!state.active) throw Object.assign(new Error("expired"), { status: 401 }); }, designs: service });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    try {
      if (!await dispatchRoutes([route, service.routes], { req, res, url, path: url.pathname, method: req.method!, auth: { kind: "loopback", scopes: ["admin"] }, json,
        readBody: async (req) => { const body = await readBody(req); if (state.expireOnRead) state.active = false; return body; } })) json(res, 404, {});
    } catch (error) { json(res, (error as { status?: number }).status ?? 500, { error: (error as Error).message }); }
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path = "/api/internal/bot-process/worker", method = "GET", body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { state, worker, service, request, run, dataDir };
}

it("saves a Chief's graph in the same state read by Design bot, persists it and keeps memory separate from the project directory", async () => {
  const app = await serve();
  await app.request("/api/bots/worker/design");
  expect(await app.request(undefined, "PUT", { design: { ...design, enabled: true } })).toMatchObject({ status: 200, body: {
    design: { ...design, enabled: false }, projectFolder: app.dataDir,
    memory: { enabled: true, folder: join(app.dataDir, "workspaces", "worker"), index: join(app.dataDir, "workspaces", "worker", "MEMORY.md") },
  } });
  expect(await app.request("/api/bots/worker/design")).toMatchObject({ status: 200, body: { design: { ...design, enabled: false }, runs: [] } });
  expect(JSON.parse(readFileSync(botDesignPath("worker", app.dataDir), "utf8")).design).toEqual(botDesignSchema.parse(design));
  expect(app.run).not.toHaveBeenCalled();
  await app.request("/api/bots/worker/design", "PUT", { ...design, enabled: true });
  expect(await app.request(undefined, "PUT", { design: { ...design, enabled: false, identity: "Updated" } })).toMatchObject({ status: 200, body: { design: { enabled: true, identity: "Updated" } } });
  expect(app.run).not.toHaveBeenCalled();
});

it("refuses non-Chiefs and targets outside the Chief's authority or reach", async () => {
  const app = await serve();
  for (const id of ["outside", "hidden", "other-owner", "missing"]) {
    expect((await app.request(`/api/internal/bot-process/${id}`)).status).toBe(403);
    expect((await app.request(`/api/internal/bot-process/${id}`, "PUT", { design })).status).toBe(403);
  }
  app.state.caller.peers = [];
  expect((await app.request()).status).toBe(403);
  delete app.state.caller.peers;
  app.state.caller.chiefOfStaff = false;
  expect((await app.request()).status).toBe(403);
  expect((await app.request(undefined, "PUT", { design })).status).toBe(403);
});

it("rechecks the turn capability after receiving a write", async () => {
  const app = await serve();
  app.state.expireOnRead = true;
  expect((await app.request(undefined, "PUT", { design })).status).toBe(401);
  expect(app.service.read("worker").design.steps).toHaveLength(0);
});

it("rejects cycles, unknown nodes and duplicate IDs without changing the saved graph", async () => {
  const app = await serve();
  for (const invalid of [
    { ...design, edges: [{ from: "inspect", to: "test" }, { from: "test", to: "inspect" }] },
    { ...design, edges: [{ from: "inspect", to: "missing" }] },
    { ...design, steps: [design.steps[0], design.steps[0]] },
  ]) expect((await app.request(undefined, "PUT", { design: invalid })).status).toBe(400);
  expect(app.service.read("worker").design.steps).toHaveLength(0);
});
