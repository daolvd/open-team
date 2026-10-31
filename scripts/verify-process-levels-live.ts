import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { launchVerificationServer, runControlOmb } from "./control-omb.ts";
import { ensureUiBrowser } from "./testing/control-omb-ui.ts";
import { fixtureApi, mountPreview } from "./testing/preview-fixture.ts";

const cli = process.env.OMB_VERIFY_CODEX_CLI;
const auth = process.env.OMB_VERIFY_CODEX_AUTH;
const output = process.env.OMB_VERIFY_OUTPUT;
const model = process.env.OMB_VERIFY_CODEX_MODEL;
if (!cli || !auth || !output || !model) throw new Error("Supply explicit CLI, auth, model and output. Uses real model quota.");
mkdirSync(output, { recursive: true });
const browser = await ensureUiBrowser(process.env, console.error);
const fixture = await launchVerificationServer({}, undefined, undefined,
  { binaryPath: browser.binary, executablePath: browser.chrome ?? "" }, undefined, undefined, ["codex"]);
const api = fixtureApi(fixture.info.url);
const report: any = { startedAt: new Date().toISOString(), model, fixture: fixture.info, cases: [] };
const save = () => writeFileSync(join(output, "acceptance.json"), JSON.stringify(report, null, 2));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const step = (id: string, instruction: string, extra = {}) => ({ id, title: id, instruction, effort: "low", ...extra });
const edge = (from: string, to: string, extra = {}) => ({ from, to, ...extra });
async function processRun(entry: any, design: any, input: string) {
  await api("PUT", `/api/bots/${entry.botId}/design`, { enabled: true, ...design });
  const { run } = await api("POST", `/api/bots/${entry.botId}/design/run`, { input });
  entry.runId = run.id; save();
  const deadline = Date.now() + 600_000;
  let previous = "";
  do {
    const state = await api("GET", `/api/bots/${entry.botId}/design`);
    entry.run = state.runs.find((r: any) => r.id === run.id);
    const progress = entry.run.steps.map((s: any) => `${s.id}:${s.status}:${s.attempts ?? 0}`).join(" ");
    if (previous !== progress) { console.log(JSON.stringify({ level: entry.level, progress })); previous = progress; }
    save();
    if (entry.run.status !== "running") return;
    await delay(2000);
  } while (Date.now() < deadline);
  entry.timedOut = true;
  await api("POST", `/api/bots/${entry.botId}/design/stop`, {});
  save();
}
async function chat(entry: any, text: string, task?: string) {
  const sent: any = await runControlOmb(["send", "--bot", entry.botId, ...(task ? ["--task", task] : []), "--text", text, "--url", fixture.info.url]);
  const result: any = { sent };
  const deadline = Date.now() + 180_000;
  do {
    result.wait = await runControlOmb(["wait", "--bot", entry.botId, "--task", sent.taskId, "--timeout", "20", "--url", fixture.info.url]);
    if (["settled", "failed", "needs-user", "stalled"].includes(result.wait.status)) break;
  } while (Date.now() < deadline);
  result.messages = await runControlOmb(["messages", "--bot", entry.botId, "--task", sent.taskId, "--limit", "60", "--url", fixture.info.url]);
  return result;
}
try {
  const home = join(fixture.info.dataDir, ".codex");
  mkdirSync(home, { mode: 0o700 });
  copyFileSync(auth, join(home, "auth.json")); chmodSync(join(home, "auth.json"), 0o600);
  writeFileSync(join(home, "config.toml"), "");
  await api("PUT", "/api/config", { features: { browser: true, showToolCalls: true } });
  await api("PATCH", "/api/instances/codex", { cli });
  preview = await mountPreview(fixture, {
    entry: "/src/main.tsx", route: "/__process-levels.html", title: "Isolated process acceptance",
    extraRoutes: [{ path: "/__browser-test-page", handler(_req, res) {
      res.setHeader("content-type", "text/html");
      res.end(readFileSync(new URL("./testing/browser-test-page.html", import.meta.url), "utf8"));
    } }],
  });
  report.testPage = new URL("/__browser-test-page", preview.previewUrl).href;
  console.log(JSON.stringify({ fixture: fixture.info, testPage: report.testPage, output }));
  for (const level of ["normal", "hard", "complex"]) {
    const cwd = resolve(output, "work-before", level);
    mkdirSync(cwd, { recursive: true });
    const marker = randomUUID();
    writeFileSync(join(cwd, "context.txt"), `Project=${level}\nHidden continuity token=${marker}\n`);
    const { bot } = await api("POST", "/api/bots", {
      name: `Live ${level}`, description: "Implement only disposable acceptance projects. Act directly, use tools, verify results. Never access personal projects. Keep answers brief.",
      cwd, approvalMode: "full", computer: "browser", browser: true,
      modelSelection: { instanceId: "codex", model },
    });
    report.cases.push({ level, botId: bot.id, taskId: bot.activeTaskId, cwd, marker });
  }
  save();
  await Promise.allSettled(report.cases.map(async (entry: any) => {
    const scope = `Work only in ${entry.cwd}. Read context.txt. Use native shell/file tools to create real files. No external dependencies or network. Build a tiny task-list domain module app.mjs exporting addTask(tasks,title), toggleTask(tasks,id), filterTasks(tasks,mode). Reject blank title, toggle missing id must throw, modes all/open/done. Use immutable arrays. Add node:test tests in app.test.mjs; execute node --test app.test.mjs. Every final review must end with JSON {"verdict":"PASS" or "FAIL","score":0..100,"notes":"actual evidence"}. Never fabricate test results. No user approvals required in this disposable folder.`;
    const plan = step("plan", "Read the context file and write plan.md with the continuity token, acceptance and implementation outline. Do not build yet.");
    const build = step("build", "Implement app.mjs and meaningful node:test coverage in app.test.mjs for all acceptance. Run tests, report actual output. If reviewer feedback exists, fix it. Freeze sha256 of app.mjs.");
    const check = step("check", "Independently inspect app.mjs and execute node --test app.test.mjs. Check every acceptance, report hash, return structured PASS only when verified.", { output: "verdict" });
    const deliver = step("deliver", "Read files and run node --test app.test.mjs again. Write handoff.md with context token, actual hash, actual tests and remaining limitations. Report local handoff.");
    let design: any = { steps: [plan, build, check, deliver] };
    if (entry.level !== "normal") {
      const code = step("code", "Read frozen app.mjs independently. Check immutability, blank rejection, missing id and filtering. Do not edit. Return actual sha256 and structured verdict.", { output: "verdict" });
      const tests = step("tests", "Independently run tests and probe blank title, unknown id, all/open/done filters and immutability. Do not edit app.mjs. Report sha256, commands/results and structured verdict.", { output: "verdict" });
      const merge = step("merge", "Aggregate both code and tests reviews of the SAME hash. PASS only if both PASS with all acceptance verified, otherwise FAIL with actionable feedback. Return structured verdict.", { join: "all", output: "verdict" });
      const escalate = step("escalate", "Write blocked.md with actual failed acceptance and exhausted attempts. Do not claim delivery.");
      design = { steps: [plan, build, code, tests, merge, deliver, escalate], edges: [edge("plan", "build"), edge("build", "code"), edge("build", "tests"), edge("code", "merge"), edge("tests", "merge"), edge("merge", "deliver", { when: "verdict == PASS" }), edge("merge", "build", { when: "verdict == FAIL", loop: { max: 2 } }), edge("merge", "escalate", { when: "verdict == FAIL" })] };
      if (entry.level === "complex") {
        design.steps.splice(1, 0, step("plan-score", "Independently assess the plan against ALL acceptance. Return PASS score >=90 only if complete. No editing.", { output: "verdict" }));
        design.edges[0] = edge("plan", "plan-score");
        design.edges.push(edge("plan-score", "build", { when: "verdict == PASS and score >= 90" }), edge("plan-score", "escalate", { otherwise: true }));
        build.instruction += " Fault-injection requirement for this acceptance test: on FIRST build only intentionally leave toggleTask unknown-id returning unchanged tasks and document this known defect in injected.txt. Tests MUST expose this failure. On reviewer feedback, repair missing-id rejection, keep all acceptance tests, and rerun. This proves real FAIL->feedback->repair->PASS, not a fabricated verdict.";
      }
    }
    try { await processRun(entry, design, scope); }
    catch (error) { entry.error = String(error); save(); }
  }));
  for (const entry of report.cases) {
    if (!existsSync(join(entry.cwd, "handoff.md"))) continue;
    entry.beforeMove = await chat(entry, "Read context.txt and handoff.md and remember the hidden continuity token. Reply with it and the current absolute working directory. Do not edit files.");
    const moved = resolve(output, "work-after", entry.level);
    mkdirSync(resolve(output, "work-after"), { recursive: true });
    renameSync(entry.cwd, moved); entry.movedTo = moved; save();
    entry.stalePath = await chat(entry, `The project folder was moved to ${moved}. Continue this SAME conversation: read context.txt from the new location, compare its token to your earlier context, run the real tests and write continuity.md inside the moved folder. Do not recreate the old folder.`, entry.beforeMove.sent.taskId);
    await api("PATCH", `/api/bots/${entry.botId}`, { cwd: moved });
    entry.afterRebind = await chat(entry, `The project's configured cwd is now ${moved}. Read context.txt, plan.md and handoff.md. Run node --test app.test.mjs. Write relocation-verified.md with actual cwd, token and test results. Do not recreate the old folder.`);
    entry.relocated = existsSync(join(moved, "relocation-verified.md"));
    save(); console.log(JSON.stringify({ level: entry.level, relocated: entry.relocated, staleStatus: entry.stalePath.wait?.status }));
  }
  const entry = report.cases[0];
  report.computer = await chat(entry, `Use OpenMausBot's browser tools to open ${report.testPage}. Take a real screenshot, type Process-Live into Test name and click Say hello. Observe that Hello, Process-Live is rendered. Open dialog then press Escape and verify Dialog closed. Take another screenshot. Do not simulate input with JavaScript, fetch, or a shell. Report actual tool failures rather than suggesting steps.`);
  const thread = report.computer.sent.taskId;
  report.computer.evidence = await api("GET", `/api/threads/${thread}/evidence?limit=100`);
  writeFileSync(join(output, "browser-evidence.tar"), Buffer.from(await (await fetch(`${fixture.info.url}/api/threads/${thread}/evidence.tar`)).arrayBuffer()));
  report.finishedAt = new Date().toISOString(); save();
} catch (error) {
  report.error = String(error); save(); throw error;
} finally {
  if (existsSync(fixture.info.logPath)) copyFileSync(fixture.info.logPath, join(output, "server.log"));
  save();
  await preview?.close();
  await fixture.close();
}
