# Real-model process and computer-use acceptance — 2026-10-31

These runs use isolated server HOME/data directories, fresh disposable projects,
Codex CLI 0.166.0 and gpt-6.1-sol. No mutations target the user's live app.
The frontend run is the app renderer served in Chrome, not the packaged Electron app.

## Observed results

| Entry point | Normal | Hard | Complex |
| --- | --- | --- | --- |
| Backend API, real model/tools | Delivered, 7 tests | Delivered, 7 tests | Deliberate defect rejected, repaired, delivered; 8 tests |
| Frontend Run process button, real model/tools | Delivered, 8 tests | Delivered, 9 tests | Escalated after three build attempts; deliver skipped |

Both suites build a dependency-free task module. Levels vary process structure:
ordered execution; parallel independent reviews and join; then plan scoring,
deliberate defect injection, review feedback and bounded repair. This is a small
coding acceptance task, not evidence that arbitrary complex applications succeed.

The frontend complex run repaired its deliberate missing-id defect on attempt 2.
A subsequent reviewer reported no app-provided file/shell tools, selected the
browser surface, and returned FAIL. That capability blocker propagated through
attempt 3 and escalation. The run's `completed` status means the escalation path
finished; it does not mean delivery passed. Independent terminal verification of
all frontend project suites passed 27 tests, but that does not replace the failed
reviewer acceptance. Native shell calls worked in other steps. Consequently,
actual tool absence versus model interpretation of the prompt remains unresolved.
The frontend task said “only your app-provided tools”; the backend task explicitly
permitted native shell/file tools, so this is not a controlled UI-only comparison.

## Computer use

- Direct native driver: isolated Electron target, actual AX click/type/click,
  screenshot and independent readback verified `CUA-LIVE-VERIFIED`.
  This proves driver input, not bot wiring.
- App bot browser: `agent_browser_open` failed with
  `net::ERR_SOCKS_CONNECTION_FAILED` and “a service on this computer that no bot
  started.” The first target server was started by the harness.
- Frontend chat retry: the bot itself created HTML and started a server through
  its native shell (PID 16812, port 55481). Both localhost and 127.0.0.1 were
  still rejected with the same error. Snapshot/screenshot captured the error;
  typing, greeting and Escape acceptance could not run. No simulated inputs
  or network-policy bypass were used. Registration of native-shell services
  with the browser's ownership policy is a follow-up investigation, not a
  confirmed root cause.

## Folder relocation

All three backend projects were physically moved from `work-before` to
`work-after`. The same conversation received the new absolute path, read the
matching continuity token, ran tests and wrote continuity.md. After bot cwd was
updated, relocation-verified.md also preserved context; all 22 tests passed
independently and old folders remained absent. This verifies explicit relocation
and rebinding, not automatic path discovery, restart recovery or a fresh thread.
Initial chat cwd could be a private task workspace; explicit absolute paths were
needed to reach the configured project.

## Evidence and reproduction

- `/tmp/omb-process-levels-20261031/acceptance.json`: backend runs, relocation
  transcripts, browser failure; adjacent `native-evidence/` and server.log.
- `/tmp/omb-process-ui-20261031/{normal,hard,complex}-design.json`: frontend runs.
  `bots-transcripts.json`, `native-evidence/`, `browser-screenshots/` and server.log
  preserve bot calls and results. UI clicks were performed with cua_repl.
- `/tmp/omb-cua-input-20261031/cua-input.json` and PNG captures: direct driver.

`scripts/verify-process-levels-live.ts` requires explicit OMB_VERIFY_CODEX_CLI,
OMB_VERIFY_CODEX_AUTH and OMB_VERIFY_OUTPUT. It uses real provider quota.
`scripts/launch-process-live-ui.ts` also takes OMB_VERIFY_SOURCE pointing to
the backend acceptance.json; it prepares a new fixture and waits for manual UI
runs. Ctrl-C saves runs and closes the fixture. Neither launcher copies user
history/configuration; the supplied auth file is copied only into the temporary
fixture HOME and removed with it. Keep raw evidence local.

`scripts/verify-cua-input-live.mjs` runs through the repository Electron binary
with OMB_VERIFY_CUA_OUTPUT set to a disposable output directory. All three new
verification scripts passed oxlint with warnings denied.

Next checks: distinguish native coding tools from selected computer capabilities
in process instructions, reproduce capability selection without ambiguous task
wording, and trace browser local-service ownership for native-shell children.
Packaged-app end-to-end computer use remains unverified.

## Source Electron restart

The installed `/Applications/open-team.app` was terminated at the owner's
request. Source Electron was then launched against the disposable desktop
fixture with `node .omb-scratch/desktop-cli-preview.mjs --resume` (API 56354,
renderer 56356). The real Electron window rendered the chat successfully.
Its fresh fixture contains only MausBot; it does not load the owner's team or
chat history.

