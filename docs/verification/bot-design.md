# Bot design and skill controls

Run the real renderer with the shared isolated launcher:

```sh
OMB_UI_EVIDENCE_DIR=.omb-scratch/design-evidence pnpm exec vitest run scripts/testing/control-omb-ui.e2e.test.ts -t 'saves bot design, connects parallel steps and persists native skill switches'
```

The test owns its temporary home, data directory, fake Claude engine and browser.
It never changes the user's running app or installed Claude skills. Screenshots
and the process run JSON are retained in the evidence directory.

The UI check opens **Bot's screen → Design bot** and verifies that an empty
canvas is visible immediately, without creating saved steps. It creates and
removes the first node, opens **Role & instructions**, and saves identity, method
and an enabled diamond-shaped process. It removes a connection and recreates it by
dragging an Output port to an Input port, edits a text condition, moves a node
and checks saved positions and connections.

Each graph step opens its own conversation. After the plan, the two review
steps must overlap in time, and the final step must wait for both results.
Selecting a completed node shows the fake engine's actual output. Screenshots
cover empty and populated desktop and phone layouts, including horizontal page overflow.

Designs saved without an `edges` property retain their sequential execution and
shared conversation. An explicit empty `edges` array starts all steps as roots.
Independent branches run up to the bot's conversation limit; excess steps wait.
Connections reject cycles, duplicates and missing nodes. Conditions use
case-sensitive text matching; a join waits for all predecessors and receives
matching outputs. A failed predecessor skips its dependent nodes. Stop cancels
waiting steps and interrupts each active branch conversation.

It then checks native skill controls in both **Design bot → Skills** and
**Profile → Library → Skills**. Disable all must turn off every listed skill;
enabling one must leave the others off. Reloading must preserve the selected
skill. Desktop and phone screenshots check both surfaces and horizontal overflow.

Additional regression checks:

```sh
pnpm exec vitest run server/routes/bot-design.test.ts server/native-skills.test.ts server/imported-skills.test.ts src/components/SkillsSection.behavior.test.ts src/components/ComputerPanel.tabs.test.ts
pnpm exec vitest run server/drivers/claude.test.ts server/drivers/codex.test.ts -t 'enforces all-skills-off|disables native skill files'
pnpm lint
pnpm i18n:check
pnpm build
```

Route checks cover unique step IDs, saved snapshots, ordered output handoff,
parallel branches, conditional joins, cancellation, restart recovery and proposal validation. Driver
checks inspect the actual arguments/settings sent to synthetic CLI processes.
These checks prove application wiring and persistence with fake engines; they
do not establish that a paid model will follow a process correctly.

Local skill drops use the existing SKILL.md installer and start disabled for
review. Supporting scripts are not installed. Claude individual skill visibility
uses [skillOverrides](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings);
plugin-provided skills remain subject to the CLI's plugin controls.
