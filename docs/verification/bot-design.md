# Bot design and skill controls

Run the real renderer with the shared isolated launcher:

```sh
OMB_UI_EVIDENCE_DIR=.omb-scratch/design-evidence pnpm exec vitest run scripts/testing/control-omb-ui.e2e.test.ts -t 'saves bot design, runs sequential steps and persists native skill switches'
```

The test owns its temporary home, data directory, fake Claude engine and browser.
It never changes the user's running app or installed Claude skills. Screenshots
and the process run JSON are retained in the evidence directory.

The UI check opens **Bot's screen → Design bot**, saves identity, method and an
enabled two-step process, then runs both steps in the same conversation. Each
step must report completed status and the fake engine's actual output. The next
step waits for the previous turn to release its conversation.

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
failure halting, cancellation, restart recovery and proposal validation. Driver
checks inspect the actual arguments/settings sent to synthetic CLI processes.
These checks prove application wiring and persistence with fake engines; they
do not establish that a paid model will follow a process correctly.

Local skill drops use the existing SKILL.md installer and start disabled for
review. Supporting scripts are not installed. Claude individual skill visibility
uses [skillOverrides](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings);
plugin-provided skills remain subject to the CLI's plugin controls.
