import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidence = mkdtempSync(join(tmpdir(), "omb-provider-mcp-evidence-"));
const suites = [
  "server/drivers/codex.test.ts",
  "server/drivers/claude.test.ts",
  "server/drivers/claude-tool-search.test.ts",
  "server/drivers/zcode.test.ts",
  "server/drivers/zcode.native.test.ts",
  "server/drivers/antigravity.test.ts",
  "server/drivers/antigravity-runtime.test.ts",
  "server/drivers/antigravity-lifecycle.test.ts",
  "server/drivers/antigravity.native.test.ts",
  "server/drivers/agents-mcp-env.test.ts",
  "server/drivers/turn-mcp.test.ts",
  "server/drivers/agents-proxy.test.ts",
  "server/harness-mcp-proxy.test.ts",
  "server/session-credentials.e2e.test.ts",
  "server/memory-capture-restart.e2e.test.ts",
  "server/memory-routes.test.ts",
  "server/memory-store.test.ts",
  "server/memory-forget.test.ts",
  "server/memory-upkeep.test.ts",
  "server/group-goal-run.test.ts",
  "server/group-goal-run.e2e.test.ts",
  "server/group-goal-wait-cap.e2e.test.ts",
  "server/routes/workflows.test.ts",
  "server/chief-of-staff.test.ts",
  "server/incidents.test.ts",
];
writeFileSync(join(evidence, "scope.json"), JSON.stringify({
  createdAt: new Date().toISOString(), suites,
  nativeZcode: process.env.OMB_ZCODE_NATIVE_E2E === "1",
  nativeAntigravityInitialize: process.env.OMB_AGY_NATIVE_E2E === "1",
  authenticatedNativeProviders: false,
}, null, 2));
console.log(`Evidence: ${evidence}`);
const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
  "exec", "vitest", "run", ...suites,
  "--reporter=default", "--reporter=json", `--outputFile=${join(evidence, "results.json")}`,
], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (chunk: Buffer) => { log += chunk.toString(); process.stdout.write(chunk); });
child.stderr.on("data", (chunk: Buffer) => { log += chunk.toString(); process.stderr.write(chunk); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal));
child.once("error", (error) => { log += error.message; process.exitCode = 1; });
child.once("close", (code) => {
  writeFileSync(join(evidence, "run.log"), log);
  process.exitCode = code ?? 1;
});
