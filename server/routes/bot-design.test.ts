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
import { createBotDesignRoutes, createBotDesignService } from "./bot-design.ts";
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
    available: (id) => id === "scout" || id === "chief",
    consultants: () => [{ id: "chief", name: "Chef" }],
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

it("interrupts every active fan-out conversation when the process is stopped", async () => {
  const releases = new Map<string, () => void>();
  const interrupt = vi.fn(async (_bot: string, thread: string) => releases.get(thread)?.());
  const app = await serve({ interrupt, run: async (_bot, prompt, opened) => {
    if (prompt.includes("List items")) return '{"verdict":"PASS","items":["a","b","c"]}';
    const thread = `item-${releases.size}`;
    return new Promise<string>(resolve => {
      releases.set(thread, () => resolve("cancelled"));
      opened(thread);
    });
  } });
  await app.request("", "PUT", { ...design, steps: [
    { id: "list", title: "List", instruction: "List items" },
    { id: "item", title: "Item", instruction: "Build item", forEach: true, concurrency: 3 },
  ], edges: [{ from: "list", to: "item" }] });
  await app.request("/run", "POST", { input: "Build screens" });
  await vi.waitFor(() => expect(releases.size).toBe(3));
  expect((await app.request("/stop", "POST")).status).toBe(200);
  expect(interrupt.mock.calls.map(([, thread]) => thread).sort()).toEqual(["item-0", "item-1", "item-2"]);
  expect((await app.get()).runs[0]?.status).toBe("cancelled");
});

