# Telegram output and phone forms

Run the real server with the repository's fake CLI and a loopback Telegram API:

```sh
node --experimental-strip-types scripts/verify-telegram.ts
node --experimental-strip-types scripts/verify-telegram-preview.ts
```

The first recipe launches its own disposable home/data directory and intercepts
only its synthetic bot token. It configures direct bot routing with the workflow
disabled, sends a command, chooses an inline option, replies to a text question,
checks the persisted answers, receives the original file, and continues in the
same bot thread. It also checks that queue/start notices are absent and typing
appears during processing, pauses for phone input and stops after completion.
A last command has the bot call `send_telegram` twice with the same progress
line: the first arrives before the final reply, the second is refused as a
repeat and never reaches Telegram. The bounded
control-surface transcript, answers, delivery metadata and server log path are
recorded in `.omb-scratch/telegram-evidence.json`.

The preview recipe launches Chrome in a disposable profile, renders untrusted
HTML without scripts or external requests, checks a loopback resource trap stays
untouched, and saves `.omb-scratch/telegram-html-preview.png`. Inspect that image:
it must show the styled project form and “Scripts blocked”, never “EXECUTED”.

Focused regression checks:

```sh
pnpm exec vitest run server/workflow-telegram.test.ts server/workflow-conversation.test.ts server/workflow-files.test.ts server/routes/workflows.test.ts
```

These cover media uploads and document fallback, multi-select/text forms,
unauthorized and stale answers, cancellation, scoped file access and continuation.

Forms use native Telegram buttons/replies, support one to six fields, and expire
after 30 minutes. Permission and credential cards still require the app. Files
retain the conversation's 25 MB limit; supported media render inline, other
formats arrive as documents. HTML arrives as the original file and a static
preview when Chrome is available. Interactive HTML is not embedded in a message.

These fixtures prove server integration against a synthetic Telegram API, not
delivery to a real account or Google/provider sign-in. Never use the person's
running desktop, Telegram token, or live chats as a mutation fixture.
