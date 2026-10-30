import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("lets a Chief create a project worker and author its process through MCP while the worker retains private memory across threads", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const plans: Record<string, { turns: any[] }> = {};
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const turns = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
    ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    evidence.push({ method, path, body, status: response.status, result });
    return result;
  };
  const cli = async (...args: string[]) => {
    const result = await runControlOmb([...args, "--url", url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  const step = (tool: string, args: unknown) => ({ tool, arguments: args });
  const run = async (bot: any, threadId: string, text: string, plan: any) => {
    const before = turns().length;
    (plans[bot.id] ??= { turns: [] }).turns.push(plan);
    writeFileSync(planPath, JSON.stringify(plans));
    await cli("send", "--bot", bot.id, "--task", threadId, "--text", text);
    await expect.poll(() => turns().length, { timeout: 25_000 }).toBe(before + 1);
    expect((await cli("wait", "--bot", bot.id, "--task", threadId, "--timeout", "25")).status).toBe("settled");
    const turn = turns()[before];
    for (const call of turn.evidence.filter((entry: any) => entry.step)) {
      expect(Boolean(call.response.error || call.response.result?.isError), JSON.stringify(call)).toBe(false);
    }
    evidence.push({ turn });
    return turn;
  };
  try {
    const project = join(dataDir, "fixture-project");
    mkdirSync(project);
    const chief = (await cli("new-bot", "--name", "Chef", "--section", "Engineering")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, approvePeerComms: true });
    await run(chief, chief.activeTaskId, "Create a project worker with its own memory.", {
      steps: [step("create_bot", { name: "Project worker", role: "Engineer", instructions: "Verify project facts and remember durable findings.", cwd: project })],
      reply: "Created project worker.",
    });
    const worker = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.name === "Project worker");
    expect(worker).toMatchObject({ cwd: project, section: "Engineering" });
    const path = `/api/bots/${worker.id}/design`;
    expect((await api("GET", path)).design.enabled).toBe(false);
    const design = {
      identity: "Engineer for the fixture project", method: "Inspect, verify, and save proven project facts with memory_update.",
      steps: [
        { id: "inspect", title: "Inspect project", instruction: "Inspect the project and save a verified fact." },
        { id: "report", title: "Report findings", instruction: "Use the preceding result and durable memory to report." },
      ], edges: [{ from: "inspect", to: "report" }],
    };
    const authored = await run(chief, chief.activeTaskId, "Read and configure the worker process; leave it disabled.", {
      steps: [step("get_bot_process", { bot_id: worker.id }), step("set_bot_process", { bot_id: worker.id, design })],
      reply: "Saved the worker process for review in Design bot.",
    });
    const response = JSON.parse(authored.evidence.find((entry: any) => entry.step?.tool === "set_bot_process").response.result.content[0].text);
    expect(response).toMatchObject({ projectFolder: project, memory: { enabled: true, index: join(dataDir, "workspaces", worker.id, "MEMORY.md") } });
    const saved = await api("GET", path);
    expect(saved).toMatchObject({ design: { ...design, enabled: false }, runs: [] });
    await api("POST", `${path}/run`, { input: "Inspect fixture project" }, 409);

    const fact = "Fixture project uses the harbor-lime release channel.";
    plans[worker.id] = { turns: [
      { steps: [step("memory_update", { action: "append", text: fact })], writeFiles: { "cwd-proof.txt": "Written by the project worker." }, reply: "Verified and remembered the release channel." },
      { expectContextIncludes: [fact], reply: "Report: harbor-lime verified." },
    ] };
    writeFileSync(planPath, JSON.stringify(plans));
    await api("PUT", path, { ...saved.design, enabled: true });
    await api("POST", `${path}/run`, { input: "Inspect fixture project" }, 202);
    await expect.poll(async () => (await api("GET", path)).runs[0]?.status, { timeout: 35_000 }).toBe("completed");
    const completed = (await api("GET", path)).runs[0];
    expect(completed.steps.map((entry: any) => entry.status)).toEqual(["completed", "completed"]);
    expect(new Set(completed.steps.map((entry: any) => entry.threadId)).size).toBe(2);
    expect(readFileSync(join(project, "cwd-proof.txt"), "utf8")).toBe("Written by the project worker.");
    const memory = await api("GET", `/api/bots/${worker.id}/memory/file?path=MEMORY.md`);
    expect(memory.text).toContain(fact);
    const next = (await api("POST", `/api/bots/${worker.id}/tasks`, { title: "Recall in a fresh project thread" }, 201)).task;
    const recalled = await run(worker, next.threadId, "Recall the project release channel.", {
      expectContextIncludes: [fact], reply: "The release channel is harbor-lime.",
    });
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8"));
    expect(realpathSync(dump.cwd)).toBe(realpathSync(project));
    expect(`${recalled.system}\n${JSON.stringify(recalled.prompt)}`).toContain(fact);
    evidence.push({ receipt: { cwd: dump.cwd, memoryIndex: response.memory.index } });
    const chiefRecall = await run(chief, chief.activeTaskId, "Inspect the worker process again.", {
      steps: [step("get_bot_process", { bot_id: worker.id })], reply: "The worker process is enabled.",
    });
    expect(`${chiefRecall.system}\n${JSON.stringify(chiefRecall.prompt)}`).not.toContain(fact);
    for (const turn of turns()) {
      expect(turn.unplanned).not.toBe(true);
      for (const call of turn.evidence.filter((entry: any) => entry.step)) expect(Boolean(call.response.error || call.response.result?.isError)).toBe(false);
    }
  } finally {
    const evidencePath = `${logPath}.bot-process-authoring.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 120_000);
