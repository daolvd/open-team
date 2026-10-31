import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import type { WorkflowRun } from "../shared/workflow.ts";

it("dispatches bot 2 after an AI condition matches and explains an unmatched branch through real turns", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(status);
    return result;
  };
  const newBot = async (name: string) => (await runControlOmb(["new-bot", "--name", name, "--section", "Engineering", "--url", url]) as any).bot;
  try {
    const lead = await newBot("Routing lead");
    const designer = await newBot("Cat UI designer");
    const input = "vẽ một ui game mèo trending";
    const condition = "khi có những yêu cầu liên quan đến vẽ và design sẽ gửi request tới đây";
    const plan = join(dataDir, "room-plan.json");
    writeFileSync(plan, JSON.stringify({
      [lead.id]: { turns: [
        { reply: "Cần vẽ UI Vườn Mèo, nút Thu hoạch nổi bật." },
        { expectContextIncludes: [input, condition, "Vườn Mèo"], reply: '{"matched":true,"reason":"Yêu cầu vẽ UI game mèo"}' },
        { expectContextIncludes: ["Đã vẽ UI Vườn Mèo", "<connection_decisions>"], reply: "Đã hoàn thành UI game mèo qua hai bot." },
        { reply: "Cần tổng hợp hóa đơn tháng này." },
        { expectContextIncludes: ["hóa đơn", condition], reply: '{"matched":false,"reason":"Yêu cầu kế toán, không liên quan vẽ và design"}' },
        { expectContextIncludes: ["skipped", "Yêu cầu kế toán"], reply: "Đã tổng hợp hóa đơn; bỏ qua bot thiết kế vì không liên quan." },
      ] },
      [designer.id]: { turns: [
        { expectContextIncludes: [input, "Vườn Mèo", "<preceding_results>"], reply: "Đã vẽ UI Vườn Mèo và kiểm tra bố cục." },
      ] },
    }));
    const workflow = {
      name: "Cat design routing", enabled: true, leadBotId: lead.id,
      nodes: [
        { id: "lead", botId: lead.id, instruction: "Hiểu yêu cầu", x: 20, y: 20 },
        { id: "design", botId: designer.id, instruction: "Vẽ UI game mèo", x: 300, y: 20 },
      ],
      edges: [{ from: "lead", to: "design", condition }],
    };
    await api("PUT", "/api/workflows", workflow);
    for (const [task, matched] of [[input, true], ["Tổng hợp hóa đơn tháng này", false]] as const) {
      await api("POST", "/api/workflows/run", { input: task }, 202);
      await expect.poll(async () => (await api("GET", "/api/workflows")).runs[0]?.status, { timeout: 60_000 }).toBe("completed");
      const run = (await api("GET", "/api/workflows")).runs[0] as WorkflowRun;
      expect(run.steps.design?.status).toBe(matched ? "completed" : "skipped");
      expect(run.routing?.[0]).toMatchObject({ from: "lead", to: "design", matched, status: "completed" });
      expect(run.routing?.[0]?.threadId).toBeTruthy();
      expect(run.summary).not.toContain("Summarize");
      if (matched) expect(run.steps.design).toMatchObject({ result: "Đã vẽ UI Vườn Mèo và kiểm tra bố cục." });
      evidence.push({ run });
    }
    const turns = readFileSync(`${plan}.evidence.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(turns).toHaveLength(7);
    expect(turns.every(turn => !turn.unplanned)).toBe(true);
    evidence.push({ turns });
  } finally {
    const evidencePath = `${logPath}.workflow-routing.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 150_000);

it("routes a request straight to the step whose rule applies, and lets the lead handle one no rule covers", async () => {
  const fixture = await launchVerificationServer({}, undefined, undefined, undefined, undefined, { scripted: true });
  const { url, dataDir, logPath } = fixture.info;
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, JSON.stringify(result)).toBe(status);
    return result;
  };
  const newBot = async (name: string) => (await runControlOmb(["new-bot", "--name", name, "--section", "Engineering", "--url", url]) as any).bot;
  try {
    const lead = await newBot("Routing lead");
    const designer = await newBot("Cat UI designer");
    const drawing = "vẽ một ui game mèo trending";
    const meeting = "Đặt lịch họp với khách hàng tuần sau";
    const designRule = "Yêu cầu vẽ, thiết kế hoặc UI";
    const accountingRule = "Việc kế toán, hóa đơn";
    const plan = join(dataDir, "room-plan.json");
    writeFileSync(plan, JSON.stringify({
      [lead.id]: { turns: [
        { expectContextIncludes: [drawing, designRule, accountingRule], reply: '{"selected":["design"],"reason":"Yêu cầu vẽ UI game mèo"}' },
        { expectContextIncludes: ["Đã vẽ UI Vườn Mèo", "Not chosen for this request"], reply: "Bot thiết kế đã vẽ UI game mèo." },
        { expectContextIncludes: [meeting, designRule], reply: '{"selected":[],"reason":"Không phải việc thiết kế hay kế toán"}' },
        { expectContextIncludes: [meeting, "Handle the request yourself"], reply: "Tôi đã đề xuất ba khung giờ họp." },
      ] },
      [designer.id]: { turns: [
        { expectContextIncludes: [drawing, "Vẽ UI theo yêu cầu"], reply: "Đã vẽ UI Vườn Mèo." },
      ] },
    }));
    await api("PUT", "/api/workflows", {
      name: "Request routing", enabled: true, leadBotId: lead.id,
      nodes: [
        { id: "design", botId: designer.id, instruction: "Vẽ UI theo yêu cầu", when: designRule, x: 20, y: 20 },
        { id: "accounting", botId: lead.id, instruction: "Tổng hợp số liệu", when: accountingRule, x: 300, y: 20 },
      ],
      edges: [],
    });
    for (const [input, chosen] of [[drawing, ["design"]], [meeting, []]] as const) {
      await api("POST", "/api/workflows/run", { input }, 202);
      await expect.poll(async () => (await api("GET", "/api/workflows")).runs[0]?.status, { timeout: 60_000 }).toBe("completed");
      const run = (await api("GET", "/api/workflows")).runs[0] as WorkflowRun;
      expect(run.selection).toMatchObject({ status: "completed", selected: chosen, threadId: expect.any(String) });
      expect(run.steps.accounting).toMatchObject({ status: "skipped", reason: expect.stringContaining("Not chosen") });
      expect(run.steps.design?.status).toBe(chosen.length ? "completed" : "skipped");
      expect(run.summary).toBe(chosen.length ? "Bot thiết kế đã vẽ UI game mèo." : "Tôi đã đề xuất ba khung giờ họp.");
      evidence.push({ run });
    }
    const turns = readFileSync(`${plan}.evidence.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(turns).toHaveLength(5);
    expect(turns.every(turn => !turn.unplanned)).toBe(true);
    evidence.push({ turns });
  } finally {
    const evidencePath = `${logPath}.request-routing.json`;
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await fixture.close();
  }
}, 150_000);
