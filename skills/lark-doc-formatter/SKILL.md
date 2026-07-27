---
name: lark-doc-formatter
description: Format and polish Feishu/Lark Docx or Wiki documents through lark-cli. Use when Codex needs to clean up a Feishu document URL or token, normalize heading hierarchy, remove highlight/color-block styling, preserve media/resource blocks, apply inline emphasis such as bold/underline/italic/code, keep headings and tables free of inline code styling, protect prompt/code blocks, or verify document formatting after lark-cli edits.
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
- Use body inline code as an attention anchor, not as a blanket marker for every English token. In eligible non-table paragraphs and lists, format every occurrence of product names, model names, and designated core concepts; format technical terms, file types, English abbreviations, interface labels, and command-like phrases when readers need to identify or act on them.
- Do not individually format grammatical function words such as `and`, `or`, `to`, `of`, `for`, or `with`, or incidental English that does not serve an emphasis purpose. If a complete English sentence has no other inline style, wrap the sentence in one continuous `<code>` element instead of styling it word by word.
- Do not impose per-paragraph counts, first-occurrence-only behavior, repetition limits, or visual-density caps. Preserve every eligible occurrence, and keep multi-word names or concepts in one continuous `<code>` element.
- Do not use inline `<code>` inside tables by default. Tables should stay clean for scanning and comparison; use plain text or restrained bold when emphasis is necessary.
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
