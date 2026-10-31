# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the binding rules (verification and comment policy) and applies here too. Read it first.

## What this is

open-team is a fork of OpenMausBot: a local-first desktop app that runs teams of AI agents ("bots") through the `claude`, `codex` and `grok` CLIs already installed on the user's machine. The fork adds visual bot workflows, team tasks, chief-authored worker processes and Telegram I/O. The old names stay for compatibility, so the `openmausbot` command, `OMB_*` env vars, `openmausbot://` links and the `~/.openmausbot` data dir still apply even though `package.json` is named `open-team`.

## Commands

Requires Node >= 24 and pnpm 10. Server and scripts run TypeScript directly with `node --experimental-strip-types`, so there is no server build step in development.

```sh
pnpm install            # also points git at scripts/git-hooks (pre-push runs lint, typecheck, i18n:check)
pnpm dev:server         # harness server on 127.0.0.1:8799 (OMB_PORT overrides)
pnpm dev                # Vite app on http://127.0.0.1:5199, proxies /api to the server
pnpm dev:desktop        # Electron shell; needs the two commands above running
pnpm omb                # run the packaged-style terminal flow (setup, serve, pair)

pnpm lint               # oxlint --deny-warnings
pnpm typecheck          # tsc -b (app) + tsc -p tsconfig.server.json (server, companion, extensions, connector)
pnpm i18n:check         # locale catalogs vs src/locales/en.json
pnpm build              # typecheck + vite build
pnpm test               # the whole suite (about 19 minutes; CI shards it)
```

Single tests (Vitest, `fileParallelism: false`):

```sh
pnpm vitest run server/routes/workflows.test.ts
pnpm vitest run shared/workflow.test.ts -t "cycle"
pnpm test:electron                                   # electron/*.node-test.mjs via node --test
node --test electron/capabilities.node-test.mjs      # one Electron file
```

Server and shared code must stay erasable-TypeScript (`erasableSyntaxOnly`): no enums, namespaces or constructor parameter properties.

## Architecture

Two processes. The React app in `src/` holds no transports. It sends typed HTTP commands and folds one SSE event stream into state. The harness server in `server/` owns every agent process.

- `server/index.ts` (about 16k lines) is the HTTP/SSE API. Handlers live in `server/routes/*` (a route table, see `routes/table.ts`) and in feature modules beside it.
- `server/contracts.ts` is the driver SPI. Each provider is one file in `server/drivers/` plus a registration. A driver normalizes its CLI's native protocol (stream-JSON, JSON-RPC, ACP) into the canonical runtime event stream in `shared/runtime-events.ts`. Unknown drivers degrade to "unavailable" and never crash the fleet. Custom engines are config-only (`docs/custom-engines.md`).
- `server/harness/` holds the registry (config to live instance) and the fan-in event bus.
- `server/runtime/` is the single job runtime for all bot-to-bot work: one `Assignment` record, one lifecycle, one wake lane, SQLite-backed (`runtime.db`). `docs/runtime-contract.md` is the spec, and nothing outside this module may hold work state of its own.
- `shared/` is code and wire types used by both server and renderer. Doc comments on these types are the public contract.
- `electron/` is the desktop shell with an embedded harness. Most files are `.mjs` with `.node-test.mjs` siblings.
- `companion/`, `connector/`, `cloudflare/` (Composio broker, control plane), `apps/docs/` (Next.js docs site, its own `AGENTS.md`), `evals/`.
- `extensions/open-team/` is the Apache-licensed local feature module (whitelabel, budgets, billing) that replaces upstream's source-available Enterprise directory. It is wired in by `server/enterprise.ts` and configured through `$OMB_DATA_DIR/open-team.json`.

Workflows (the fork's headline feature) span layers:
- `shared/workflow.ts` holds the graph types, `validateWorkflow` and `executeWorkflow`. Edges are unconditional, an exact-substring `contains`, or an AI `condition` (never both).
- `server/routes/workflows.ts` has the zod-validated API and run/task queue. `server/workflow-condition.ts` runs AI edge checks. `server/workflow-telegram.ts` handles Telegram interaction.
- `src/components/WorkflowEditor.tsx` is the drag-and-drop canvas.
- User behaviour is documented in `docs/verification/workflows.md`.

## Testing conventions

- `*.e2e.test.ts` files start a real server with fake engines (`server/testing/fake-*.ts`). They run only on Linux in CI unless listed in `scripts/testing/host-e2e.ts`. A new e2e file with a test Linux skips must be listed there, or `host-e2e.test.ts` fails.
- `server/testing/setup.ts` gives every test file a throwaway `HOME` and clears `OMB_DATA_DIR`, so tests never touch `~/.openmausbot`.
- Which CI jobs run for a change is decided by `scripts/ci-scope.mjs` (`docs/ci.md`). Adding a server import of a renderer file means updating `SRC_OUTSIDE_RENDERER`.
- User-visible strings go in `src/locales/en.json`. Other catalogs are generated and reviewed (`scripts/generate-locale.mjs`), and `pnpm i18n:check` fails on stale ones.

## Verifying server or conversation changes

Do not claim a server or conversation change works from unit tests alone. Follow `docs/verification/README.md`:

```sh
node --experimental-strip-types scripts/control-omb.ts launch                   # isolated fixture, prints URL, PID, data dir
pnpm control:omb doctor --url http://127.0.0.1:PORT                             # pass the printed URL explicitly
```

The fixture uses a temporary data dir and home, free ports and only the fake engine. Mutating `control:omb` commands refuse port discovery on purpose, so they never hit the user's live app. Run `launch` directly rather than via `pnpm` so Ctrl-C reaches it. Each feature area has a recipe under `docs/verification/`, and `.claude/skills/verify-omb` points at the same guide.
