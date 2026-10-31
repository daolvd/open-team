# Chief-authored worker processes

A Chief can use `get_bot_process` and `set_bot_process` for itself and bots
within its existing management authority and reach. Saving replaces the role,
working instructions and graph shown in **Design bot**, including parallel
branches, joins and text conditions. Set `design.enabled` to enable or disable the saved process; omitting it preserves
the enabled switch. Saving does not start execution.

For example, ask a Chief: “Create an engineer in `/absolute/project/path`.
Define inspect → parallel implementation/review → report, and have it save
verified project facts with memory_update.” The Chief can use `create_bot` with
`cwd` for a new project worker, or `start_thread` with `folder` for a conversation
of an existing worker. These directories must already exist.

Memory is enabled by default. Each bot keeps its own `MEMORY.md` and `memory/`
under the application's `workspaces/<bot-id>/`, separate from its project
directory. `memory_update`, `memory_log` and `session_search` provide durable
notes and recall across conversations. Reading a worker's process returns its
memory location and enabled state, not its private notes.

Run the isolated, real-server/MCP workflow:

```sh
pnpm exec vitest run server/bot-process-authoring.e2e.test.ts
```

The shared launcher gives the test a temporary home, project directory and fake
engine. The test drives `control-omb` turns through the injected MCP tools: a
Chief creates a worker, reads and saves its process, and the ordinary design
API sees that same graph. A disabled process refuses to run. After the Chief enables it through MCP, two process steps execute in separate conversations; the
worker writes in the project directory, saves a memory fact, and recalls it in
another fresh conversation. The Chief does not receive that private fact.
The test prints a retained evidence JSON path beside the server log.

Additional checks:

```sh
pnpm exec vitest run server/routes/internal-bot-process.test.ts server/drivers/agents-process-tools.test.ts src/components/bot-design-state.test.ts
```

These check Chief authority, expired turn capabilities, invalid graphs, shared
UI persistence, and renderer polling: Chief edits appear automatically when the
person has no unsaved draft; local edits survive a concurrent Chief revision.
The scripted engine proves transport, execution and persistence, not a paid
model's planning quality or real project implementation.

## Graph execution and reusable recipes

[Editable recipes](../process-recipes/README.md) cover application development
and visual artifact review. Map executor bots, supported models and their
existing tool/computer profiles before enabling them. The engine remains a
general graph; these recipes do not impose a fixed process on other bots.

```sh
pnpm exec vitest run shared/process-run.test.ts server/routes/bot-design.test.ts
pnpm exec vitest run server/bot-process-autorun.e2e.test.ts server/workflow-routing.e2e.test.ts
```

The autorun fixture proves Chief delegation, FAIL feedback followed by PASS,
and return to the Chief. It also executes the Transformer recipe with three
independent reviewers: all three start on the same revision before any is
released, and their outputs reach the aggregate. An unavailable owner channel
rejects approval, skips delivery and routes to escalation. Evidence is retained
beside the fixture log as `.transformer-kanban.json`.

Focused regressions cover absent/malformed verdicts, aggregate fan-out failure,
bounded retries, cancellation of all active conversations and engine backoff,
parallel joins before feedback, and loop exhaustion without a valid escalation.
Explicit owner rejection, timeout and offline behavior must not select delivery.
These fixtures use disposable homes and fake engines; they do not prove paid
model judgment or actual mouse/keyboard/screenshot operation. Verify computer
transport separately with [local computer launch](local-computer-launch.md).
