import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("returns a Chief's decision to the worker's conditional process through real bot turns", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const planPath = join(dataDir, "room-plan.json");
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(status);
    evidence.push({ method, path, status, result });
    return result;
  };
  const newBot = async (name: string) => (await runControlOmb(["new-bot", "--name", name, "--section", "Engineering", "--url", url]) as any).bot;
  try {
    const chief = await newBot("Chef");
    const worker = await newBot("Decision worker");
    await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
    const answer = "Choose option B: a reversible migration with a rollback checkpoint.";
    writeFileSync(planPath, JSON.stringify({
      [worker.id]: { turns: [
        { reply: "NEEDS_DECISION: migration options A and B have conflicting tradeoffs." },
        { expectContextIncludes: [answer], reply: "Continuing with Chef's decision: option B and a rollback checkpoint." },
      ] },
      [chief.id]: { turns: [{ expectContextIncludes: ["Which migration should we choose?", "NEEDS_DECISION"], reply: answer }] },
    }));
    const path = `/api/bots/${worker.id}/design`;
    expect((await api("GET", path)).consultants).toContainEqual({ id: chief.id, name: "Chef" });
    const design = {
      enabled: true, identity: "Project engineer", method: "Ask Chef when a decision is uncertain.",
      steps: [
        { id: "decide", title: "Assess options", instruction: "Return NEEDS_DECISION when uncertain; otherwise return DECIDED." },
        { id: "ask", title: "Ask Chef", instruction: "Which migration should we choose?", askBotId: chief.id },
        { id: "continue", title: "Continue with decision", instruction: "Use the provided decision and explain the next action." },
      ],
      edges: [
        { from: "decide", to: "ask", contains: "NEEDS_DECISION" },
        { from: "decide", to: "continue", contains: "DECIDED" },
        { from: "ask", to: "continue" },
      ],
    };
    await api("PUT", path, design);
    await api("POST", `${path}/run`, { input: "Decide how to migrate the project." }, 202);
    await expect.poll(async () => (await api("GET", path)).runs[0]?.status, { timeout: 45_000 }).toBe("completed");
    const completed = (await api("GET", path)).runs[0];
    expect(completed.steps.map((step: any) => step.status)).toEqual(["completed", "completed", "completed"]);
    expect(completed.steps.map((step: any) => step.botId)).toEqual([worker.id, chief.id, worker.id]);
    expect(completed.steps[1].output).toBe(answer);
    expect(completed.steps[2].output).toContain("option B");
    expect(new Set(completed.steps.map((step: any) => step.threadId)).size).toBe(3);
    const turns = existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    expect(turns).toHaveLength(3);
    expect(turns.every(turn => !turn.unplanned)).toBe(true);
    evidence.push({ turns });
    await api("PATCH", `/api/bots/${worker.id}`, { peers: [] });
    expect((await api("GET", path)).consultants).toEqual([]);
    await api("PUT", path, design, 400);
  } finally {
    const evidencePath = `${logPath}.bot-process-consultation.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 120_000);
