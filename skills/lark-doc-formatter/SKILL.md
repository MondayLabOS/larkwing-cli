---
name: lark-doc-formatter
description: Format and polish Feishu/Lark Docx or Wiki documents through lark-cli. Use when Codex needs to clean up a Feishu document URL or token, normalize heading hierarchy, remove highlight/color-block styling, preserve media/resource blocks, apply inline emphasis such as bold/underline/italic/code, protect prompt/code blocks, or verify document formatting after lark-cli edits.
---

# Lark Doc Formatter

Use this skill to perform controlled formatting passes on Feishu/Lark documents with `lark-cli docs --api-version v2`.

## Required Companion Skills

Before reading or editing a Feishu document, use the installed `lark-doc` skill and follow its required `lark-shared`, fetch, XML, and update workflow references. This skill adds formatting policy and validation patterns on top of `lark-doc`; it does not replace the Feishu API rules.

## Workflow

1. Read the target document with `docs +fetch --api-version v2 --as user --detail with-ids`.
2. Identify the requested formatting pass:
   - heading hierarchy and title cleanup
   - color block or text highlight removal
   - body emphasis with `<b>`, `<u>`, `<em>`, or `<code>`
   - image/resource preservation
   - prompt/code block protection
3. Read `references/formatting-policy.md` before applying broad document-wide edits.
4. Prefer precise `block_replace` edits over full `overwrite` unless the user explicitly asks to rebuild the whole document.
5. Preserve all `<img>`, `<source>`, `<whiteboard>`, `<sheet>`, `<bitable>`, `<cite>`, and `synced_*` resource tokens exactly.
6. After editing, run `scripts/inspect_lark_doc_format.py` against the document URL or token and fix any reported violations.

## Editing Rules

- Use XML for targeted document updates.
- Treat `<title>` and `<h1>` through `<h9>` as headings. Do not apply inline `<code>` style inside headings unless the user explicitly requests it.
- Keep body inline code limited to product names, technical terms, file types, English abbreviations, and command-like phrases that need visual distinction.
- Never add decorative color blocks by default. If emphasis is needed, prefer bold, underline, or italic.
- Never rewrite prompt/code blocks while applying body text transformations. `<pre><code>...</code></pre>` should remain a single code wrapper without nested `<code>`.
- When converting text styles, keep the required nesting order: `<a>` -> `<b>` -> `<em>` -> `<del>` -> `<u>` -> `<code>` -> `<span>` -> text.

## Useful Commands

Fetch full editable XML:

```bash
lark-cli docs +fetch --api-version v2 --as user --doc "$DOC" --detail with-ids --format json -q '.data.document.content'
```

Inspect formatting:

```bash
python3 skills/lark-doc-formatter/scripts/inspect_lark_doc_format.py "$DOC"
```

Replace a single block:

```bash
lark-cli docs +update --api-version v2 --as user --doc "$DOC" \
  --command block_replace \
  --block-id "$BLOCK_ID" \
  --content '<p>New XML content</p>'
```
