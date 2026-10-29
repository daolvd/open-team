import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { json, readBody } from "../harness/http.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import type {
  WorkflowDocument,
  WorkflowRun,
  WorkflowTask,
  WorkflowTelegramStatus,
} from "../../shared/workflow.ts";
import { createWorkflowRoutes } from "./workflows.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
const folders: string[] = [];
const workers: (() => void)[] = [];
afterEach(async () => {
  workers.splice(0).forEach((stop) => stop());
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((done) => server.close(done))),
  );
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true }));
});
const workflow: WorkflowDocument = {
  name: "Review",
  enabled: true,
  leadBotId: "lead",
  nodes: ["a", "b", "c", "d"].map((id, i) => ({
    id,
    botId: id,
    instruction: `Do ${id}`,
    x: i * 250,
    y: 20,
  })),
  edges: [
    { from: "a", to: "c", contains: "GO" },
    { from: "b", to: "d", contains: "NO" },
  ],
};
async function serve(
  run: Parameters<typeof createWorkflowRoutes>[0]["run"],
  auth: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] },
  reuse?: string,
  telegramFetch?: typeof fetch,
) {
  const dataDir = reuse ?? mkdtempSync(join(tmpdir(), "omb-workflows-"));
  if (!reuse) folders.push(dataDir);
  const routes = [
    createWorkflowRoutes({
      dataDir,
      available: (id) => ["lead", "a", "b", "c", "d"].includes(id),
      run,
      telegramFetch,
    }),
  ];
  workers.push(() => routes[0]!.stop());
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (
      !(await dispatchRoutes(routes, {
        req,
        res,
        url,
        path: url.pathname,
        method: req.method!,
        auth,
        json,
        readBody,
      }))
    )
      json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    dataDir,
    routes: routes[0]!,
    get: async () =>
      (await fetch(`${base}/api/workflows`)).json() as Promise<{
        workflow: WorkflowDocument;
        runs: WorkflowRun[];
        tasks: WorkflowTask[];
        telegram: WorkflowTelegramStatus;
      }>,
    tasks: async () =>
      (await fetch(`${base}/api/workflows/tasks`)).json() as Promise<{
        tasks: WorkflowTask[];
      }>,
    save: (body: WorkflowDocument) =>
      fetch(`${base}/api/workflows`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    request: (path: string, method: string, body?: unknown) =>
      fetch(`${base}/api/workflows${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    startWorker: () => routes[0]!.start(),
    stopWorker: () => routes[0]!.stop(),
    start: () =>
      fetch(`${base}/api/workflows/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: "Implement feature" }),
      }),
  };
}
it("persists the graph, runs roots concurrently, routes matching text and produces a lead summary", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const bothRoots = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await serve(async (node, prompt, opened) => {
    calls.push(node.id);
    opened(`thread-${node.id}`);
    expect(prompt).toContain("Implement feature");
    if (node.id === "b") release();
    if (["a", "b"].includes(node.id)) await bothRoots;
    if (node.id === "c") expect(prompt).toContain('"result":"GO"');
    return node.id === "summary" ? "Team finished" : "GO";
  });
  expect((await app.save(workflow)).status).toBe(200);
  expect((await app.start()).status).toBe(202);
  await expect
    .poll(async () => (await app.get()).runs[0]?.status)
    .toBe("completed");
  const { runs } = await app.get();
  expect(calls).toEqual(["a", "b", "c", "summary"]);
  expect(runs[0]?.steps.d).toEqual({ status: "skipped" });
  expect(runs[0]?.steps.c).toMatchObject({
    status: "completed",
    threadId: "thread-c",
  });
  expect(runs[0]?.summary).toBe("Team finished");
  const restarted = await serve(
    async () => {
      throw new Error("must not replay");
    },
    undefined,
    app.dataDir,
  );
  expect((await restarted.get()).runs).toEqual(runs);
});