it("fails a verdict step with no verdict instead of delivering an unchecked result", async () => {
  const run = vi.fn(async () => "Looks fine");
  const app = await serve({ run });
  await app.request("", "PUT", { ...design, steps: [
    { id: "review", title: "Review", instruction: "Review", output: "verdict" },
    { id: "deliver", title: "Deliver", instruction: "Deliver" },
  ] });
  await app.request("/run", "POST", { input: "Review this" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("failed"));
  expect(run).toHaveBeenCalledTimes(1);
  expect((await app.get()).runs[0]?.steps[0]?.error).toContain("verdict");
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

it("asks a reachable Chief in its own thread and returns its answer to the worker", async () => {
  const calls: { bot: string; prompt: string; thread?: string }[] = [];
  const activity = vi.fn(() => []);
  const app = await serve({ activity, run: async (bot, prompt, opened, thread) => {
    calls.push({ bot, prompt, thread });
    opened(thread ?? `${bot}-${calls.length}`);
    return bot === "chief" ? "Choose option B: reversible migration." : "NEEDS_DECISION";
  } });
  const process = { ...design, steps: [design.steps[0], { id: "ask", title: "Ask Chef", instruction: "Which migration should I use?", askBotId: "chief" }, design.steps[1]] };
  expect((await app.request("", "PUT", process)).status).toBe(200);
  await app.request("/run", "POST", { input: "Migrate the project" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
  expect(calls.map(call => call.bot)).toEqual(["scout", "chief", "scout"]);
  expect(calls[1]?.thread).toBeUndefined();
  expect(calls[1]?.prompt).toContain("Which migration should I use?");
  expect(calls[1]?.prompt).toContain("NEEDS_DECISION");
  expect(calls[1]?.prompt).not.toContain("Who I am: UI auditor");
  expect(calls[2]?.thread).toBe("scout-1");
  expect(calls[2]?.prompt).toContain("Choose option B: reversible migration.");
  const completed = (await app.get()).runs[0]!;
  expect(completed.steps[1]).toMatchObject({ botId: "chief", threadId: "chief-2", output: "Choose option B: reversible migration." });
  expect(activity).toHaveBeenCalledWith("chief", "chief-2");
});

it("rejects self or unreachable consultation targets and rechecks reach before dispatch", async () => {
  let reachable = true;
  const run = vi.fn(async () => "done");
  const app = await serve({ run, consultants: () => reachable ? [{ id: "chief", name: "Chef" }] : [] });
  for (const askBotId of ["scout", "missing"])
    expect((await app.request("", "PUT", { ...design, steps: [{ ...design.steps[0], askBotId }] })).status).toBe(400);
  expect((await app.request("", "PUT", { ...design, steps: [{ ...design.steps[0], askBotId: "chief" }] })).status).toBe(200);
  reachable = false;
  await app.request("/run", "POST", { input: "Consult" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("failed"));
  expect(run).not.toHaveBeenCalled();
  expect((await app.get()).runs[0]?.steps[0]?.error).toMatch(/unavailable|reachable/i);
});

it("stops only the consulted bot's active process conversation", async () => {
  let release = () => {};
  const interrupt = vi.fn(async () => release());
  const run = vi.fn(async (_bot: string, _prompt: string, opened: (id: string) => void) => {
    opened("chief-advice");
    await new Promise<void>(resolve => { release = resolve; });
    return "Advice";
  });
  const app = await serve({ run, interrupt });
  await app.request("", "PUT", { ...design, steps: [{ ...design.steps[0], askBotId: "chief" }, design.steps[1]] });
  await app.request("/run", "POST", { input: "Consult" });
  try {
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect((await app.request("/stop", "POST")).status).toBe(200);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("chief", "chief-advice");
    expect((await app.get()).runs[0]?.status).toBe("cancelled");
    expect(run).toHaveBeenCalledTimes(1);
  } finally { release(); }
});

it("only asks for advice when the uncertainty branch matches", async () => {
  const run = vi.fn(async (_bot: string) => "DECIDED: option A");
  const app = await serve({ run });
  await app.request("", "PUT", { ...design, steps: [design.steps[0], { id: "ask", title: "Ask Chef", instruction: "Help decide", askBotId: "chief" }, design.steps[1]], edges: [
    { from: "inspect", to: "ask", contains: "NEEDS_DECISION" },
    { from: "inspect", to: "report", contains: "DECIDED:" },
    { from: "ask", to: "report" },
  ] });
  await app.request("/run", "POST", { input: "Decide" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
  expect((await app.get()).runs[0]?.steps[1]?.status).toBe("skipped");
  expect(run.mock.calls.map(call => call[0])).toEqual(["scout", "scout"]);
});

const loopDesign = botDesignSchema.parse({
  enabled: true,
  identity: "Builder",
  method: "Plan, build small, review, fix",
  steps: [
    { id: "plan", title: "Plan", instruction: "Write the plan", model: "big-model", effort: "high" },
    { id: "build", title: "Build", instruction: "Build from the plan", model: "small-model", effort: "low" },
    { id: "review", title: "Review", instruction: "Check the build", output: "verdict", criteria: "Tests pass and the screen matches" },
    { id: "deliver", title: "Deliver", instruction: "Write the handover" },
  ],
  edges: [
    { from: "plan", to: "build" }, { from: "build", to: "review" },
    { from: "review", to: "deliver", when: "verdict == PASS" },
    { from: "review", to: "build", when: "verdict == FAIL", loop: { max: 2 } },
  ],
});

it("loops a failed check back with its notes and runs each step on its own model", async () => {
  const calls: { prompt: string; options?: { model?: string; effort?: string; title: string } }[] = [];
  let reviews = 0;
  const app = await serve({ run: async (_bot, prompt, opened, _thread, _signal, options) => {
    calls.push({ prompt, options });
    opened(`thread-${calls.length}`);
    if (prompt.includes("Check the build")) return ++reviews === 1 ? 'Missing\n{"verdict":"FAIL","score":40,"notes":"button overlaps"}' : '{"verdict":"PASS","score":95}';
    return prompt.includes("Write the handover") ? "Handover ready" : "ok";
  } });
  expect((await app.request("", "PUT", loopDesign)).status).toBe(200);
  await app.request("/run", "POST", { input: "Build the shop screen" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
  const builds = calls.filter((call) => call.prompt.includes("Build from the plan"));
  expect(builds).toHaveLength(2);
  expect(builds[0]!.options).toEqual({ title: "Process · Build", model: "small-model", effort: "low" });
  expect(calls[0]!.options).toMatchObject({ model: "big-model", effort: "high" });
  expect(builds[1]!.prompt).toContain("button overlaps");
  expect(builds[1]!.prompt).toContain("attempt 2");
  expect(calls.find((call) => call.prompt.includes("Check the build"))!.prompt).toContain("Tests pass and the screen matches");
  const run = (await app.get()).runs[0]!;
  expect(run.output).toBe("Handover ready");
  expect(run.steps.find((step) => step.id === "review")).toMatchObject({ status: "completed", attempts: 2, verdict: { verdict: "PASS", score: 95 } });
});

it("asks the person to approve over Telegram and applies the default when nobody answers", async () => {
  const gate = botDesignSchema.parse({ ...design, steps: [
    { id: "draft", title: "Draft", instruction: "Draft the art" },
    { id: "approve", title: "Owner approval", instruction: "Approve the art direction?", approval: { timeoutHours: 2, default: "reject" } },
    { id: "ship", title: "Ship", instruction: "Ship the art" },
    { id: "redo", title: "Redo", instruction: "Redo the art" },
  ], edges: [
    { from: "draft", to: "approve" },
    { from: "approve", to: "ship", when: "verdict == PASS" },
    { from: "approve", to: "redo", otherwise: true },
  ] });
  const asked: { title: string; question: string; timeoutMs: number }[] = [];
  let answer: () => Promise<string | undefined> = async () => "Answers:\n\nQ: Approve the art direction?\nA: Approve";
  const run = vi.fn(async (_bot: string, prompt: string) => prompt.includes("Draft the art") ? "draft v1" : "done");
  const app = await serve({ run, askOwner: async (title, question, _signal, timeoutMs) => {
    asked.push({ title, question: question.question, timeoutMs });
    return answer();
  } });
  expect((await app.request("", "PUT", gate)).status).toBe(200);
  const ran = async () => {
    await app.request("/run", "POST", { input: "Cat farm art" });
    await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
    return (await app.get()).runs[0]!.steps.filter((step) => step.status === "completed").map((step) => step.id);
  };
  expect(await ran()).toEqual(["draft", "approve", "ship"]);
  expect(asked[0]).toMatchObject({ question: "Approve the art direction?", timeoutMs: 7_200_000 });
  expect(asked[0]!.title).toContain("draft v1");
  answer = async () => "Answers:\n\nQ: Approve the art direction?\nA: Reject";
  expect(await ran()).toEqual(["draft", "approve", "redo"]);
  answer = async () => { throw new Error("Telegram form closed or expired."); };
  expect(await ran()).toEqual(["draft", "approve", "redo"]);
  expect((await app.get()).runs[0]!.steps[1]!.output).toContain("default decision applied");
  answer = async () => undefined;
  expect(await ran()).toEqual(["draft", "approve", "redo"]);
  expect((await app.get()).runs[0]!.steps[1]!.output).toContain("Telegram is not listening");
});

it("waits out an engine outage and continues the step instead of failing the run", async () => {
  let attempts = 0;
  const prompts: string[] = [];
  const app = await serve({ retryDelaysMs: [0, 0], run: async (_bot, prompt) => {
    prompts.push(prompt);
    if (prompt.includes("Inspect the current screen") && ++attempts < 3)
      throw new Error("unexpected status 502 Bad Gateway: Unable to connect, url: http://127.0.0.1:17841/v1/responses");
    return "ok";
  } });
  await app.request("", "PUT", design);
  await app.request("/run", "POST", { input: "Audit" });
  await vi.waitFor(async () => expect((await app.get()).runs[0]?.status).toBe("completed"));
  expect(attempts).toBe(3);
  expect(prompts[2]).toContain("previous attempt stopped on an engine error");
  const refused = await serve({ retryDelaysMs: [0, 0], run: async () => { throw new Error("401 Unauthorized"); } });
  await refused.request("", "PUT", design);
  await refused.request("/run", "POST", { input: "Audit" });
  await vi.waitFor(async () => expect((await refused.get()).runs[0]?.status).toBe("failed"));
});

it("cancels an engine backoff without retrying or marking the step failed", async () => {
  const run = vi.fn(async () => { throw new Error("502 Bad Gateway"); });
  const app = await serve({ retryDelaysMs: [60_000], run });
  await app.request("", "PUT", design);
  await app.request("/run", "POST", { input: "Audit" });
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  await app.request("/stop", "POST", {});
  await vi.waitFor(async () => {
    const state = (await app.get()).runs[0]!;
    expect(state.status).toBe("cancelled");
    expect(state.endedAt).toBeDefined();
    expect(state.steps.every((step) => step.status === "cancelled")).toBe(true);
  });
  expect(run).toHaveBeenCalledTimes(1);
});

it("runs delegated work through the process only when auto-run is on and its rule matches", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-bot-design-"));
  folders.push(dataDir);
  let matched = true;
  const prompts: string[] = [];
  const service = createBotDesignService({
    dataDir, available: (id) => id === "scout", consultants: () => [], interrupt: async () => {}, activity: () => [],
    propose: async () => "{}",
    judge: async (_bot, prompt) => { prompts.push(prompt); return JSON.stringify({ matched, reason: "rule" }); },
    run: async (_bot, prompt) => prompt.includes("Report observed findings") ? "Final report" : "seen",
  });
  const signal = new AbortController().signal;
  service.save("scout", design);
  expect(await service.runForWork("scout", "Audit the shop", signal)).toBeUndefined();
  service.save("scout", { ...design, autoRun: true, autoRunWhen: "UI audits" });
  expect(await service.runForWork("scout", "Audit the shop", signal)).toEqual({ ok: true, text: "Final report" });
  expect(prompts[0]).toContain("UI audits");
  expect(service.read("scout").runs[0]).toMatchObject({ source: "work", status: "completed", input: "Audit the shop" });
  matched = false;
  expect(await service.runForWork("scout", "Say hello", signal)).toBeUndefined();
  expect(service.read("scout").runs).toHaveLength(1);
});
