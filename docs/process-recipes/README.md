# Editable process recipes

These are starting graphs, not mandatory runtime stages. Different bots can
save different processes. Edit steps, branches, conditions, joins and bounded
feedback in **Design bot**, or save the graph with `set_bot_process` using a
Chief that has authority over the target bot. Saving does not run it. These
JSON files are examples, not an automatically loaded registry or a file-import UI.

| Recipe | Scope | Decision gate |
| --- | --- | --- |
| [build-app.json](build-app.json) | Plan, implement, parallel code/test review, local app handoff | No owner gate by default |
| [transformer-kanban.json](transformer-kanban.json) | Visual/interaction/code review of an artifact revision | Batched owner approval, timeout rejects |

## Map before enabling

1. Set the target bot's project folder, engine, tools and Computer setting in
   its existing profile. A process does not grant missing tools or permissions.
2. Map each step's `botId` to an authorized executor. Omission uses the process
   bot. Use different reviewer bots when independent review is required.
   `askBotId` chooses an adviser; it does not change the executor.
3. Map `model` and `effort` to choices supported by each executor's engine.
   The recipes leave model names open; effort alone does not select a smaller
   model. Use a strong planner/scorer and a smaller builder when appropriate.
4. Adapt acceptance, allowed paths and revision evidence to the project. Keep
   reviewers on the same frozen output. Join every required branch before
   looping to the builder. Exhaustion routes to escalation, never delivery.
5. Enable and run on an isolated project first. Enable `autoRun` and its matching
   rule only when delegated work should use this graph. Ordinary direct chat
   remains a normal turn.

Tool and computer selection are inherited from the executor bot, not separate
per-step tool grants. Parallel reviewers should read immutable artifacts; a
shared editor or desktop needs one writer at a time. Set Computer to off for
work that only needs repository tools. Use browser/computer tools when the
acceptance requires real interaction, and report unavailable capabilities.

Add approval only where the project requires a human decision, such as a
protected integration or publication. Existing project approvals still apply.
These examples deliver artifacts locally; they do not authorize deployment.

See [verification](../verification/bot-process-authoring.md) for the isolated
server checks and the limits of their scripted engines.
