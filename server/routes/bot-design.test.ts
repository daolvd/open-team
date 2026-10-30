import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  botDesignSchema,
  type BotDesignState,
} from "../../shared/bot-design.ts";
import { json, readBody } from "../harness/http.ts";
import { createBotDesignRoutes } from "./bot-design.ts";
import { dispatchRoutes } from "./table.ts";
import type { Scope } from "../sessions.ts";

const servers: Server[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((done) => server.close(done))),
  );
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});
const design = botDesignSchema.parse({
  enabled: true,
  identity: "UI auditor",
  method: "Inspect actual evidence",
  steps: [
    {
      id: "inspect",
      title: "Inspect",
      instruction: "Inspect the current screen",
    },
    { id: "report", title: "Report", instruction: "Report observed findings" },
  ],
});
type Deps = Parameters<typeof createBotDesignRoutes>[0];
async function serve(
  overrides: Partial<Deps> = {},
  scopes: readonly Scope[] = ["admin"],
  reuse?: string,
) {
  const dataDir = reuse ?? mkdtempSync(join(tmpdir(), "omb-bot-design-"));
  if (!reuse) folders.push(dataDir);
  const route = createBotDesignRoutes({
    dataDir,
    available: (id) => id === "scout",
    run: async () => "done",
    interrupt: async () => {},
    activity: () => [],
    propose: async () => JSON.stringify(design),
    ...overrides,
  });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (
      !(await dispatchRoutes([route], {
        req,
        res,
        url,
        path: url.pathname,
        method: req.method!,
        auth: { kind: "loopback", scopes },
        json,
        readBody,
      }))
    )
      json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/scout/design`;
  const request = (action = "", method = "GET", body?: unknown) =>
    fetch(`${base}${action}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return {
    dataDir,
    request,
    get: async () => (await request()).json() as Promise<BotDesignState>,
  };
}

it("requires an enabled saved process and unique step IDs", async () => {
  const app = await serve();
  expect((await app.request("/run", "POST", { input: "Audit" })).status).toBe(
    409,
  );
  expect(
    (
      await app.request("", "PUT", {
        ...design,
        steps: [design.steps[0], design.steps[0]],
      })
    ).status,
  ).toBe(400);
  const denied = await serve({}, ["client"]);
  expect((await denied.request()).status).toBe(403);
});

it("executes ordered steps in the same thread, passes output, and preserves the run snapshot", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: { prompt: string; thread?: string }[] = [];
  const app = await serve({
    run: async (_bot, prompt, opened, thread) => {
      calls.push({ prompt, thread });
      opened("process-thread");
      if (calls.length === 1) await gate;
      return calls.length === 1 ? "Observed screenshot A" : "Report A";
    },
  });
  await app.request("", "PUT", design);
  expect(
    (await app.request("/run", "POST", { input: "Audit current UI" })).status,
  ).toBe(202);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(
    (await app.request("/run", "POST", { input: "Duplicate" })).status,
  ).toBe(409);
  await app.request("", "PUT", {
    ...design,
    steps: [{ id: "other", title: "Other", instruction: "Changed" }],
  });
  release();
  await vi.waitFor(async () =>
    expect((await app.get()).runs[0]?.status).toBe("completed"),
  );
  expect(calls[1]?.thread).toBe("process-thread");
  expect(calls[1]?.prompt).toContain("Observed screenshot A");
  const run = (await app.get()).runs[0]!;
  expect(run.design.steps.map((step) => step.id)).toEqual([
    "inspect",
    "report",
  ]);
  expect(run.steps.map((step) => step.output)).toEqual([
    "Observed screenshot A",
    "Report A",
  ]);
  const reopened = await serve({}, ["admin"], app.dataDir);
  expect((await reopened.get()).runs[0]).toEqual(run);
});

it("records failure and cancels remaining steps", async () => {
  const run = vi.fn(async () => {
    throw new Error("Browser unavailable");
  });
  const app = await serve({ run });
  await app.request("", "PUT", design);
  await app.request("/run", "POST", { input: "Audit" });
  await vi.waitFor(async () =>
    expect((await app.get()).runs[0]?.status).toBe("failed"),
  );
  expect(run).toHaveBeenCalledTimes(1);
  expect(
    (await app.get()).runs[0]?.steps.map((step) => [step.status, step.error]),
  ).toEqual([
    ["failed", "Browser unavailable"],
    ["cancelled", undefined],
  ]);
});

it("stops only the process thread and does not dispatch the next step", async () => {
  let release!: () => void;
  const gate = new Promise<string>((resolve) => {
    release = () => resolve("late output");
  });
  const interrupt = vi.fn(async () => {
    release();
  });
  const run = vi.fn(
    async (_bot: string, _prompt: string, opened: (id: string) => void) => {
      opened("owned-thread");
      return gate;
    },
  );
  const app = await serve({ run, interrupt });
  await app.request("", "PUT", design);
  await app.request("/run", "POST", { input: "Audit" });
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect((await app.request("/stop", "POST")).status).toBe(200);
  expect(interrupt).toHaveBeenCalledWith("scout", "owned-thread");
  const state = await app.get();
  expect(state.runs[0]?.status).toBe("cancelled");
  expect(
    state.runs[0]?.steps.every((step) => step.status === "cancelled"),
  ).toBe(true);
  expect(run).toHaveBeenCalledTimes(1);
});