The scratch entry point initially made Electron resolve its application root
to `.omb-scratch`. Settings consequently reported `cua-driver binary not found`,
although `dist-native/arm64/cua-driver` existed. Setting `app.setAppPath(root)`
before importing `electron/main.mjs` corrected discovery. The resumed run's
`electron.log` records the embedded CUA daemon listening on its Unix socket.
This verifies driver startup, not a bot's end-to-end computer action or the
reviewer capability fix. The original visual issue was not reproduced in the
source Electron chat window; its cause remains unconfirmed.


## Terra / Electron follow-up — 2026-11-01

Isolated source Electron, renderer `http://127.0.0.1:5173/__live-ui.html`,
fixture API `http://127.0.0.1:20963`, data `/tmp/openmausbot-verify-data-oUYDMP`.
Three additional bots were created through the desktop UI with
`codex/gpt-6.1-terra` and approval `full`. The original Sol runs above remain
historical evidence, not the result of this follow-up.

| Level | Observed result |
| --- | --- |
| Normal | Plan → build → review → deliver; 5 tests passed |
| Hard | Parallel reviews → join → deliver; 4 tests passed |
| Complex | Intentional missing-ID defect failed review; second build/review/test/merge attempts passed; deliver completed; escalation skipped; 5 tests passed |

Independent acceptance imported all three modules and checked blank titles,
missing IDs, immutable inputs, new arrays, and all/open/done filters. It also
reran each bot's Node tests. All passed. This qualifies these task-module
recipes, not an arbitrary complete product or a Claude independent sign-off.

All three folders were moved from `work/{level}` to `relocated/{level}` under
`/tmp/omb-electron-full-20261101`. After explicitly rebinding cwd and sending the
new location in the same conversation, each bot compared its continuity token
with prior plan/handoff files, reran tests and wrote `relocation-verified.md`.
Old directories were not recreated. Automatic discovery of a moved folder
without being given its location is not proven.

The complex bot then used mounted browser tools to search/open two official
Playwright resources and two YouTube tutorials, inspecting visible titles and
URLs. It wrote `resources.md`, `resources.json`, `catalog.html`, and
`browser-test-evidence.md`. Video playback in full was neither required nor
claimed. A native-shell HTTP server served the catalog at
`http://127.0.0.1:8765/catalog.html`; a real browser click on Videos left exactly
two video cards visible and two documentation cards hidden. The first server
child exited; restarting a persistent child recovered navigation.

Browser success follows the macOS port-ownership fix: `lsof` listeners and live
`ps` ancestry must all resolve to a tracked engine PID. Unrelated, mixed and
orphaned listeners remain denied. Browser-only screen instructions now preserve
the engine's native file/shell tools. No MCP connection failure was observed in
the research turn; client cache flakiness is not established as its cause.

The actual desktop Computer tab now exposes **Enable computer use**. Clicking
Off persisted `computer: "off"`, displayed Off and disabled screen tools through
the surface resolver. Clicking On persisted Auto and displayed Let it choose.
Busy bots cannot change the selection mid-turn. The legacy Access view shares
the same control. Auto defaults on without adding a new config field.

Backend changes remove the runtime first-use `Allow once` question. Host mutex,
person takeover, turn-scoped MCP tokens and OS permissions remain in force.
Native CLI adapters already receive per-turn MCP configuration directly; no
short-lived token is registered into the user's global CLI settings. Electron
starts the bundled driver; this run does not qualify a newly packaged installer
or bypass macOS permission requirements.

Evidence folder: `/tmp/omb-electron-full-20261101`:

- `terra-cases.json`, `bots-created.json`, and `terra-*-design.json` record bots/processes.
- `terra-independent-acceptance.json` and `terra-*-independent-tests.txt` record independent checks.
- `terra-*-relocation.json` and `terra-relocation-results.json` record follow-up conversations.
- `relocated/{level}/relocation-verified.md` records each continuity check.
- `browser-research/` preserves the actual catalog and research outputs.
- `native-evidence/` preserves native traces before fixture cleanup; raw traces
  stay local because they may contain turn-scoped control metadata.

Remaining review: Claude must claim P6 in the shared plan and independently
review process invariants. The running browser fixture predates first-use gate
removal; the new host runtime behavior is checked separately by isolated
`host-lazy-claim.e2e.test.ts`, not inferred from that older process.


Final checks on this revision: host-lazy-claim / room-roots / runtime-roots
isolated suites passed 32/32, including direct host calls without confirmation,
lease contention, takeover and cancellation. Surface/local-routing/ownership/
Access/simple-settings suites passed 165/165. Typecheck, targeted oxlint,
i18n catalog check and diff whitespace check passed. The UI detector returned
no findings and the actual Computer tab was visually inspected. The fixture
and source Electron are stopped after preserving evidence; restart the app to
load backend changes. No user live app data was used for verification.
