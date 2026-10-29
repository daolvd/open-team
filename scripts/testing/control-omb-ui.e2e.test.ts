// Drives the real <App/> through `control-omb ui` and reads outcomes from the
// accessibility tree. Needs the pinned agent-browser binary: runs when one
// resolves (tools directory, OMB_AGENT_BROWSER_PATH or PATH) or OMB_UI_E2E=1
// asks for the verified download; otherwise skipped.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { removeTempDir, waitForExit } from "../../server/testing/cleanup.ts";
import { runControlOmb } from "../control-omb.ts";
import { agentBrowser, sessionEnv, UI_TOOLS_DIR, type UiHandle } from "./control-omb-ui.ts";
import { fixtureApi } from "./preview-fixture.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(ROOT, "scripts", "control-omb.ts");
const forced = process.env.OMB_UI_E2E === "1";
const binary = resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env });
const enabled = forced || Boolean(binary);
if (!enabled) {
  console.log(`skipping control-omb ui e2e: no agent-browser binary resolves (looked in ${UI_TOOLS_DIR}, OMB_AGENT_BROWSER_PATH and PATH); set OMB_UI_E2E=1 to install the pinned release`);
}
const run = enabled ? it : it.skip;
// A forced run may still have Chrome for Testing to download even when
// agent-browser is cached.
const LAUNCH_TIMEOUT_MS = forced ? 600_000 : 180_000;

// Synthetic provider outcomes exercise the UI, not the commands themselves.
const TOOL_CALLS = JSON.stringify([
  { name: "Bash", input: { command: "pnpm control:omb doctor" }, ok: true },
  { name: "Bash", input: { command: "pnpm control:omb ui click --name Missing" }, ok: false },
  { name: "Bash", input: { command: "pnpm control:omb ui flag --set features.showToolCalls=true --dry-run" }, ok: true },
]);
const REPLY = "hello from fake claude"; // the fake engine's default reply text
const COMPOSER = `document.querySelector('textarea[aria-label="Message Pepper"]')`;
// OMB_UI_EVIDENCE_DIR keeps the screenshot (CI uploads it); otherwise it is temporary.
const evidenceDir = process.env.OMB_UI_EVIDENCE_DIR ? resolve(ROOT, process.env.OMB_UI_EVIDENCE_DIR) : mkdtempSync(join(tmpdir(), "omb-ui-evidence-"));
const ownsEvidenceDir = !process.env.OMB_UI_EVIDENCE_DIR;

interface Launched {
  child: ReturnType<typeof spawn>;
  info: { ui: string; url: string; previewUrl: string; botId: string; dataDir: string; logPath: string };
  stderr: () => string;
}

