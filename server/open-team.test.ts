import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { configureOpenTeam } from "../extensions/open-team/server/index.ts";
import { createWorkspaceAccess, editionForSettings, entitled, loadOpenTeamLayer } from "./enterprise.ts";
import { loadBrand } from "./brand.ts";
import { spendState } from "./spend.ts";
import { SessionRegistry } from "./sessions.ts";

const dirs: string[] = [];
function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "open-team-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("enables local branding, spend controls and pricing without a license key", () => {
  const dir = workspace();
  const status = loadOpenTeamLayer(dir);
  expect(status).toEqual({ edition: "oss", customer: "Open Team", features: ["billing", "budgets", "whitelabel"] });
  expect(editionForSettings(status)).not.toHaveProperty("license");
  const brand = join(dir, "brand.json");
  writeFileSync(brand, JSON.stringify({ name: "My Team" }));
  expect(loadBrand({ file: brand })).toMatchObject({ brand: { name: "My Team" }, source: "file" });
  expect(spendState({ budgets: { monthlyUsd: 10 } }, dir)).toMatchObject({ monthlyUsd: 10, exceeded: false });
  expect(entitled("admin")).toBe(false);
  const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  expect(createWorkspaceAccess({ sessions, cookieName: "session", closeSessionStreams() {}, env: { OMB_ADMIN_WORKSPACE: "mine" } })).toBeNull();
});

it("loads owner feature choices and rejects unknown or malformed configuration", () => {
  const dir = workspace();
  const file = join(dir, "open-team.json");
  writeFileSync(file, JSON.stringify({ name: "My Company", features: { billing: false, whitelabel: false } }));
  expect(loadOpenTeamLayer(dir)).toEqual({ edition: "oss", customer: "My Company", features: ["budgets"] });
  expect(entitled("billing")).toBe(false);
  expect(entitled("budgets")).toBe(true);
  writeFileSync(file, JSON.stringify({ features: { admin: true } }));
  expect(() => loadOpenTeamLayer(dir)).toThrow("open-team.json");
  expect(entitled("budgets")).toBe(false);
  writeFileSync(file, "not json");
  expect(() => configureOpenTeam(dir)).toThrow("open-team.json");
});
