# larkwing-cli

[中文说明](./README.md)

`larkwing-cli` is a workflow product layer on top of `lark-cli`.

It does not try to replace Feishu/Lark CLI commands. Its job is to turn reusable team workflows into natural-language callable operations, then render the right documents, checklists, and `lark-cli` calls behind the scenes.

## Positioning

`lark-cli` is the capability layer:

- create docs
- read meetings
- update tasks
- query Base records
- send messages

`larkwing-cli` is the workflow layer:

- prepare a weekly meeting
- turn a meeting note into action items
- start a project kickoff pack
- create a knowledge-base article
- create an SOP document

## Install

### 1. Install lark-cli first

`larkwing-cli` uses the official `lark-cli` as its execution layer. You can preview workflows without it, but `--execute` requires `lark-cli` to be installed, authenticated, and updated.

```bash
npm install -g @larksuite/cli
lark-cli auth login
lark-cli update
```

Check your installation:

```bash
command -v lark-cli
lark-cli --version
```

### 2. Install larkwing-cli from this repository

```bash
npm install
npm run build
npm link
```

Then run:

```bash
larkwing workflow list
```

For local development:

```bash
npm run check
npm run build
node ./bin/larkwing.js workflow list
```

## Usage

Dry-run is the default mode. It generates local artifacts and prints the `lark-cli` commands that would run:

### Start without a goal: Teacher Agent

Run `larkwing` with no prompt to get scene-based guidance. A vague description can also be passed to the dedicated command:

```bash
larkwing
larkwing teacher "I have too many meetings and project updates"
larkwing teacher "I do not know where to start" --json
```

Teacher Agent asks for the outcome in plain terms, recommends a few relevant workflows or templates, and returns copy-ready commands. Unmatched natural-language prompts fall back to this guide instead of throwing `No workflow matched`.

Natural-language routing:

```bash
larkwing "MondayLab 2026-W26 周会"
larkwing "帮我创建一份 MondayLab 的 2026-W26 周会文档"
```

You can still override extracted inputs explicitly:

```bash
larkwing "准备本周业务周会" --set week=2026-W26 --set team=Operations
```

Document templates follow the prompt language by default: Chinese prompts render Chinese documents, and English prompts render English documents. You can override this explicitly:

```bash
larkwing "Create a MondayLab 2026-W26 weekly meeting document" --set language=zh
larkwing "帮我创建一份 MondayLab 的 2026-W26 周会文档" --set language=en
```

Force a specific workflow:

```bash
larkwing run "启动项目" \
  --workflow project-kickoff \
  --set project_name="Internal Workflow Hub" \
  --set owner="Zijie"
```

Agent-friendly JSON output:

```bash
larkwing run "把会议纪要变成行动项" \
  --set source_url="https://example.feishu.cn/docx/xxx" \
  --json
```

Execute generated `lark-cli` commands:

```bash
larkwing run "创建 SOP" \
  --workflow sop-document \
  --set process_name="Customer Handoff" \
  --execute
```

By default, `larkwing` runs in dry-run mode. It writes rendered artifacts under `.larkwing/runs/` and prints the commands it would execute.

If `lark-cli` is not installed, dry-run commands still work. Only `--execute` requires the official CLI:

```text
larkwing-cli requires lark-cli when running with --execute.

Install lark-cli:
  npm install -g @larksuite/cli

Authenticate:
  lark-cli auth login

Update skills:
  lark-cli update
```

## Built-in Workflows

- `meeting-to-actions`: create an action-plan document from a meeting note or transcript URL.
- `weekly-meeting`: create a weekly meeting agenda and review document.
- `project-kickoff`: create a kickoff document and launch checklist.
- `knowledge-article`: create a reusable wiki-style knowledge article.
- `sop-document`: create a standard operating procedure document.

## Template Catalog

`larkwing` can also wrap existing Feishu Wiki template libraries. The bundled MondayLab creative toolbox catalog supports Docx and Base/Bitable templates by copying the source Wiki node:

```bash
larkwing "I need a work daily report template"
larkwing "我要一个工作日报模板"
larkwing "给我一个 OKR 模板"
larkwing template list
larkwing template search "OKR"
larkwing template show work-daily-report
larkwing template copy "工作日报"
larkwing template copy "工作日报" --set target_parent_node_token=<wiki_node_token> --set title="本周工作日报" --execute
```

Natural-language template requests copy to `my_library` by default. Copy is dry-run by default; add `--execute` only when the target is correct.

### Ten everyday work templates

The starter kit also includes ten locally generated document templates. They do not require a source Wiki node. `template use` selects the right delivery mode automatically: remote templates are copied, while local templates render a Markdown artifact and can create a Feishu document with `--execute`.

```bash
larkwing template use weekly-priority-plan
larkwing template use customer-visit-notes --set customer="Example customer" --set owner="Alex"
larkwing template use work-handover-checklist --json
```

- `weekly-priority-plan`: one-page weekly priorities
- `daily-team-update`: daily team update
- `meeting-decision-log`: meeting decisions and actions
- `customer-visit-notes`: customer visit notes
- `project-progress-brief`: project status brief
- `four-question-retrospective`: lightweight retrospective
- `new-hire-30-day-plan`: new-hire 30-day plan
- `content-publish-checklist`: content publishing checklist
- `expense-reimbursement-checklist`: reimbursement materials checklist
- `work-handover-checklist`: work handover checklist

Use `template create` for local templates only and `template copy` for Wiki templates only.

List them:

```bash
larkwing workflow list
```

Inspect one:

```bash
larkwing workflow show project-kickoff
```

## Workflow Schema

Workflows live in `workflows/*.json`.

```json
{
  "id": "project-kickoff",
  "name": "项目启动包",
  "category": "project",
  "description": "Create a project kickoff document and task checklist.",
  "titleTemplate": "{{project_name}} Kickoff",
  "intents": {
    "keywords": ["项目启动", "kickoff", "project"],
    "examples": ["启动一个新项目", "create project launch checklist"]
  },
  "requiredInputs": [
    {
      "name": "project_name",
      "description": "Project name."
    }
  ],
  "artifacts": [
    {
      "name": "kickoff_doc",
      "filename": "project-kickoff.md",
      "template": "# {{project_name}} Kickoff\n"
    }
  ],
  "steps": [
    {
      "id": "create-kickoff-doc",
      "name": "Create kickoff document",
      "command": "lark-cli docs +create --api-version v2 --as user --title {{shell.workflowTitle}} --doc-format markdown --content @{{shell.artifacts.kickoff_doc}}"
    }
  ],
  "outputs": ["doc_url"]
}
```

Template variables use `{{name}}`. Shell command values should use `{{shell.name}}` or `{{shell.artifacts.name}}` so paths and spaces are escaped safely.

## Existing Skills

This repo also keeps specialized Codex skills under `skills/`.

- `skills/lark-doc-formatter`: controlled Feishu/Lark document formatting through `lark-cli docs --api-version v2`.
- `skills/knowledge-base-organizer`: full-inventory reorganization for local notes or Feishu/Lark knowledge bases, with directory-first planning, verified 2–3-page editing batches, and final coverage audits.

The CLI runtime and the skill library are complementary: workflows create and orchestrate assets, while skills can provide deeper editing policies for specific domains.