it("runs bot-assigned tasks without enabling workflows, validates authority and prevents delegation loops", async () => {
  const app = await serve(async (node, _prompt, opened) => {
    opened(`delegated-${node.botId}`);
    return `Done by ${node.botId}`;
  });
  app.startWorker();
  const caller = { botId: "a", threadId: "initial", canAssign: (id: string) => id === "b" };
  expect(() => app.routes.createBotTask(caller, { title: "No", input: "No", targetBotId: "c" })).toThrow(/reachable teammate/);
  expect(() => app.routes.createBotTask(caller, { title: "No", input: "No", targetBotId: "b", source: "ui" })).toThrow(/Provide/);
  const task = app.routes.createBotTask(caller, { title: "Review", input: "Review the design", targetBotId: "b" });
  expect(task).toMatchObject({ source: "bot", createdByBotId: "a", status: "queued", delegationDepth: 1 });
  expect(app.routes.botTasks("a")).toEqual([task]);
  expect(app.routes.botTasks("c")).toEqual([]);
  expect((await app.get()).runs).toEqual([]);
  await expect.poll(async () => (await app.tasks()).tasks[0]?.status).toBe("completed");
  expect((await app.get()).workflow.enabled).toBe(false);
  const nextCaller = { botId: "b", threadId: "delegated-b", canAssign: () => true };
  expect(() => app.routes.createBotTask(nextCaller, { title: "Loop", input: "Retry", targetBotId: "a" })).toThrow(/ancestor/);
  const child = app.routes.createBotTask(nextCaller, { title: "Test", input: "Test the design", targetBotId: "c" });
  expect(child).toMatchObject({ parentTaskId: task.id, delegationDepth: 2, createdByBotId: "b" });
  await expect.poll(async () => (await app.tasks()).tasks[0]?.status).toBe("completed");
});
it("records failures and skips their dependents without claiming completion", async () => {
  const app = await serve(async (node, prompt, opened) => {
    if (node.id === "a") throw new Error("CLI unavailable");
    if (node.id === "summary") {
      expect(prompt).toContain("CLI unavailable");
      opened("failed-summary");
      return "One step failed";
    }
    return "GO";
  });
  await app.save(workflow);
  await app.start();
  await expect
    .poll(async () => (await app.get()).runs[0]?.status)
    .toBe("failed");
  expect((await app.get()).runs[0]?.steps).toMatchObject({
    a: { status: "failed", error: "CLI unavailable" },
    c: { status: "skipped" },
  });
  expect((await app.get()).runs[0]).toMatchObject({
    summary: "One step failed",
    summaryThreadId: "failed-summary",
  });
});
it("rejects duplicate runs and marks an unfinished run interrupted on restart", async () => {
  let release!: () => void;
  const pending = new Promise<string>((resolve) => {
    release = () => resolve("GO");
  });
  const app = await serve(async () => pending);
  await app.save(workflow);
  await app.start();
  expect((await app.start()).status).toBe(409);
  const recovered = await serve(
    async () => {
      throw new Error("must not replay");
    },
    undefined,
    app.dataDir,
  );
  expect((await recovered.get()).runs[0]?.status).toBe("interrupted");
  expect(
    JSON.parse(readFileSync(join(app.dataDir, "workflows.json"), "utf8"))
      .runs[0].status,
  ).toBe("interrupted");
  release();
  await expect
    .poll(async () => (await app.get()).runs[0]?.status)
    .toBe("completed");
});
it("validates cycles, bot availability and owner scope", async () => {
  const app = await serve(async () => "done");
  expect((await app.start()).status).toBe(409);
  expect(
    (
      await app.save({
        ...workflow,
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      })
    ).status,
  ).toBe(400);
  expect((await app.save({ ...workflow, leadBotId: "missing" })).status).toBe(
    400,
  );
  const service = await serve(async () => "done", {
    kind: "loopback",
    trust: "service",
    scopes: ["client"],
  });
  expect((await service.save(workflow)).status).toBe(403);
  expect((await service.start()).status).toBe(403);
  expect(requiredScope("POST", "/api/workflows/run")).toBe("admin");
});

it("keeps new and migrated workflows disabled until explicitly enabled", async () => {
  let calls = 0;
  const app = await serve(async () => {
    calls++;
    return "done";
  });
  expect((await app.get()).workflow.enabled).toBe(false);
  const legacy = { ...workflow } as Partial<WorkflowDocument>;
  delete legacy.enabled;
  writeFileSync(
    join(app.dataDir, "workflows.json"),
    JSON.stringify({ workflow: legacy, runs: [] }),
  );
  const migrated = await serve(async () => "done", undefined, app.dataDir);
  expect((await migrated.get()).workflow.enabled).toBe(false);
  expect((await migrated.get()).tasks).toEqual([]);
  await app.save({ ...workflow, enabled: false });
  expect((await app.start()).status).toBe(409);
  expect(calls).toBe(0);
  await app.save(workflow);
  expect((await app.start()).status).toBe(202);
  await expect
    .poll(async () => (await app.get()).runs[0]?.status)
    .toBe("completed");
  await app.save({ ...workflow, enabled: false });
  expect((await app.start()).status).toBe(409);
});