it("previews assistant changes without saving or enabling the process", async () => {
  const app = await serve();
  const draft = { ...design, enabled: false };
  const response = await app.request("/propose", "POST", {
    message: "Add a review step",
    design: draft,
  });
  expect(response.status).toBe(200);
  const body = await response.json() as { proposal: { enabled: boolean } };
  expect(body.proposal.enabled).toBe(false);
  expect((await app.get()).design.steps).toEqual([]);
});

const diamond = {
  ...design,
  steps: ["start", "left", "right", "join"].map((id) => ({ id, title: id, instruction: `Execute ${id}` })),
  edges: [
    { from: "start", to: "left" }, { from: "start", to: "right" },
    { from: "left", to: "join" }, { from: "right", to: "join" },
  ],
};

it("runs sibling steps concurrently in separate threads and waits for both outputs at a join", async () => {
  const gates = new Map<string, () => void>();
  const calls: { id: string; prompt: string; thread?: string }[] = [];
  const app = await serve({
    run: async (_bot, prompt, opened, thread) => {
      const id = diamond.steps.find((step) => prompt.includes(step.instruction))!.id;
      calls.push({ id, prompt, thread });
      opened(`thread-${id}`);
      if (id === "left" || id === "right") await new Promise<void>((resolve) => gates.set(id, resolve));
      return `output-${id}`;
    },
  });
  expect((await app.request("", "PUT", diamond)).status).toBe(200);
  await app.request("/run", "POST", { input: "Parallel audit" });
  try {
    await vi.waitFor(() => expect([...gates.keys()].sort()).toEqual(["left", "right"]));
    expect(calls.map((call) => call.id)).toEqual(["start", "left", "right"]);
    gates.get("left")!();
    await vi.waitFor(async () => expect((await app.get()).runs[0]?.steps[1]?.status).toBe("completed"));
    expect(calls).toHaveLength(3);
    gates.get("right")!();
    await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
    expect(calls[3]?.prompt).toContain("output-left");
    expect(calls[3]?.prompt).toContain("output-right");
    expect(calls.every((call) => call.thread === undefined)).toBe(true);
    expect((await app.get()).runs[0]?.steps.map((step) => step.threadId)).toEqual(diamond.steps.map((step) => `thread-${step.id}`));
  } finally {
    gates.forEach((release) => release());
  }
});

it("rejects cycles, missing nodes and duplicate connections", async () => {
  const app = await serve();
  for (const edges of [
    [...diamond.edges, { from: "join", to: "start" }],
    [{ from: "missing", to: "start" }],
    [diamond.edges[0], diamond.edges[0]],
  ]) expect((await app.request("", "PUT", { ...diamond, edges })).status).toBe(400);
});

it("stops all running branches and never dispatches their join", async () => {
  const gates = new Map<string, () => void>();
  const interrupt = vi.fn(async (_bot: string, threadId: string) => { gates.get(threadId)?.(); });
  const run = vi.fn(async (_bot: string, prompt: string, opened: (thread: string) => void) => {
    const id = diamond.steps.find((step) => prompt.includes(step.instruction))!.id;
    opened(id);
    if (id !== "start") await new Promise<void>((resolve) => gates.set(id, resolve));
    return id;
  });
  const app = await serve({ run, interrupt });
  await app.request("", "PUT", diamond);
  await app.request("/run", "POST", { input: "Stop audit" });
  try {
    await vi.waitFor(() => expect(gates.size).toBe(2));
    expect((await app.request("/stop", "POST")).status).toBe(200);
    expect(interrupt.mock.calls.map((call) => call[1]).sort()).toEqual(["left", "right"]);
    expect((await app.get()).runs[0]?.status).toBe("cancelled");
    expect(run).toHaveBeenCalledTimes(3);
  } finally { gates.forEach((release) => release()); }
});

it("skips conditional branches and dependent joins after a failure", async () => {
  const run = vi.fn(async (_bot: string, prompt: string) => {
    if (prompt.includes("Execute right")) throw new Error("Right failed");
    return "ok";
  });
  const app = await serve({ run });
  await app.request("", "PUT", { ...diamond, edges: diamond.edges.map((edge) => edge.to === "left" ? { ...edge, contains: "absent" } : edge) });
  await app.request("/run", "POST", { input: "Conditional audit" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("failed"));
  expect((await app.get()).runs[0]?.steps.map((step) => step.status)).toEqual(["completed", "skipped", "failed", "skipped"]);
  expect(run).toHaveBeenCalledTimes(2);
});
