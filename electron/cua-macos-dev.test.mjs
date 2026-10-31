import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  home: "", arch: "arm64", installed: false, hosts: [],
  permissions: { accessibility: true, screenRecording: true },
}));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => fixture.home, getAppPath: () => fixture.home },
  ipcMain: { handle: vi.fn() },
}));
vi.mock("@trycua/cua-driver/embedded", () => ({
  EmbeddedCuaDriverHost: class {
    constructor(binary) { this.binary = binary; fixture.hosts.push(this); }
    start = vi.fn(async () => ({ socketPath: join(fixture.home, "owned.sock") }));
    stop = vi.fn(async () => {});
    uniffiDestroy = vi.fn();
  },
}));
vi.mock("@trycua/cua-driver/electron", () => ({
  requestMacOSPermissions: () => fixture.permissions,
  hasRequiredMacOSPermissions: status => status.accessibility && status.screenRecording,
}));
vi.mock("node:fs", async (original) => {
  const fs = await original();
  return { ...fs, default: { ...fs.default, existsSync: file =>
    file === "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
      ? fixture.installed : fs.existsSync(file),
  } };
});
vi.mock("node:child_process", () => ({ execFile: vi.fn(() => { throw new Error("unowned launch"); }) }));
vi.mock("node:net", () => ({ default: { createConnection: vi.fn(() => { throw new Error("foreign socket probed"); }) } }));

let cua;
function stageDriver(arch = fixture.arch) {
  const directory = join(fixture.home, "dist-native", arch);
  mkdirSync(directory, { recursive: true });
  const binary = join(directory, "cua-driver");
  writeFileSync(binary, "inert fixture");
  return binary;
}

beforeEach(async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "omb-cua-mac-dev-"));
  fixture.arch = "arm64";
  fixture.installed = false;
  fixture.hosts = [];
  fixture.permissions = { accessibility: true, screenRecording: true };
  vi.stubGlobal("process", new Proxy(process, {
    get(target, key) {
      return key === "platform" ? "darwin" : key === "arch" ? fixture.arch : Reflect.get(target, key);
    },
  }));
  vi.stubEnv("CUA_DRIVER_PATH", "");
  vi.stubEnv("OPENMAUSBOT_CUA_EMBEDDED", "");
  vi.resetModules();
  cua = await import("./cua.mjs");
});
afterEach(async () => {
  await cua?.stopCua();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(fixture.home, { recursive: true, force: true });
});

describe("macOS development CUA driver", () => {
  it.each(["arm64", "x64"])("starts the prepared %s binary as an owned embedded host", async (arch) => {
    fixture.arch = arch;
    const binary = stageDriver();
    expect(cua.resolveDriverBinary()).toBe(binary);
    await expect(cua.startCua()).resolves.toMatchObject({
      mode: "embedded", mcpCommand: binary,
      mcpArgs: ["mcp", "--embedded", "--socket", join(fixture.home, "owned.sock")],
      mcpEnv: { CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_RS_TELEMETRY_ENABLED: "0" },
    });
    expect(fixture.hosts[0].binary).toBe(binary);
    expect(fixture.hosts[0].start.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    await cua.stopCua();
    expect(fixture.hosts[0].stop).toHaveBeenCalledOnce();
    expect(fixture.hosts[0].uniffiDestroy).toHaveBeenCalledOnce();
  });

  it("keeps an installed CuaDriver app ahead of the development fallback", () => {
    fixture.installed = true;
    stageDriver();
    expect(cua.resolveDriverBinary()).toBe("/Applications/CuaDriver.app/Contents/MacOS/cua-driver");
  });

  it("preserves an explicit driver override", () => {
    fixture.installed = true;
    stageDriver();
    const override = join(fixture.home, "custom-driver");
    vi.stubEnv("CUA_DRIVER_PATH", override);
    expect(cua.resolveDriverBinary()).toBe(override);
  });

  it("does not select a staged binary for another architecture", async () => {
    stageDriver("x64");
    await expect(cua.startCua()).resolves.toMatchObject({
      mode: "unavailable", reason: "cua-driver binary not found",
    });
    expect(fixture.hosts).toHaveLength(0);
  });

  it("reports missing macOS grants before starting the prepared driver", async () => {
    stageDriver();
    fixture.permissions = { accessibility: true, screenRecording: false };
    await expect(cua.startCua()).resolves.toMatchObject({
      mode: "unavailable",
      reason: "embedded host failed: Screen Recording required; grant access in System Settings and restart OpenMausBot",
    });
    expect(fixture.hosts).toHaveLength(0);
  });
});