it("runs direct tasks in priority order without enabling workflows and retains results", async () => {
  const order: string[] = [];
  const app = await serve(async (_node, prompt, opened) => {
    order.push(prompt);
    opened("task-thread");
    return prompt.includes("fail me")
      ? Promise.reject(new Error("fixture failure"))
      : "Task done";
  });
  await app.save({ ...workflow, enabled: false });
  const add = (title: string, priority: string) =>
    app.request("/tasks", "POST", {
      title,
      input: title,
      priority,
      targetBotId: "a",
    });
  expect((await add("Low task", "low")).status).toBe(201);
  expect((await add("High task", "high")).status).toBe(201);
  expect(order).toEqual([]);
  app.startWorker();
  await expect
    .poll(async () =>
      app
        .tasks()
        .then((v) =>
          v.tasks.every((t: { status: string }) => t.status === "completed"),
        ),
    )
    .toBe(true);
  expect(order).toEqual(["High task", "Low task"]);
  const { tasks } = await app.tasks();
  expect(
    tasks.find((t) => t.title === "High task")!.startedAt,
  ).toBeLessThanOrEqual(tasks.find((t) => t.title === "Low task")!.startedAt!);
  expect(tasks[0]).toMatchObject({
    result: "Task done",
    threadId: "task-thread",
  });
  expect(
    (
      await app.request("/tasks", "POST", {
        title: "missing",
        input: "work",
        targetBotId: "missing",
      })
    ).status,
  ).toBe(400);
  await add("fail me", "normal");
  await expect
    .poll(async () => (await app.tasks()).tasks[0]!.status)
    .toBe("failed");
  const failed = (await app.tasks()).tasks[0]!;
  app.stopWorker();
  expect((await app.request(`/tasks/${failed.id}/retry`, "POST")).status).toBe(
    200,
  );
  expect((await app.request(`/tasks/${failed.id}`, "DELETE")).status).toBe(200);
  app.stopWorker();
});

it("finishes direct tasks but holds workflow work when disabled", async () => {
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  const app = await serve(async (_node, prompt) => {
    calls.push(prompt);
    return calls.length === 1 ? pending : "done";
  });
  app.startWorker();
  await app.save(workflow);
  await app.request("/tasks", "POST", {
    title: "First",
    input: "first",
    targetBotId: "a",
  });
  await app.request("/tasks", "POST", {
    title: "Second",
    input: "second",
  });
  expect((await app.start()).status).toBe(409);
  await app.save({ ...workflow, enabled: false });
  release("first done");
  await expect
    .poll(
      async () =>
        (await app.tasks()).tasks.find((task) => task.title === "First")!
          .status,
    )
    .toBe("completed");
  expect(
    (await app.tasks()).tasks.find((task) => task.title === "Second")!.status,
  ).toBe("queued");
  expect(calls).toEqual(["first"]);
  await app.save(workflow);
  await expect
    .poll(async () =>
      (await app.tasks()).tasks.every((task) => task.status === "completed"),
    )
    .toBe(true);
  expect(calls).toHaveLength(4);
  expect((await app.get()).runs[0]?.status).toBe("completed");
});

