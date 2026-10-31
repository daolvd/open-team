import { constants, copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { validateAntigravityRuntime } from "./antigravity-acp.ts";
import { ANTIGRAVITY_RELEASE_VERSION } from "./antigravity-release.ts";
import { resolveAntigravityRuntime } from "./antigravity-runtime.ts";

it.skipIf(process.env.OMB_AGY_NATIVE_E2E !== "1")("initializes the official Antigravity ACP runtime in an isolated profile without authentication", async () => {
  const source = process.env.OMB_AGY_ACP_EXECUTABLE;
  expect(source, "Set OMB_AGY_ACP_EXECUTABLE to the official ACP executable").toBeTruthy();
  const root = mkdtempSync(join(tmpdir(), "omb-agy-native-"));
  const executableName = process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par";
  const harnessName = process.platform === "win32" ? "localharness_external.exe" : "localharness_external";
  try {
    copyFileSync(resolve(source!), join(root, executableName), constants.COPYFILE_FICLONE);
    copyFileSync(join(dirname(resolve(source!)), harnessName), join(root, harnessName), constants.COPYFILE_FICLONE);
    const runtime = await resolveAntigravityRuntime(join(root, executableName));
    await validateAntigravityRuntime(runtime, ANTIGRAVITY_RELEASE_VERSION);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 90_000);
