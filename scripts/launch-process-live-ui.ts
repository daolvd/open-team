import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchVerificationServer } from "./control-omb.ts";
import { ensureUiBrowser } from "./testing/control-omb-ui.ts";
import { fixtureApi, mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";

const { OMB_VERIFY_CODEX_CLI: cli, OMB_VERIFY_CODEX_AUTH: auth, OMB_VERIFY_OUTPUT: output,
  OMB_VERIFY_SOURCE: source } = process.env;
if (!cli || !auth || !output || !source) throw new Error("Supply explicit CLI, auth, output and source acceptance.json; uses real quota.");
mkdirSync(output, { recursive: true });
const previous = JSON.parse(readFileSync(source, "utf8"));
const browser = await ensureUiBrowser(process.env, console.error);
const fixture = await launchVerificationServer({}, undefined, undefined,
  { binaryPath: browser.binary, executablePath: browser.chrome ?? "" }, undefined, undefined, ["codex"]);
const api = fixtureApi(fixture.info.url);
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const home = join(fixture.info.dataDir, ".codex");
  mkdirSync(home, { mode: 0o700 });
  copyFileSync(auth, join(home, "auth.json"));
  chmodSync(join(home, "auth.json"), 0o600);
  writeFileSync(join(home, "config.toml"), "");
  await api("PATCH", "/api/instances/codex", { cli });
  await api("PUT", "/api/config", { features: { browser: true, showToolCalls: true } });
  const cases = [];
  for (const entry of previous.cases) {
    const cwd = resolve(output, "work", entry.level);
    mkdirSync(cwd, { recursive: true });
    copyFileSync(join(entry.movedTo, "context.txt"), join(cwd, "context.txt"));
    const { bot } = await api("POST", "/api/bots", {
      name: `UI ${entry.level}`, cwd, approvalMode: "full", computer: "browser", browser: true,
      description: "Use your own tools to work only in the disposable project folder. Execute and verify directly.",
      modelSelection: { instanceId: "codex", model: previous.model },
    });
    await api("PUT", `/api/bots/${bot.id}/design`, { ...entry.run.design, enabled: true });
    cases.push({ level: entry.level, botId: bot.id, cwd, input: entry.run.input.replaceAll(entry.cwd, cwd) });
  }
  preview = await mountPreview(fixture, { entry: "/src/main.tsx", route: "/__live-ui.html", title: "Isolated OpenMausBot UI acceptance" });
  writeFileSync(join(output, "fixture.json"), JSON.stringify({ fixture: fixture.info, preview: preview.previewUrl, cases }, null, 2));
  console.log(JSON.stringify({ ...fixture.info, preview: preview.previewUrl, output }));
  await parkUntilSignal();
  for (const entry of cases) {
    writeFileSync(join(output, `${entry.level}-design.json`), JSON.stringify(await api("GET", `/api/bots/${entry.botId}/design`), null, 2));
  }
} finally {
  cpSync(join(fixture.info.dataDir, "native"), join(output, "native-evidence"), { recursive: true, force: true });
  copyFileSync(fixture.info.logPath, join(output, "server.log"));
  await preview?.close();
  await fixture.close();
}
