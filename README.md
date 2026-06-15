# lark-cli-plus

`lark-cli-plus` is a small skillhub for engineering repeatable workflows on top of `lark-cli`.

Brand direction: **LarkForge**. The repo can keep the practical name `lark-cli-plus`, while the project voice can describe the work as "forging Feishu/Lark CLI operations into reusable engineering workflows."

## Skills

- `lark-doc-formatter`: format and polish Feishu/Lark Docx or Wiki documents through `lark-cli`, including heading cleanup, emphasis rules, highlight removal, inline code styling, resource preservation, and post-edit validation.

## Repository Layout

```text
skills/
  lark-doc-formatter/
    SKILL.md
    agents/openai.yaml
    references/
    scripts/
```

## Usage

Install or expose the skill directory to Codex, then invoke:

```text
Use $lark-doc-formatter to clean up and format this Feishu document: <doc-url>
```
