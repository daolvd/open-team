import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("runs a worker's process on work its Chief delegates: a failed review loops back with feedback, the result returns to the Chief", async () => {
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
  const script = (botId: string, ...planned: any[]) => {
    (plans[botId] ??= { turns: [] }).turns.push(...planned);
    writeFileSync(planPath, JSON.stringify(plans));
  };
  const run = async (bot: any, text: string, plan: any, followups: any[] = []) => {
    const before = turns().length;
    script(bot.id, plan, ...followups);
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", text);
    await expect.poll(() => turns().length, { timeout: 25_000 }).toBeGreaterThan(before);
    expect((await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "25")).status).toBe("settled");
    const turn = turns()[before];
    for (const call of turn.evidence.filter((entry: any) => entry.step))
      expect(Boolean(call.response.error || call.response.result?.isError), JSON.stringify(call)).toBe(false);
    return turn;
  };
  try {
    const chief = (await cli("new-bot", "--name", "Producer", "--section", "Studio")).bot;
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, approvePeerComms: true });
    await run(chief, "Create a UI builder.", {
      steps: [step("create_bot", { name: "UI builder", role: "Builds screens", instructions: "Build screens from a plan." })],
      reply: "Created the UI builder.",
    });
    const worker = (await api("GET", "/api/bots")).bots.find((bot: any) => bot.name === "UI builder");
    const design = {
      enabled: true, autoRun: true,
      identity: "UI builder", method: "Plan, build, check, deliver",
      steps: [
        { id: "plan", title: "Plan", instruction: "Write a short build plan." },
        { id: "build", title: "Build", instruction: "Build the screen from the plan.", effort: "low" },
        { id: "review", title: "Review", instruction: "Check the build.", output: "verdict", criteria: "No overlapping buttons" },
        { id: "deliver", title: "Deliver", instruction: "Write the handover." },
      ],
      edges: [
        { from: "plan", to: "build" }, { from: "build", to: "review" },
        { from: "review", to: "deliver", when: "verdict == PASS" },
        { from: "review", to: "build", when: "verdict == FAIL", loop: { max: 2 } },
      ],
    };
    await run(chief, "Give the builder a checked process that runs on delegated work.", {
      steps: [step("set_bot_process", { bot_id: worker.id, design })],
      reply: "Saved the builder process.",
    });
    expect((await api("GET", `/api/bots/${worker.id}/design`)).design).toMatchObject({ enabled: true, autoRun: true });

    script(worker.id,
      { expectContextIncludes: ["Write a short build plan.", "Build the shop screen"], reply: "Plan: grid of four items, buy button bottom right." },
      { expectContextIncludes: ["Plan: grid of four items"], reply: "Built shop v1." },
      { expectContextIncludes: ["No overlapping buttons", "Built shop v1."], reply: "Buy overlaps close.\n{\"verdict\":\"FAIL\",\"score\":40,\"notes\":\"buy button overlaps the close button\"}" },
      { expectContextIncludes: ["buy button overlaps the close button", "attempt 2"], reply: "Built shop v2 with the buy button moved." },
      { expectContextIncludes: ["Built shop v2"], reply: "{\"verdict\":\"PASS\",\"score\":96}" },
      { expectContextIncludes: ["Write the handover."], reply: "Delivered shop v2: buy button moved, review PASS 96." },
    );
    const before = turns().length;
    await run(chief, "Have the builder build the shop screen.", {
      steps: [step("coordinate_bots", { bot_ids: [worker.id], message: "Build the shop screen." })],
      reply: "Sent the shop screen to the builder.",
    }, [{ expectContextIncludes: ["Delivered shop v2"], reply: "The builder delivered shop v2." }]);
    await expect.poll(() => turns().length, { timeout: 60_000 }).toBeGreaterThanOrEqual(before + 8);
    const runs = (await api("GET", `/api/bots/${worker.id}/design`)).runs;
    expect(runs[0]).toMatchObject({ source: "work", status: "completed", output: "Delivered shop v2: buy button moved, review PASS 96." });
    expect(runs[0].steps.map((entry: any) => [entry.id, entry.status, entry.attempts])).toEqual([
      ["plan", "completed", 1], ["build", "completed", 2], ["review", "completed", 2], ["deliver", "completed", 1],
    ]);
    expect(runs[0].steps.find((entry: any) => entry.id === "review").verdict).toMatchObject({ verdict: "PASS", score: 96 });
    await expect.poll(() => turns().some((turn: any) => turn.botId === chief.id && JSON.stringify(turn.prompt).includes("Delivered shop v2")), { timeout: 30_000 }).toBe(true);
    for (const turn of turns()) {
      expect(turn.unplanned, JSON.stringify(turn).slice(0, 400)).not.toBe(true);
      expect(turn.missingContext ?? [], JSON.stringify(turn).slice(0, 400)).toEqual([]);
    }
  } finally {
    const evidencePath = `${logPath}.bot-process-autorun.json`;
    writeFileSync(evidencePath, JSON.stringify({ evidence, turns: turns() }, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 180_000);

it("runs the Transformer recipe's three reviews on one revision in parallel and holds delivery without owner approval", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const gateFile = join(dataDir, "release-reviews");
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    evidence.push({ method, path, status: response.status, result });
    return result;
  };
  const create = async (name: string) => (await runControlOmb(["new-bot", "--name", name, "--section", "Studio", "--url", url]) as any).bot;
  try {
    const chief = await create("Scope executor");
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    const recipe = JSON.parse(readFileSync(new URL("../docs/process-recipes/transformer-kanban.json", import.meta.url), "utf8"));
    recipe.enabled = true;
    const plans: Record<string, unknown> = {};
    const readyFiles: string[] = [];
    for (const id of ["visual", "interaction", "code"]) {
      const reviewer = await create(`${id} reviewer`);
      const definition = recipe.steps.find((step: any) => step.id === id);
      definition.botId = reviewer.id;
      const readyFile = join(dataDir, `ready-${id}`);
      readyFiles.push(readyFile);
      plans[reviewer.id] = { turns: [{ readyFile, gateFile, expectContextIncludes: ["frozen revision r1"], reply: JSON.stringify({ verdict: "PASS", score: 95, notes: `${id} reviewed r1` }) }] };
    }
    const outputs: Record<string, string> = {
      plan: "Plan: implement only scope A with isolated checks.",
      score: '{"verdict":"PASS","score":95}',
      build: "Build complete: frozen revision r1; focused checks passed.",
      merge: '{"verdict":"PASS","score":95,"notes":"all three reviewed r1"}',
      escalate: "WAITING: required owner approval has not been granted; no delivery.",
    };
    plans[chief.id] = { script: Object.entries(outputs).map(([id, reply]) => ({
      key: id, match: [recipe.steps.find((step: any) => step.id === id).instruction], reply,
      ...(id === "merge" ? { expectContextIncludes: ["visual reviewed r1", "interaction reviewed r1", "code reviewed r1"] } : {}),
    })) };
    writeFileSync(planPath, JSON.stringify(plans));
    await api("PUT", `/api/bots/${chief.id}/design`, recipe);
    await api("POST", `/api/bots/${chief.id}/design/run`, { input: "Build scope A with three independent reviews." });
    await expect.poll(() => readyFiles.every(path => existsSync(path)), { timeout: 40_000 }).toBe(true);
    const beforeJoin = (await api("GET", `/api/bots/${chief.id}/design`)).runs[0];
    expect(beforeJoin.steps.filter((step: any) => ["visual", "interaction", "code"].includes(step.id)).map((step: any) => step.status)).toEqual(["running", "running", "running"]);
    expect(beforeJoin.steps.find((step: any) => step.id === "merge").status).toBe("pending");
    writeFileSync(gateFile, "release");
    let final: any;
    await expect.poll(async () => {
      final = (await api("GET", `/api/bots/${chief.id}/design`)).runs[0];
      return final.status;
    }, { timeout: 40_000, interval: 200 }).toBe("completed");
    expect(final.steps.find((step: any) => step.id === "owner").verdict.verdict).toBe("FAIL");
    expect(final.steps.find((step: any) => step.id === "deliver").status).toBe("skipped");
    expect(final.output).toBe(outputs.escalate);
    const turns = readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(turns).toHaveLength(8);
    for (const turn of turns) {
      expect(turn.unplanned).not.toBe(true);
      expect(turn.missingContext ?? []).toEqual([]);
    }
    evidence.push({ turns });
  } finally {
    writeFileSync(gateFile, "release");
    const evidencePath = `${logPath}.transformer-kanban.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 180_000);