it("routes Telegram input from the selected step and sends task receipts, outputs, failures and final summaries", async () => {
  const updates: unknown[] = [];
  const sent: { text: string; chat_id: string }[] = [];
  let wake: (() => void) | undefined;
  const transport = (async (url, options) => {
    const method = String(url).split("/").at(-1);
    const body = JSON.parse(String(options?.body));
    if (method === "getMe")
      return Response.json({ ok: true, result: { username: "fixture_bot" } });
    if (method === "getWebhookInfo")
      return Response.json({ ok: true, result: { url: "" } });
    if (method === "sendMessage") {
      sent.push(body);
      return Response.json({ ok: true, result: {} });
    }
    if (body.offset === -1) return Response.json({ ok: true, result: [] });
    if (!updates.length)
      await new Promise<void>((resolve) => {
        wake = resolve;
        options?.signal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
    return Response.json({ ok: true, result: updates.splice(0) });
  }) as typeof fetch;
  const calls: string[] = [];
  const resumes: Array<string | undefined> = [];
  let fail = false;
  const app = await serve(
    async (node, _prompt, opened, resumeThreadId) => {
      calls.push(node.id);
      resumes.push(resumeThreadId);
      opened(resumeThreadId ?? `thread-${node.id}`);
      if (node.id === "a" && fail) throw new Error("fixture step failed");
      return node.id === "a"
        ? "GO: entry output"
        : node.id === "c"
          ? "downstream output"
          : "lead summary";
    },
    undefined,
    undefined,
    transport,
  );
  app.startWorker();
  await app.save({ ...workflow, enabled: false });
  const configured = await app.request("/telegram", "PUT", {
    token: "123456:fixture-token",
    chatId: "123",
    userId: "456",
    entryNodeId: "a",
  });
  expect(configured.status).toBe(200);
  expect(JSON.stringify(await configured.json())).not.toContain(
    "fixture-token",
  );
  expect((await app.get()).telegram.state).toBe("paused");
  await app.save(workflow);
  await expect
    .poll(async () => (await app.get()).telegram.state)
    .toBe("listening");
  const push = (id: number) => {
    updates.push({
      update_id: id,
      message: {
        message_id: id,
        from: { id: 456 },
        chat: { id: 123 },
        text: `Telegram task ${id}`,
      },
    });
    wake?.();
  };
  push(1);
  await expect
    .poll(async () => (await app.tasks()).tasks[0]?.status)
    .toBe("completed");
  await expect
    .poll(() =>
      sent.some((message) => message.text.startsWith("Workflow completed:")),
    )
    .toBe(true);
  expect(calls).toEqual(["a", "c", "summary"]);
  expect((await app.tasks()).tasks[0]).toMatchObject({
    source: "telegram",
    entryNodeId: "a",
    result: "lead summary",
    threadId: "thread-summary",
  });
  expect(sent.every((message) => message.chat_id === "123")).toBe(true);
  expect(sent.map((message) => message.text).join("\n")).toMatch(
    /Step completed:[\s\S]*GO: entry output[\s\S]*downstream output[\s\S]*lead summary/,
  );
  expect(sent.some(message => /Task queued:|Task started:|Step started:|Workflow started:/.test(message.text))).toBe(false);
  fail = true;
  push(2);
  await expect
    .poll(async () => (await app.tasks()).tasks[0]?.status)
    .toBe("failed");
  await expect
    .poll(() =>
      sent.some((message) => message.text.startsWith("Workflow failed:")),
    )
    .toBe(true);
  const text = sent.map((message) => message.text).join("\n");
  expect(text).toContain("Step failed:");
  expect(text).toContain("fixture step failed");
  expect(text).toContain("Step skipped:");
  await app.request("/tasks", "POST", {
    title: "App task",
    input: "work",
    targetBotId: "b",
  });
  await expect
    .poll(() =>
      sent.some((message) =>
        message.text.startsWith("Task completed: App task"),
      ),
    )
    .toBe(true);
  await app.save({ ...workflow, enabled: false });
  await app.request("/tasks", "POST", { title: "Paused workflow", input: "wait for enable", priority: "high" });
  await app.save({ name: "Empty paused workflow", enabled: false, leadBotId: "", nodes: [], edges: [] });
  expect((await app.request("/telegram", "PUT", {
    entryNodeId: "",
    targetBotId: "b",
    chatId: "123",
    userId: "456",
  })).status).toBe(200);
  await expect.poll(async () => (await app.get()).telegram.state).toBe("listening");
  const runCount = (await app.get()).runs.length;
  for (const id of [3, 4]) {
    push(id);
    await expect.poll(async () => {
      const task = (await app.tasks()).tasks[0];
      return task?.input === `Telegram task ${id}` && task.status === "completed";
    }).toBe(true);
  }
  const directTasks = (await app.tasks()).tasks.filter(task => task.source === "telegram" && task.targetBotId === "b").slice(0, 2);
  expect(calls.slice(-2)).toEqual([directTasks[1].id, directTasks[0].id]);
  expect(resumes.slice(-2)).toEqual([undefined, directTasks[1].threadId]);
  expect((await app.tasks()).tasks[0]).toMatchObject({
    source: "telegram", targetBotId: "b", threadId: directTasks[1].threadId,
    conversationKey: "123:456:b",
  });
  expect((await app.get()).runs).toHaveLength(runCount);
  expect((await app.get()).workflow.enabled).toBe(false);
  expect((await app.tasks()).tasks.find(task => task.title === "Paused workflow")?.status).toBe("queued");
  await expect.poll(() => sent.filter(message => message.text === "lead summary").length).toBe(2);
  app.stopWorker();
  expect((await app.get()).telegram.state).toBe("paused");
  app.startWorker();
  await expect.poll(async () => (await app.get()).telegram.state).toBe("listening");
  await app.request("/telegram", "DELETE");
  expect((await app.get()).telegram.connected).toBe(false);
});
