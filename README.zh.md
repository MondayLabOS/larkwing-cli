# larkwing-cli

[English](./README.en.md)

`larkwing-cli` 是构建在官方 `lark-cli` 之上的工作流产品层。

它不是为了替代飞书 / Lark CLI 的底层命令，而是把团队里可复用的文档、任务、会议、知识库、SOP 等流程，封装成可以用自然语言调用的工作流。

## 定位

`lark-cli` 是能力层：

- 创建文档
- 读取会议
- 更新任务
- 查询多维表格
- 发送消息

`larkwing-cli` 是工作流层：

- 准备周会
- 把会议纪要变成行动项
- 创建项目启动包
- 创建知识库文章
- 创建 SOP 标准流程文档

## 安装

### 1. 先安装 lark-cli

`larkwing-cli` 底层依赖官方 `lark-cli` 执行飞书操作。没有安装 `lark-cli` 时，仍然可以使用 dry-run 预览工作流；但真正执行 `--execute` 时必须先完成安装、登录和更新。

```bash
npm install -g @larksuite/cli
lark-cli auth login
lark-cli update
```

检查安装结果：

```bash
command -v lark-cli
lark-cli --version
```

### 2. 从当前仓库安装 larkwing-cli

```bash
npm install
npm run build
npm link
```

然后运行：

```bash
larkwing workflow list
```

本地开发常用命令：

```bash
npm run check
npm run build
node ./bin/larkwing.js workflow list
```

## 使用方式

默认是 dry-run 模式，只会生成本地 artifact，并打印将要执行的 `lark-cli` 命令，不会直接写入飞书。

### 不知道从哪里开始：Teacher Agent

直接运行 `larkwing`，Teacher Agent 会从日常工作场景开始引导，不要求用户先想好完整目标：

```bash
larkwing
larkwing teacher "我最近周会很多，项目也有点乱"
larkwing teacher "不知道要做什么" --json
```

它遵循一个轻量引导流程：

1. 先问用户最想处理的事情，而不是要求填写抽象目标。
2. 根据会议、项目、日常安排、客户、内容、新人、复盘、报销等场景推荐 1～4 个入口。
3. 每个入口都给出用途和可直接复制的命令。
4. 信息仍不足时，只追问期望产出是文档、清单、计划还是行动项。

自然语言没有匹配到现有工作流时，也会自动进入 Teacher 引导，不再直接报 `No workflow matched`。

自然语言路由：

```bash
larkwing "MondayLab 2026-W26 周会"
larkwing "帮我创建一份 MondayLab 的 2026-W26 周会文档"
```

也可以用 `--set` 显式覆盖自动识别出来的参数：

```bash
larkwing "准备本周业务周会" --set week=2026-W26 --set team=Operations
```

文档模板默认跟随用户语言：中文 prompt 生成中文文档，英文 prompt 生成英文文档。也可以显式覆盖：

```bash
larkwing "Create a MondayLab 2026-W26 weekly meeting document" --set language=zh
larkwing "帮我创建一份 MondayLab 的 2026-W26 周会文档" --set language=en
```

指定工作流：

```bash
larkwing run "启动项目" \
  --workflow project-kickoff \
  --set project_name="Internal Workflow Hub" \
  --set owner="Zijie"
```

给 Agent 使用的 JSON 输出：

```bash
larkwing run "把会议纪要变成行动项" \
  --set source_url="https://example.feishu.cn/docx/xxx" \
  --json
```

真正执行生成的 `lark-cli` 命令：

```bash
larkwing run "创建 SOP" \
  --workflow sop-document \
  --set process_name="Customer Handoff" \
  --execute
```

如果执行时没有安装 `lark-cli`，CLI 会提示：

```text
larkwing-cli requires lark-cli when running with --execute.

Install lark-cli:
  npm install -g @larksuite/cli

Authenticate:
  lark-cli auth login

Update skills:
  lark-cli update
```

## 内置工作流

- `meeting-to-actions`：基于会议纪要或转写链接生成行动计划文档。
- `weekly-meeting`：创建周会议程和复盘文档。
- `project-kickoff`：创建项目启动文档和启动检查清单。
- `knowledge-article`：创建可沉淀到知识库的文章模板。
- `sop-document`：创建 SOP 标准流程文档。

## 模板目录

`larkwing` 也可以封装已有的飞书 Wiki 模板库。内置的 MondayLab 创意工具箱 catalog 支持 Docx 和多维表格模板，本质是复制源 Wiki 节点：

```bash
larkwing "我要一个工作日报模板"
larkwing "给我一个 OKR 模板"
larkwing "生成一份面试投递记录表"
larkwing template list
larkwing template search "OKR"
larkwing template show work-daily-report
larkwing template copy "工作日报"
larkwing template copy "工作日报" --set target_parent_node_token=<wiki_node_token> --set title="本周工作日报" --execute
```

自然语言模板请求默认复制到 `my_library`。复制默认是 dry-run；只有确认目标正确后，再加 `--execute` 真正复制。

### 10 个日常工作模板

新增的模板是本地生成型，不依赖已有 Wiki 节点。`template use` 会自动判断：远程模板走 Wiki 复制，本地模板先生成 Markdown artifact，再通过 `--execute` 创建飞书文档。

```bash
larkwing template use weekly-priority-plan
larkwing template use customer-visit-notes --set customer="示例客户" --set owner="小王"
larkwing "给我一个工作交接清单" --json
```

- `weekly-priority-plan`：一页纸周计划
- `daily-team-update`：每日工作同步
- `meeting-decision-log`：会议决策与待办记录
- `customer-visit-notes`：客户拜访记录
- `project-progress-brief`：项目进度简报
- `four-question-retrospective`：四问轻量复盘
- `new-hire-30-day-plan`：新人 30 天上手计划
- `content-publish-checklist`：内容发布检查清单
- `expense-reimbursement-checklist`：报销材料检查清单
- `work-handover-checklist`：工作交接清单

统一入口：

```bash
larkwing template use <id>       # 自动复制或生成，默认 dry-run
larkwing template create <id>    # 只接受本地生成型模板
larkwing template copy <id>      # 只接受远程 Wiki 模板
```

查看所有工作流：

```bash
larkwing workflow list
```

查看单个工作流：

```bash
larkwing workflow show project-kickoff
```

## 工作流定义

工作流定义放在 `workflows/*.json`。

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

模板变量使用 `{{name}}`。Shell 命令里的值建议使用 `{{shell.name}}` 或 `{{shell.artifacts.name}}`，这样路径和空格会被安全转义。

## 已有 Skill

仓库里也保留了一些更专门的 Codex Skill：

- `skills/lark-doc-formatter`：通过 `lark-cli docs --api-version v2` 对飞书 / Lark 文档做受控格式化。
- `skills/knowledge-base-organizer`：全量盘点本地笔记或飞书 / Lark 知识库，依次确认目录、正文改动级别和样稿，默认保留旧文档并另建整理版，按每批 2–3 篇回读验收，最后审计原文保全与整库覆盖。

CLI runtime 和 skill library 是互补关系：工作流负责创建和编排资产，skill 负责某些垂直场景里的深度编辑策略。
