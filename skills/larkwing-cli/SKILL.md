---
name: larkwing-cli
description: Discover, preview, and run reusable Feishu/Lark workflows and templates through larkwing-cli. Use when a user asks an agent to create, copy, or fill a Feishu template; turn meetings into actions; prepare weekly meetings; create project kickoff, knowledge, or SOP documents; synchronize a personal activity inbox; browse available larkwing workflows/templates; or invoke any capability shipped in the larkwing-cli catalog.
---

# Larkwing CLI

Use `larkwing-cli` as the discovery and execution layer for reusable Feishu workflows. Never rely on a hard-coded template list; query the installed version so newly shipped workflows are available automatically.

## Command selection

Use `larkwing` when it is on `PATH`. Otherwise use this prefix:

```bash
npx --yes github:MondayLabOS/larkwing-cli#codex/personal-memory-template
```

After the package is published to npm, prefer `npx --yes larkwing-cli` as the fallback.

## Discover capabilities

Before choosing a workflow for an ambiguous request, inspect the current catalog:

```bash
larkwing workflow list --json
larkwing template list --json
```

Inspect a likely match when its inputs or delivery mode are unclear:

```bash
larkwing workflow show <workflow-id> --json
larkwing template show <template-id> --json
```

Use `workflow` for multi-step behavior and live synchronization. Use `template` for reusable local artifacts or Wiki copies. Natural-language routing may select either:

```bash
larkwing "<user request>" --json
```

## Run safely

1. Start with the default dry-run unless the user explicitly asks to create, copy, publish, or synchronize online data.
2. Use `--with-live-data` only when the user wants a read-only preview from Feishu.
3. Add `--execute` only when the user clearly authorizes the resulting online writes.
4. Pass `--profile <name>` when the user names a lark-cli profile or multiple accounts may exist. Never change the globally active lark-cli profile.
5. Pass structured inputs with repeated `--set key=value` flags.
6. Prefer `--json` so status, missing inputs, warnings, evidence, and outputs can be checked reliably.

Example:

```bash
larkwing run "同步个人收件箱" \
  --workflow personal-inbox \
  --profile <profile> \
  --with-live-data \
  --json
```

## Handle results

- `dry_run` or `live_preview`: summarize what would happen and ask before adding `--execute` when writes are needed.
- `needs_input`: ask only for the missing values returned by the CLI.
- `needs_auth`: show the exact authorization command returned by the CLI. Keep user identity; never fall back to bot identity for personal resources.
- `partial`: report counts and warnings, and explain that the sync cursor was not advanced.
- `complete`: return the created Base/document URL and the new, updated, and skipped counts when present.
- `error`: report the actionable error without retrying destructive or high-risk operations automatically.

## Personal memory card interactions

When `personal-inbox` completes with `review.delivery.sent=true`, explain that its interactive buttons need a live local callback listener. Confirm that the Feishu app has `card.action.trigger` enabled, then start the listener while the user operates the card:

```bash
larkwing memory listen \
  --profile <profile> \
  --max-events 2 \
  --timeout 10m \
  --json
```

Keep the process alive until it reports the final result. One complete “Keep highlights” or “Adjust followed communities” interaction normally produces two events. If the card reports that the callback service is offline, restart the listener and ask the user to click the newest card. Do not imply that buttons remain active when no local listener or hosted callback service is running.

Do not download message attachments or reproduce full private message bodies unless a separately selected workflow explicitly requires it.
