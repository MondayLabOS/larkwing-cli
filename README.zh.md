# larkwing-cli

[English](./README.md)

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

自然语言路由：

```bash
larkwing "MondayLab 2026-W26 周会"
larkwing "帮我创建一份 MondayLab 的 2026-W26 周会文档"
```

也可以用 `--set` 显式覆盖自动识别出来的参数：

```bash
larkwing "准备本周业务周会" --set week=2026-W26 --set team=Operations
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

CLI runtime 和 skill library 是互补关系：工作流负责创建和编排资产，skill 负责某些垂直场景里的深度编辑策略。
