# Team workflows

## Configure a team

Open **Team map → Workflow**. Add bots as steps, drag their headers to arrange
them, then drag **Output** onto a destination step. The step inspector also
offers a **Next step → Connect** control and numeric positions for keyboard use.
Select a connection to set **Required text**; an empty field always passes the
result. Text matching is case sensitive.

Choose a **Lead bot**, write each step's instruction, and save. **Configure bot**
opens that bot's existing identity, standing instructions, engine, project
folders, skills and tool settings. These settings apply to workflow turns too.
Use **Settings → Engines → Scan CLI skills and MCP** to reuse Claude/Codex
configuration, including configured Playwright and browser-use servers. Skills
and MCP servers are imported independently; review and enable imported MCP
servers for each bot. Custom skills can also be imported in the skill library
and assigned to bots.

## Run and inspect

Workflows start **paused**, including configurations saved before the enable
setting existed. Save your graph, then select **Enable workflow**. Enter the
team task and select **Run workflow**. Independent steps run in
parallel. A join waits for all predecessors and receives the matching completed
reports. Failed predecessors skip their direct dependents; unmatched branches
are skipped. Cycles and duplicate connections cannot be saved. The lead bot
summarizes the results, including failures, in a separate conversation.

Open each step's conversation or the lead's summary from the run panel. The
last 20 runs retain their workflow snapshot. After a server restart, unfinished
runs become **interrupted** and are not replayed automatically.

## Task manager

The **Tasks** tab contains an add-task form and a table of title, assignee,
priority, status and results. Assign either one bot or the entire saved
workflow. Tasks can be queued while paused; enabling starts the queue. One task
runs at a time, highest priority first, then oldest first. Parallel branches
within a workflow still execute together. The server must remain running.

Use **View output & instructions** or **Open conversation** to inspect results.
Filter active/completed/failed/interrupted rows, cancel queued tasks, or retry
failed/interrupted tasks. Disabling finishes the current task and holds queued
work. A restart marks active tasks interrupted; queued tasks resume only if the
saved workflow is enabled. The queue allows 100 pending tasks and retains the
latest 100 finished tasks when adding new work.

Bots can use **create_task** to queue work for themselves or a reachable teammate,
and **list_tasks** to read tasks they created or received. The table records the
creator and assignee. Tasks run asynchronously: the bot must finish its current
turn and check results in a later turn. A turn may create five tasks; delegation
is limited to four levels and cannot return work to an ancestor. The bot's peer
permissions still apply. Bot-created tasks also wait for **Enable workflow**.

## Telegram input and output

Open **Telegram**. Create a dedicated bot with **@BotFather**, enter its token,
the numeric chat ID and your allowed numeric user ID. **Message routing** offers:

- **Talk directly to a bot**: choose the recipient, including a fixture bot in
  an isolated workspace. Successive messages from the same chat and user to that
  bot reuse its conversation. No workflow steps or lead summary run.
- **Run connected workflow steps**: select a saved input step. Each command
  starts there and follows its descendants. Unrelated branches and predecessors
  do not run. The lead still summarizes.

Start a chat with the Telegram bot, connect, and enable the workflow. Only text
from that user in that chat is accepted. Each message becomes a normal-priority
task, including direct conversations. The isolated fixture engine returns scripted
responses; select a configured real engine for AI conversation.

Telegram receives the task receipt, starts, every completed step's text output,
skipped steps, failures and final summary. App-created tasks and manual workflow
runs also report there. Long messages are split into chunks. Conversations and
task results remain available in the app if Telegram delivery fails; attachments
and live tool streams are not forwarded. Replies from the bot are not task input.

The bridge uses the [Telegram Bot API](https://core.telegram.org/bots/api)'s
long polling; no public callback URL is needed. An existing webhook is refused,
and the bot must not have another poller. Commands pending when polling starts
or is re-enabled are discarded. The token is saved separately in
`workflow-telegram.json` with owner-only file permissions and omitted from API
responses. **Disconnect Telegram** removes this connection file.

## Isolated verification

```sh
pnpm exec vitest run shared/workflow.test.ts server/routes/workflows.test.ts server/workflow-telegram.test.ts server/setup-import.test.ts
pnpm exec vitest run server/index.test.ts -t 'bot-created workflow tasks'
OMB_UI_E2E=1 OMB_UI_EVIDENCE_DIR=.omb-scratch/workflow-evidence pnpm exec vitest run scripts/testing/control-omb-ui.e2e.test.ts -t 'parallel workflow'
```

The UI test owns a disposable server, home and fake CLI. It moves steps and
connects branches with real pointer input, saves and reopens the graph, runs
three steps and the lead summary both from the task queue and manually, opens
the resulting conversation, and checks desktop/mobile layout and browser errors.
It fills the Telegram form with synthetic values without contacting Telegram.
It writes `workflow-{desktop,mobile}.png`, `workflow-tasks-{desktop,mobile}.png`
and `workflow-telegram-{desktop,mobile}.png`, plus
`workflow-telegram-direct-{desktop,mobile}.png`, then stops its exact child.

Route tests cover conditional routing, parallel joins, failure propagation,
authorization, duplicate-run rejection, persistence, interrupted recovery,
enable/disable, task priority, retry and cancellation. A synthetic Telegram
transport verifies authorized routing, direct-bot conversation continuity,
entry-step dispatch, long-message
splitting and delivery of receipts, step outputs, failures and summaries.
Delegation tests cover creator identity, peer permissions, turn limits,
ancestry limits and capabilities expiring during request-body reads.
Import tests discover synthetic Claude/Codex skills and CLI MCP configurations,
including nested Zcode servers. [Zcode's native fixture](zcode.md) checks its driver.
These checks do not invoke real provider accounts or external browser MCPs.