function launch(args: string[]): Promise<Launched> {
  return new Promise((done, fail) => {
    // Own process group: a timeout must also take down whatever it is running.
    const child = spawn(process.execPath, ["--experimental-strip-types", CLI, "ui", "launch", ...args], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    const killGroup = (signal: NodeJS.Signals) => {
      if (child.pid && process.platform !== "win32") {
        try { process.kill(-child.pid, signal); return; } catch { /* group already gone */ }
      }
      child.kill(signal);
    };
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killGroup("SIGINT");
      setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
      fail(new Error(`ui launch printed no handle within ${LAUNCH_TIMEOUT_MS}ms\nstderr:\n${stderr}`));
    }, LAUNCH_TIMEOUT_MS);
    child.stderr!.on("data", (chunk: Buffer) => { stderr += String(chunk); });
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += String(chunk);
      if (settled) return;
      // A tool printing on stdout before the handle still parses from the
      // first line that starts the object.
      const start = stdout.startsWith("{") ? 0 : stdout.indexOf("\n{") + 1;
      if (start <= 0 && !stdout.startsWith("{")) return;
      try {
        const info = JSON.parse(stdout.slice(start));
        settled = true;
        clearTimeout(timer);
        done({ child, info, stderr: () => stderr });
      } catch {
      }
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(new Error(`ui launch exited ${code} before printing a handle\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
  });
}

const ui = (verb: string, handle: string, ...args: string[]) =>
  runControlOmb(["ui", verb, "--ui", handle, ...args]) as Promise<Record<string, any>>;

/** Interactive refs by accessible name, from a snapshot's `refs` table. */
const refsNamed = (snapshot: Record<string, any>, name: string, role?: string) =>
  Object.entries(snapshot.refs as Record<string, { name: string; role: string }>)
    .filter(([, element]) => element.name === name && (!role || element.role === role))
    .map(([id]) => `@${id}`);

describe("control-omb ui drives the real renderer", () => {
  let launched: Launched | undefined;

  afterAll(async () => {
    if (launched && launched.child.exitCode === null && launched.child.signalCode === null) {
      await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    }
    if (ownsEvidenceDir) await removeTempDir(evidenceDir);
  });

  run("saves bot design, runs sequential steps and persists native skill switches", async () => {
    launched = await launch([]);
    const { info } = launched;
    const handle = JSON.parse(readFileSync(info.ui, "utf8")) as UiHandle;
    const browser = (...args: string[]) => agentBrowser(handle.binary, sessionEnv(handle), args);
    const request = fixtureApi(info.url);
    const design = () => request("GET", `/api/bots/${info.botId}/design`);
    const openDesign = async () => {
      await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 15_000 }).toContain("Full access for Verification fixture");
      await ui("click", info.ui, "--name", "Bot's screen");
      await expect.poll(async () => {
        const snapshot = await ui("snapshot", info.ui);
        mkdirSync(evidenceDir, { recursive: true });
        writeFileSync(join(evidenceDir, "open-design-snapshot.json"), JSON.stringify(snapshot, null, 2));
        return snapshot.snapshot;
      }, { timeout: 15_000 }).toContain("Design bot");
      await browser("click", "#computer-panel-tabs-tab-design");
    };
    const skills = async () => (await request("GET", `/api/bots/${info.botId}/skills`) as { skills: Array<{ name: string; enabled: boolean; origin: string }> }).skills;
    const enableReviewed = async () => {
      await browser("wait", "--fn", `Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === 'Enable reviewed skill' && !button.disabled)`);
      await ui("click", info.ui, "--name", "Enable reviewed skill");
    };
    for (const name of ["fixture-audit", "fixture-report"]) {
      const folder = join(info.dataDir, ".claude", "skills", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: Inspect fixture evidence.\n---\nReport concrete evidence.\n`);
    }
    await ui("flag", info.ui, "--set", "features.claudeUserSkills=true");
    await browser("set", "viewport", "1600", "1000");
    await openDesign();
    await ui("type", info.ui, "--name", "Who am I?", "--text", "UI UX Auditor: inspect the current project");
    await ui("type", info.ui, "--name", "How do I work?", "--text", "Use current browser evidence and report actual output and failures.");
    for (const [index, title] of ["Inspect current UI", "Report findings"].entries()) {
      await ui("click", info.ui, "--name", "Add process step");
      await ui("type", info.ui, "--name", `Step ${index + 1} title`, "--text", title);
      await ui("type", info.ui, "--name", `Step ${index + 1} instruction`, "--text", index ? "Summarize the previous output with actionable fixes." : "Read the current screen and report observations.");
    }
    await ui("click", info.ui, "--name", "Enable bot process");
    await ui("click", info.ui, "--name", "Save process");
    await expect.poll(async () => (await design() as any).design.enabled).toBe(true);
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "process-desktop.png"));
    await ui("type", info.ui, "--name", "Process task", "--text", "Audit this isolated fixture");
    await ui("click", info.ui, "--name", "Run process");
    await expect.poll(async () => {
      const state = await design();
      writeFileSync(join(evidenceDir, "run.json"), JSON.stringify(state, null, 2));
      return state.runs[0]?.status;
    }, { timeout: 45_000 }).not.toBe("running");
    const state = await design() as any;
    expect(state.runs[0].status, JSON.stringify(state.runs[0])).toBe("completed");
    expect(state.runs[0].steps.map((step: any) => step.status)).toEqual(["completed", "completed"]);
    expect(state.runs[0].steps.every((step: any) => step.output === REPLY)).toBe(true);
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 15_000 }).toContain("Completed");
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "run-desktop.png"));
    await ui("click", info.ui, "--name", "Skills");
    await expect.poll(skills).toHaveLength(2);
    expect((await skills()).every(skill => skill.enabled && skill.origin === "native")).toBe(true);
    await ui("click", info.ui, "--name", "Disable all");
    await expect.poll(async () => (await skills()).every(skill => !skill.enabled)).toBe(true);
    await browser("reload");
    await openDesign();
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Design Pepper");
    await ui("click", info.ui, "--name", "Skills");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain('switch "fixture-audit"');
    await ui("click", info.ui, "--name", "fixture-audit");
    await enableReviewed();
    await expect.poll(async () => (await skills()).filter(skill => skill.enabled).map(skill => skill.name)).toEqual(["fixture-audit"]);
    await browser("reload");
    await openDesign();
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Design Pepper");
    await ui("click", info.ui, "--name", "Skills");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain('switch "fixture-audit" [checked=true');
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "skills-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "skills-mobile.png"));
    const overflow = await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth > window.innerWidth");
    expect(overflow.result).toBe(false);
    await browser("set", "viewport", "1600", "1000");
    await browser("click", "[data-computer-panel-close]");
    await ui("click", info.ui, "--name", "You");
    await ui("click", info.ui, "--name", "Settings");
    await ui("click", info.ui, "--name", "Advanced mode");
    await ui("click", info.ui, "--name", "Close settings");
    await browser("click", "[data-chathead-pill]");
    await ui("click", info.ui, "--name", "Library");
    await browser("click", '[data-panel-page="skills"]');
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain('switch "Use fixture-audit" [checked=true');
    await ui("click", info.ui, "--name", "Disable all");
    await expect.poll(async () => (await skills()).every(skill => !skill.enabled)).toBe(true);
    await ui("click", info.ui, "--name", "Use fixture-report");
    await enableReviewed();
    await expect.poll(async () => (await skills()).filter(skill => skill.enabled).map(skill => skill.name)).toEqual(["fixture-report"]);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "library-skills-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "library-skills-mobile.png"));
    expect((await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth > window.innerWidth")).result).toBe(false);
  }, 180_000);

  run("edits and runs a parallel workflow through real pointer input", async () => {
    launched = await launch([]);
    const { info } = launched;
    const handle = JSON.parse(readFileSync(info.ui, "utf8")) as UiHandle;
    const browser = (...args: string[]) => agentBrowser(handle.binary, sessionEnv(handle), args).catch(error => { throw new Error(`${args.join(" ")}: ${error}`); });
    await browser("set", "viewport", "1600", "1000");
    await ui("click", info.ui, "--name", "Team map");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain('button "Workflow"');
    await ui("click", info.ui, "--name", "Workflow");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Build your team's process");
    const lead = refsNamed(await ui("snapshot", info.ui), "Lead bot", "combobox");
    expect(lead).toHaveLength(1);
    await browser("select", lead[0]!, info.botId);
    for (let index = 0; index < 3; index++) {
      await ui("click", info.ui, "--name", "Add step");
      await ui("type", info.ui, "--name", "Instruction", "--text", ["Plan from project context", "Review independently", "Test both reports"][index]!);
    }
    const move = async (label: string, dx: number, dy: number) => {
      const result = await ui("eval", info.ui, "--js", `(() => { const r=document.querySelector('[aria-label="${label}"]').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
      const { x, y } = result.result as { x: number; y: number };
      await browser("mouse", "move", String(x), String(y));
      await browser("mouse", "down");
      await browser("mouse", "move", String(x + dx), String(y + dy));
      await browser("mouse", "up");
    };
    await move("Move step 2 Pepper", -260, 180);
    await move("Move step 3 Pepper", -200, 90);
    await browser("drag", '[aria-label="Connect from step 1 Pepper"]', '[aria-label="Move step 3 Pepper"]');
    await browser("drag", '[aria-label="Connect from step 2 Pepper"]', '[aria-label="Move step 3 Pepper"]');
    const connections = refsNamed(await ui("snapshot", info.ui), "Always", "button");
    expect(connections).toHaveLength(2);
    await ui("click", info.ui, "--ref", connections[0]!);
    await ui("type", info.ui, "--name", "Required text", "--text", "hello");
    await ui("click", info.ui, "--name", "Save changes");
    const saved = await (await fetch(`${info.url}/api/workflows`)).json();
    expect(saved.workflow.nodes[1]).toMatchObject({ x: 40, y: 230 });
    expect(saved.workflow.leadBotId).toBe(info.botId);
    expect(saved.workflow.edges).toHaveLength(2);
    expect(saved.workflow.edges[0].contains).toBe("hello");
    await ui("click", info.ui, "--name", "Back to team map");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain('button "Workflow"');
    await ui("click", info.ui, "--name", "Workflow");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Contains: hello");
    expect((await ui("eval", info.ui, "--js", "[...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Enable workflow to run').disabled")).result).toBe(true);
    await ui("click", info.ui, "--name", "Tasks");
    await ui("type", info.ui, "--name", "Task title", "--text", "Queued workflow acceptance");
    await ui("type", info.ui, "--name", "Task instructions", "--text", "Complete the queued workflow using project context");
    await ui("click", info.ui, "--name", "Add task");
    await expect.poll(async () => (await (await fetch(`${info.url}/api/workflows/tasks`)).json()).tasks[0]?.status).toBe("queued");
    expect((await (await fetch(`${info.url}/api/workflows`)).json()).runs).toHaveLength(0);
    await ui("click", info.ui, "--name", "Enable workflow");
    await expect.poll(async () => (await (await fetch(`${info.url}/api/workflows/tasks`)).json()).tasks[0]?.status, { timeout: 60_000 }).toBe("completed");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain('cell "Completed"');
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-tasks-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(document.querySelector('[data-sidebar]')?.getBoundingClientRect().right ?? 0) <= 0")).result).toBe(true);
    expect((await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth <= window.innerWidth")).result).toBe(true);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-tasks-mobile.png"));
    await browser("set", "viewport", "1600", "1000");
    await ui("click", info.ui, "--name", "Telegram");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Telegram bot recipient");
    expect((await ui("snapshot", info.ui)).snapshot).toContain("No need to enable the workflow");
    const workflowRouting = refsNamed(await ui("snapshot", info.ui), "Message routing", "combobox");
    await browser("select", workflowRouting[0]!, "workflow");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Telegram input step");
    await ui("type", info.ui, "--name", "Bot token", "--text", "123456:fixture-token");
    await ui("type", info.ui, "--name", "Telegram chat ID", "--text", "123456789");
    await ui("type", info.ui, "--name", "Allowed user ID", "--text", "123456789");
    const telegramInput = refsNamed(await ui("snapshot", info.ui), "Telegram input step", "combobox");
    await browser("select", telegramInput[0]!, saved.workflow.nodes[0].id);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-telegram-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(document.querySelector('[data-sidebar]')?.getBoundingClientRect().right ?? 0) <= 0")).result).toBe(true);
    expect((await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth <= window.innerWidth")).result).toBe(true);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-telegram-mobile.png"));
    await browser("set", "viewport", "1600", "1000");
    const routing = refsNamed(await ui("snapshot", info.ui), "Message routing", "combobox");
    await browser("select", routing[0]!, "bot");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot).toContain("Telegram bot recipient");
    const recipient = refsNamed(await ui("snapshot", info.ui), "Telegram bot recipient", "combobox");
    await browser("select", recipient[0]!, info.botId);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-telegram-direct-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(document.querySelector('[data-sidebar]')?.getBoundingClientRect().right ?? 0) <= 0")).result).toBe(true);
    expect((await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth <= window.innerWidth")).result).toBe(true);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-telegram-direct-mobile.png"));
    await browser("set", "viewport", "1600", "1000");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "document.querySelector('[data-sidebar]').getBoundingClientRect().left === 0")).result).toBe(true);
    await browser("focus", refsNamed(await ui("snapshot", info.ui), "Flow", "button")[0]!);
    await ui("press", info.ui, "--keys", "Enter");
    await ui("type", info.ui, "--name", "Workflow task", "--text", "Verify the isolated team workflow");
    expect((await ui("eval", info.ui, "--js", "document.querySelector('textarea[aria-label=\"Workflow task\"]').value")).result).toBe("Verify the isolated team workflow");
    await ui("click", info.ui, "--name", "Run workflow");
    const started = await (await fetch(`${info.url}/api/workflows`)).json();
    expect(started.runs.length, (await ui("snapshot", info.ui)).snapshot as string).toBe(2);
    await expect.poll(async () => (await (await fetch(`${info.url}/api/workflows`)).json()).runs[0]?.status, { timeout: 60_000 }).toBe("completed");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("Latest run · completed");
    const complete = await (await fetch(`${info.url}/api/workflows`)).json();
    expect(Object.values(complete.runs[0].steps).map((step: any) => step.status)).toEqual(["completed", "completed", "completed"]);
    expect(complete.runs[0].summaryThreadId).toBeTruthy();
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-desktop.png"));
    await browser("set", "viewport", "390", "844");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(document.querySelector('[data-sidebar]')?.getBoundingClientRect().right ?? 0) <= 0")).result).toBe(true);
    expect((await ui("eval", info.ui, "--js", "document.documentElement.scrollWidth <= window.innerWidth")).result).toBe(true);
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "workflow-mobile.png"));
    await browser("set", "viewport", "1600", "1000");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "document.querySelector('[data-sidebar]').getBoundingClientRect().left === 0")).result).toBe(true);
    await browser("focus", refsNamed(await ui("snapshot", info.ui), "Open lead's summary", "button")[0]!);
    await ui("press", info.ui, "--keys", "Enter");
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain('log "Conversation with Pepper"');
    const logs = await ui("console", info.ui);
    expect((logs.messages as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
  }, LAUNCH_TIMEOUT_MS + 120_000);

  run("shows the matched text inside a searched message", async () => {
    launched = await launch([]);
    const { info } = launched;
    await ui("type", info.ui, "--name", "Message Pepper", "--text", "Find the striped zebra");
    await ui("press", info.ui, "--keys", "Enter");
    await ui("wait-settle", info.ui, "--timeout", "60");
    await ui("click", info.ui, "--name", "More");
    await ui("click", info.ui, "--name", "Find in conversation");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "zebra");
    const highlighted = async () => (await ui("eval", info.ui, "--js", "[...CSS.highlights.get('search-result-text') ?? []][0]?.toString() ?? null")).result;
    await expect.poll(async () => (await ui("snapshot", info.ui)).snapshot, { timeout: 10_000 }).toContain("1 of 1");
    expect((await ui("snapshot", info.ui)).snapshot).not.toContain("Show less");
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "search-result.png"));
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(() => { const row = [...document.querySelectorAll('[data-mid]')].find(el => el.textContent.includes('Find the striped zebra')); const bubble = row?.querySelector('[data-chat-bubble]'); return !!bubble && row.querySelector('.ring-2') === bubble && bubble.getBoundingClientRect().width < row.lastElementChild.getBoundingClientRect().width; })()")).result, { timeout: 10_000 }).toBe(true);
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("zebra");
    await ui("type", info.ui, "--name", "Message Pepper", "--text", `${"hay ".repeat(160)}saffron`);
    await ui("press", info.ui, "--keys", "Enter");
    await ui("wait-settle", info.ui, "--timeout", "60");
    await ui("click", info.ui, "--name", "Find in this conversation");
    await ui("eval", info.ui, "--js", "document.querySelector('input[aria-label=\"Find in this conversation\"]').select(); true");
    await ui("press", info.ui, "--keys", "Backspace");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "saffron");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("saffron");
    expect((await ui("eval", info.ui, "--js", "[...document.querySelectorAll('.chat-text')].find(el => el.textContent.includes('saffron'))?.classList.contains('max-h-40')")).result).toBe(false);
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "(() => { const range = [...CSS.highlights.get('search-result-text')][0]; const bounds = range.startContainer.parentElement.closest('.overflow-y-auto').getBoundingClientRect(); const match = range.getBoundingClientRect(); return match.top >= bounds.top && match.bottom <= bounds.bottom; })()")).result).toBe(true);
    await ui("click", info.ui, "--name", "Find in this conversation");
    await ui("eval", info.ui, "--js", "document.querySelector('input[aria-label=\"Find in this conversation\"]').select(); true");
    await ui("press", info.ui, "--keys", "Backspace");
    await ui("type", info.ui, "--name", "Find in this conversation", "--text", "fake claude");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("fake claude");
    await ui("press", info.ui, "--keys", "Escape");
    await ui("type", info.ui, "--name", "Search bots and messages", "--text", "zebra");
    await expect.poll(async () => (await ui("eval", info.ui, "--js", "[...document.querySelectorAll('mark')].some(mark => mark.textContent === 'zebra')")).result, { timeout: 10_000 }).toBe(true);
    await ui("eval", info.ui, "--js", "[...document.querySelectorAll('mark')].find(mark => mark.textContent === 'zebra').closest('button').click(); true");
    await expect.poll(highlighted, { timeout: 10_000 }).toBe("zebra");
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
  }, LAUNCH_TIMEOUT_MS + 90_000);

  run("saves a key on Enter, checks it once saved, shows it masked, and keeps a refused or failed draft", async () => {
    launched = await launch([]);
    const { info } = launched;
    await fixtureApi(info.url)("PUT", "/api/config", {
      openaiCompat: { key: "fixture-saved-key", url: "http://127.0.0.1:1/v1" },
    });
    const evaluate = async (js: string) => (await ui("eval", info.ui, "--js", js)).result;
    const click = (name: string) => ui("click", info.ui, "--name", name);
    const row = `document.querySelector('[data-api-key-row="openaiCompat"]')`;
    const input = `${row}?.querySelector('[data-key-input]')`;
    const verdict = () => evaluate(`${row}.querySelector('[role="status"]')?.textContent`);
    const rowText = () => evaluate(`${row}.textContent`);
    const masked = () => evaluate(`${row}.querySelector('[data-key-masked]')?.textContent ?? null`);
    const replace = () => evaluate(`${row}.querySelector('[data-key-replace]').click(); true`);
    const type = async (text: string) => {
      await click("OpenAI-compatible API key");
      await evaluate(`${input}.select(); true`);
      await ui("press", info.ui, "--keys", "Backspace");
      if (text) await ui("type", info.ui, "--name", "OpenAI-compatible API key", "--text", text);
    };
    const enter = () => ui("press", info.ui, "--keys", "Enter");
    await evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.keyTests = [];
      window.keySaves = 0;
      window.rejectKeySave = false;
      window.fetch = (url, init = {}) => {
        if (String(url) === '/api/keys/test') {
          window.keyTests.push(JSON.parse(init.body));
          return Promise.resolve(Response.json({ ok: true, check: 'models', models: ['fixture-model'] }));
        }
        if (String(url) === '/api/config' && init.method === 'PUT' && String(init.body).includes('"openaiCompat"')) {
          window.keySaves++;
          if (window.rejectKeySave) return Promise.resolve(Response.json({ error: 'Fixture save rejected' }, { status: 503 }));
        }
        return original(url, init);
      };
      return true;
    })()`);
    await click("You");
    await click("Settings");
    // Settings is a lazy chunk: it paints once the chunk arrives.
    await expect.poll(() => evaluate(`(() => {
      const tab = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'API keys');
      tab?.click();
      return Boolean(tab);
    })()`), { timeout: 10_000 }).toBe(true);
    // The servers section opens on its own, because a key is saved there.
    await expect.poll(masked, { timeout: 10_000 }).toContain("••••••••-key");

    await expect.poll(() => evaluate(`${row}.querySelector('[data-key-check]')?.disabled ?? null`), { timeout: 10_000 }).toBe(false);
    await evaluate(`${row}.querySelector('[data-key-check]').click(); true`);
    await expect.poll(() => evaluate("window.keyTests")).toEqual([{ provider: "openaiCompat" }]);
    await expect.poll(verdict).toBe("Saved key: Model catalog reachable: fixture-model. Authentication and chat not verified.");

    await replace();
    await type("  fixture-draft-key  ");
    await enter();
    await expect.poll(() => evaluate(`${input} ?? null`), { timeout: 10_000 }).toBe(null);
    await expect.poll(masked, { timeout: 10_000 }).toContain("••••••••-key");
    await expect.poll(() => evaluate("window.keyTests")).toEqual([{ provider: "openaiCompat" }, { provider: "openaiCompat" }]);
    expect(await evaluate("window.keySaves")).toBe(1);

    await replace();
    await type("not a key at all");
    await enter();
    await expect.poll(rowText, { timeout: 10_000 }).toContain("That doesn't look like an API key");
    expect(await evaluate("window.keySaves")).toBe(1);
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "provider-key-refused.png"));

    await type("fixture-replacement-key");
    await evaluate("window.rejectKeySave = true");
    await enter();
    await expect.poll(rowText, { timeout: 10_000 }).toContain("Didn't work: Fixture save rejected");
    await expect.poll(() => evaluate(`${input}?.value ?? null`), { timeout: 10_000 }).toBe("fixture-replacement-key");
    await evaluate("window.rejectKeySave = false");
    await click("OpenAI-compatible API key");
    await enter();
    await expect.poll(() => evaluate(`${input} ?? null`), { timeout: 10_000 }).toBe(null);
    await expect.poll(() => evaluate("window.keyTests.length")).toBe(3);
    await expect.poll(verdict).toBe("Saved key: Model catalog reachable: fixture-model. Authentication and chat not verified.");
    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
    expect(existsSync(info.dataDir)).toBe(false);
  }, LAUNCH_TIMEOUT_MS + 180_000);

  run("sends a turn from the composer and shows the reply and the scripted tool chip", async () => {
    launched = await launch(["--tool-calls", TOOL_CALLS]);
    const { info } = launched;
    expect(info.ui).toBe(join(info.dataDir, "ui.json"));
    expect(existsSync(info.ui)).toBe(true);
    const handle = JSON.parse(readFileSync(info.ui, "utf8"));
    expect(handle).toMatchObject({ url: info.url, previewUrl: info.previewUrl, botId: info.botId, home: info.dataDir, session: `omb-ui-${new URL(info.url).port}` });
    expect(existsSync(handle.binary)).toBe(true);

    const dry = await ui("flag", info.ui, "--set", "features.showToolCalls=true", "--dry-run");
    expect(dry).toMatchObject({ ok: true, dryRun: true, patch: { features: { showToolCalls: true } } });
    const flagged = await ui("flag", info.ui, "--set", "features.showToolCalls=true");
    expect(flagged).toMatchObject({ ok: true, features: { showToolCalls: true } });
    expect(flagged.features).toMatchObject({ skillAuthoring: true });

    const savedBot = async () => (await fetch(`${info.url}/api/bots`).then((response) => response.json())).bots.find((bot: any) => bot.id === info.botId);
    const originalBot = await savedBot();
    const originalModel = originalBot.modelSelection.model;
    const models = await runControlOmb(["models", "--url", info.url]) as any;
    const options = models.instances.find((instance: any) => instance.instanceId === originalBot.modelSelection.instanceId).models.options;
    const originalLabel = options.find((option: any) => option.id === originalModel).label;
    const nextModel = options.find((option: any) => option.id !== originalModel);
    await ui("click", info.ui, "--name", originalLabel);
    expect(await ui("eval", info.ui, "--js", "[...document.querySelectorAll('[aria-label=\"Apply model changes to\"] button')].find(b => b.textContent === 'Only this thread').getAttribute('aria-pressed')"))
      .toMatchObject({ result: "true" });
    await ui("click", info.ui, "--name", "Thread + bot default");
    const scopeShot = join(evidenceDir, "model-scope.png");
    mkdirSync(evidenceDir, { recursive: true });
    await ui("screenshot", info.ui, "--out", scopeShot);
    await ui("click", info.ui, "--name", nextModel.label);
    await expect.poll(async () => (await savedBot()).modelSelection.model, { timeout: 10_000 }).toBe(nextModel.id);
    expect((await savedBot()).tasks.find((task: any) => task.threadId === originalBot.threadId).modelSelection.model).toBe(nextModel.id);
    await ui("click", info.ui, "--name", nextModel.label);
    await ui("click", info.ui, "--name", "Only this thread");
    const modelSnapshot = await ui("snapshot", info.ui, "--interactive");
    const originalRow = Object.entries(modelSnapshot.refs as Record<string, { name: string; role: string }>)
      .find(([, value]) => value.role === "button" && value.name.startsWith(originalLabel));
    expect(originalRow).toBeDefined();
    await ui("click", info.ui, "--ref", `@${originalRow![0]}`);
    await expect.poll(async () => (await savedBot()).tasks.find((task: any) => task.threadId === originalBot.threadId).modelSelection.model,
      { timeout: 10_000 }).toBe(originalModel);
    expect((await savedBot()).modelSelection.model).toBe(nextModel.id);
    expect((await savedBot()).approvalMode).toBe(originalBot.approvalMode);

    const before = await ui("snapshot", info.ui, "--interactive");
    expect(before.ok).toBe(true);
    const [composer, ...moreComposers] = refsNamed(before, "Message Pepper", "textbox");
    expect(composer).toMatch(/^@e\d+$/);
    expect(moreComposers).toEqual([]);
    expect(before.snapshot).not.toContain(REPLY);

    const typed = await ui("type", info.ui, "--ref", composer, "--text", "hello");
    expect(typed).toMatchObject({ ok: true, target: composer, typed: "hello" });
    const pressed = await ui("press", info.ui, "--keys", "Enter");
    expect(pressed).toMatchObject({ ok: true, pressed: "Enter" });

    const settled = await ui("wait-settle", info.ui, "--timeout", "60");
    expect(settled).toMatchObject({ ok: true, status: "settled", browser: { state: "networkidle" }, renderer: { rendered: true } });
    expect((settled.bots as Array<{ busy: boolean }>).every((bot) => !bot.busy)).toBe(true);

    const after = await ui("snapshot", info.ui);
    expect(after.ok).toBe(true);
    const tree = after.snapshot as string;
    // The sidebar row previews the reply too; read the transcript landmark.
    const transcriptStart = tree.indexOf('log "Conversation with Pepper"');
    expect(transcriptStart).toBeGreaterThan(-1);
    const transcript = tree.slice(transcriptStart);
    expect(transcript).toContain('StaticText "hello"'); // the sent turn
    expect(transcript).toContain(`StaticText "${REPLY}"`);
    expect(transcript).toMatch(/StaticText "Bash"/);
    expect(tree).not.toContain("Not logged in");
    expect(tree).not.toContain("Execution timeline");
    // All three scripted commands go through the control CLI, so all are verified.
    expect(tree).toContain("3 steps · 3 verified · 1 failed · 1 dry run");

    // Hit-test the actual layout, not just the Tailwind class strings: the
    // blank band beside the floating card must reach the transcript while
    // the card and composer remain interactive.
    const hitTest = await ui("eval", info.ui, "--js", `(() => {
      const card = document.querySelector('section[aria-label="This run"]');
      const dock = card.parentElement.parentElement;
      const rect = card.getBoundingClientRect();
      const blank = document.elementFromPoint(dock.getBoundingClientRect().left + 8, rect.top + rect.height / 2);
      const onCard = document.elementFromPoint(rect.left + 20, rect.top + 20);
      const scroll = document.querySelector('[role="log"]').parentElement;
      const composer = ${COMPOSER};
      const input = composer.getBoundingClientRect();
      return {
        blankReachesTranscript: scroll.contains(blank) && !dock.contains(blank) && getComputedStyle(scroll).overflowY === 'auto',
        cardInteractive: card.contains(onCard),
        composerInteractive: document.elementFromPoint(input.left + input.width / 2, input.top + input.height / 2) === composer,
      };
    })()`);
    expect(hitTest).toMatchObject({ result: { blankReachesTranscript: true, cardInteractive: true, composerInteractive: true } });

    expect(await runControlOmb(["doctor", "--url", info.url])).toMatchObject({ ok: true });
    await expect(ui("click", info.ui, "--name", "Deliberately missing QA control")).rejects.toThrow("no element is named");

    // Planted with the same delay the real control has: a --name lookup that
    // lands a tick early must still click it.
    await ui("eval", info.ui, "--js", `(() => {
      const late = document.createElement("button");
      late.textContent = "Late QA control";
      late.setAttribute("aria-label", "Late QA control");
      // Keep this synthetic target inside the viewport: appending a normal
      // flow sibling below the full-height app makes click scroll the app
      // out of view, interfering with the real controls exercised next.
      late.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
      setTimeout(() => document.body.appendChild(late), 1500);
      return "planted";
    })()`);
    expect(await ui("click", info.ui, "--name", "Late QA control")).toMatchObject({ ok: true });
    await ui("eval", info.ui, "--js", `document.querySelector('[aria-label="Late QA control"]').remove()`);

    mkdirSync(evidenceDir, { recursive: true });
    const shotPath = join(evidenceDir, "chat-ui.png");
    const shot = await ui("screenshot", info.ui, "--out", shotPath);
    expect(shot).toMatchObject({ ok: true, path: shotPath });
    const png = readFileSync(shotPath);
    expect(png.length).toBeGreaterThan(1_000);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const rowsBefore = await ui("eval", info.ui, "--js", "document.querySelectorAll('[data-mid]').length");
    await ui("click", info.ui, "--name", "Save as skill");
    const drafted = await ui("eval", info.ui, "--js", `${COMPOSER}.value`);
    expect(drafted.ok).toBe(true);
    const draft = drafted.result as string;
    expect(draft.startsWith("Create a verification skill from the run below.\nGoal: hello\n")).toBe(true);
    expect(draft).toContain("✓ doctor — pnpm control:omb doctor (verified)\n");
    expect(draft).toContain("✗ ui — pnpm control:omb ui click --name Missing (verified)\n");
    expect(draft).toContain("[dry run] ui — pnpm control:omb ui flag --set features.showToolCalls=true --dry-run (verified)\n");
    expect(draft.endsWith("\n\n")).toBe(true);
    expect(await ui("eval", info.ui, "--js", `document.activeElement === ${COMPOSER}`)).toMatchObject({ ok: true, result: true });
    // The composer sits inside the conversation landmark, so its draft shows up
    // in that snapshot; "nothing was sent" is the message-row count, unchanged.
    const rowsAfter = await ui("eval", info.ui, "--js", "document.querySelectorAll('[data-mid]').length");
    expect(rowsAfter.result).toBe(rowsBefore.result);
    const afterSave = await ui("snapshot", info.ui);
    const transcriptAfterSave = (afterSave.snapshot as string).slice((afterSave.snapshot as string).indexOf('log "Conversation with Pepper"'));
    expect(transcriptAfterSave.match(/StaticText "hello"/g)).toHaveLength(1);

    await ui("click", info.ui, "--name", "Collapse the run");
    const collapsed = await ui("snapshot", info.ui);
    expect(collapsed.snapshot).toContain("Expand the run");
    expect(collapsed.snapshot).not.toContain('list "Run steps"');

    await ui("click", info.ui, "--name", "More");
    await ui("click", info.ui, "--name", "Inspector");
    const inspected = await ui("snapshot", info.ui);
    const runLog = (inspected.snapshot as string).slice((inspected.snapshot as string).indexOf('complementary "Inspector"'));
    expect(runLog).toContain('tab "Run Log" [selected');
    expect(runLog).toContain("pnpm control:omb doctor");
    expect(runLog).toContain("pnpm control:omb ui click --name Missing");
    expect(runLog).toContain('StaticText "Failed"');
    expect(runLog).toContain("Copy redacted run log");
    await ui("screenshot", info.ui, "--out", join(evidenceDir, "run-log.png"));

    const [eventsTab] = refsNamed(inspected, "Events", "tab");
    expect(eventsTab).toBeDefined();
    await ui("click", info.ui, "--ref", eventsTab);
    const events = await ui("snapshot", info.ui);
    expect(events.snapshot).toContain("turn.started");
    const [rawTab] = refsNamed(events, "Raw", "tab");
    await ui("click", info.ui, "--ref", rawTab);
    expect((await ui("snapshot", info.ui)).snapshot).toContain('tab "Raw" [selected');
    await ui("click", info.ui, "--name", "Close the Inspector");
    expect((await ui("snapshot", info.ui)).snapshot).not.toContain('complementary "Inspector"');

    const logs = await ui("console", info.ui);
    expect(logs.ok).toBe(true);
    expect((logs.messages as Array<{ type: string; text: string }>).filter((message) => message.type === "error")).toEqual([]);
    const title = await ui("eval", info.ui, "--js", "document.title");
    expect(title).toMatchObject({ ok: true, result: "Isolated OpenMaus Chat" });

    await waitForExit(launched.child, { signal: "SIGINT", graceMs: 30_000 });
    expect(launched.child.exitCode).toBe(0);
    expect(existsSync(info.dataDir)).toBe(false);
    expect(existsSync(info.logPath)).toBe(true);
    await expect(ui("snapshot", info.ui)).rejects.toThrow("could not read the ui handle");
  }, LAUNCH_TIMEOUT_MS + 120_000);
});
