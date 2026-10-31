// POSIX only: a Windows SIGTERM ends the process without its shutdown hooks.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import type { WireBot } from "../shared/wire.ts";
import { CAPTURE_MARKER } from "./memory-capture.ts";
import type { MemoryDoc } from "./memory-store.ts";
import { waitForExit } from "./testing/cleanup.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

it.skipIf(process.platform === "win32")("preserves private notes and conflict decisions across a folder move and restart, without recalling a deleted topic", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-continuity-"));
  const original = join(scratch, "project-before");
  const moved = join(scratch, "project-after");
  const prompts = join(scratch, "prompts.jsonl");
  mkdirSync(original);
  writeFileSync(join(original, "artifact.txt"), "folder continuity");
  const parentEnv = { ...process.env, FAKE_CLAUDE_PROMPTS: prompts };
  const fixture = await launchVerificationServer(parentEnv);
  const { url, dataDir } = fixture.info;
  let restarted: ChildProcess | undefined;
  const api = async <T = unknown>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const turn = async (bot: WireBot, threadId = bot.threadId) => {
    const before = existsSync(prompts) ? readFileSync(prompts, "utf8").length : 0;
    await runControlOmb(["send", "--bot", bot.id, "--task", threadId, "--text", "Review the current working folder and available notes.", "--url", url]);
    expect(await runControlOmb(["wait", "--bot", bot.id, "--task", threadId, "--timeout", "30", "--url", url])).toMatchObject({ status: "settled" });
    return readFileSync(prompts, "utf8").slice(before);
  };
  try {
    const { bot: first } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Private A", cwd: original }, 201);
    const { bot: second } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Private B" }, 201);
    for (const bot of [first, second]) await api(`/api/bots/${bot.id}`, "PATCH", { memoryUpkeep: false });
    const file = `/api/bots/${first.id}/memory/file`;
    const baseline = await api<MemoryDoc>(`${file}?path=MEMORY.md`);
    const writes = await Promise.all(["PRIVATE_ALPHA_ONE", "PRIVATE_ALPHA_TWO"].map((text) => fetch(url + file, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "MEMORY.md", text, expectedHash: baseline.hash }),
    })));
    expect(writes.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = await api<MemoryDoc>(`${file}?path=MEMORY.md`);
    expect(winner.text).toMatch(/^PRIVATE_ALPHA_(ONE|TWO)$/);
    await api(file, "PUT", { path: "memory/disposable.md", text: "---\ntitle: Disposable\n---\nFORGOTTEN_TOPIC_SENTINEL\n" });
    expect(await turn(first)).toContain(winner.text);
    expect(await turn(second)).not.toContain("PRIVATE_ALPHA");
    await api(`${file}?path=${encodeURIComponent("../../config.json")}`, "GET", undefined, 400);
    await api(`${file}?path=memory%2Fdisposable.md`, "DELETE");
    expect(await turn(first)).not.toContain("FORGOTTEN_TOPIC_SENTINEL");
    renameSync(original, moved);
    expect(readFileSync(join(moved, "artifact.txt"), "utf8")).toBe("folder continuity");
    await api(`/api/bots/${first.id}`, "PATCH", { cwd: moved });
    const { task } = await api<{ task: { threadId: string } }>(`/api/bots/${first.id}/tasks`, "POST", { title: "Moved project", cwd: moved }, 201);
    const movedPrompt = await turn(first, task.threadId);
    expect(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).cwd).toBe(realpathSync(moved));
    expect(movedPrompt).toContain(winner.text);
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    restarted = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
      cwd: ROOT,
      env: verificationServerEnvironment(parentEnv, dataDir, Number(new URL(url).port)),
      stdio: "ignore",
    });
    await expect.poll(async () => {
      try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; }
    }, { timeout: 20_000, interval: 150 }).toBe(true);
    expect(await api(`${file}?path=MEMORY.md`)).toMatchObject({ text: winner.text, hash: winner.hash });
    expect(await api(`${file}?path=memory%2Fdisposable.md`)).toMatchObject({ exists: false });
    const resumed = await turn(first, task.threadId);
    expect(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).cwd).toBe(realpathSync(moved));
    expect(resumed).toContain(winner.text);
    expect(resumed).not.toContain("FORGOTTEN_TOPIC_SENTINEL");
    expect(await turn(second)).not.toContain("PRIVATE_ALPHA");
    const journal = await api<{ entries: Array<{ path: string; kind: string; before?: string; diff: string; canRevert: boolean }> }>(`/api/bots/${first.id}/memory/journal`);
    const deletion = journal.entries.find((entry) => entry.path === "memory/disposable.md" && entry.kind === "deleted");
    expect(deletion).toMatchObject({ canRevert: true });
    expect(deletion?.before).toBeUndefined();
    expect(deletion?.diff).toContain("FORGOTTEN_TOPIC_SENTINEL");
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 180_000);

it.skipIf(process.platform === "win32")("captures a turn that was still waiting when the server stopped, after the next start", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "omb-capture-restart-"));
  const routes = join(scratch, "routes.json");
  writeFileSync(routes, JSON.stringify({
    [CAPTURE_MARKER]: JSON.stringify([{ text: "The person plays the cello on Sundays", kind: "fact", evidence: "I play the cello every Sunday morning", confidence: 0.9 }]),
  }));
  const parentEnv = { ...process.env, FAKE_CLAUDE_TEXT_ROUTES: routes };
  const fixture = await launchVerificationServer(parentEnv);
  const { url, dataDir } = fixture.info;
  let restarted: ChildProcess | undefined;
  const api = async <T = any>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const pending = join(dataDir, "memory-capture-pending.json");
  try {
    const { bot } = await api<{ bot: WireBot }>("/api/bots", "POST", { name: "Cellist" }, 201);
    // a quiet spell far longer than this test: the turn is still waiting at the stop
    await api("/api/config", "PUT", { memory: { captureQuietMs: 600_000 } });
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "I play the cello every Sunday morning.", "--url", url]);
    expect(await runControlOmb(["wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "30", "--url", url])).toMatchObject({ status: "settled" });

    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const saved = readFileSync(pending, "utf8");
    expect(saved).toContain(bot.threadId);
    expect(saved).not.toContain("cello");

    const config = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ ...config, memory: { ...config.memory, captureQuietMs: 1_000 } }, null, 2));
    restarted = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
      cwd: ROOT,
      env: verificationServerEnvironment(parentEnv, dataDir, Number(new URL(url).port)),
      stdio: "ignore",
    });
    await expect.poll(async () => {
      try {
        return (await fetch(`${url}/api/health`)).ok;
      } catch {
        return false;
      }
    }, { timeout: 20_000, interval: 150 }).toBe(true);
    // upkeep starts once the engines are read, a moment after health answers
    await expect.poll(async () => (await api<{ text: string }>(`/api/bots/${bot.id}/memory/file?path=MEMORY.md`)).text, { timeout: 20_000 })
      .toContain("The person plays the cello on Sundays");
    expect(existsSync(pending)).toBe(false);
  } finally {
    await waitForExit(restarted, { signal: "SIGTERM" });
    await fixture.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}, 90_000);
