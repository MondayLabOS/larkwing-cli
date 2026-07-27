# Formatting Policy

## Headings

- Keep document title and headings visually clean.
- Do not use inline `<code>` inside `<title>` or `<h1>` through `<h9>` unless the user explicitly asks for it.
- Use headings for structure, not emphasis. If a heading contains product names or English terms, leave them as plain heading text.
- Preserve emojis already present in headings when they are part of the article style.

## Emphasis

- Prefer `<b>` for core claims, conclusions, and phrases the reader should remember.
- Use `<u>` sparingly for terms that need extra visual anchoring.
- Use `<em>` sparingly for tone or contrast.
- Do not use `<span background-color>` or colored callouts for normal article emphasis unless the user explicitly asks for color.

## Inline Code

Use `<code>` as an English attention anchor, not as a blanket marker for every English token.

Use `<code>` in eligible body text for:

- product/tool names: `AnyGen`, `YouMind`
- model names and designated core concepts
- technical or format terms: `HTML`, `PDF`, `Excel`
- workflow abbreviations: `CRM`, `SOP`, `FAQ`, `SKU`
- interface or command-like labels: `Prompt`, `Agent`, `Showroom`, `Lookbook`

Once a product name, model name, or core concept qualifies for emphasis, format every eligible occurrence across the document, not only the first. Do not impose per-paragraph counts, repetition limits, or visual-density caps.

Treat complete semantic units as one code span:

- keep multi-word names and concepts together, such as `<code>Claude Code</code>`
- when a complete English sentence has no link, bold, underline, italic, or existing inline-code style, wrap the whole sentence in one continuous `<code>` element instead of splitting it word by word
- grammatical function words inside such a complete sentence remain inside the sentence-level code span

Do not individually add `<code>` to:

- grammatical function words such as `and`, `or`, `to`, `of`, `for`, `with`, `from`, `by`, `as`, `a`, `an`, and `the`
- incidental English that does not help the reader identify, remember, or act on a term

Avoid `<code>` in:

- document titles and headings
- tables, including `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, and `<td>` content
- Chinese body text
- prompt/code blocks that are already wrapped by `<pre><code>...</code></pre>`
- URLs and resource attributes

## Tables

- Keep table content clean and easy to scan.
- Do not use inline `<code>` inside table cells by default, even for English terms or product names.
- If a table term needs emphasis, prefer plain text, a concise column label, or restrained `<b>` rather than `<code>`.
- Remove decorative table cell background colors unless they are needed for structural scanability.

## Color And Highlight Cleanup

Remove normal article emphasis expressed as:

- `<span background-color="...">`
- callouts used only as decorative highlight boxes
- table cell background colors used only for decorative emphasis

Keep structural table styling only when it improves scanability and is not visually heavy.

## Protected Blocks

Preserve these tags and their attributes exactly unless the user asks to edit that resource:

- `<img>`
- `<source>`
- `<whiteboard>`
- `<sheet>`
- `<bitable>`
- `<cite>`
- `<synced_reference>`
- `<synced_source>`

When applying broad text transformations, skip:

- `<pre>...</pre>`
- resource tags and their attributes
- document URLs and media URLs

## Verification Checklist

After edits, verify:

- headings contain no `<code>`
- tables contain no `<code>`
- no residual `<span background-color>` remains when the user asked to remove color blocks
- prompt/code blocks have no nested `<code>`
- resource tokens are still present
- every eligible occurrence of product names, model names, and core concepts still contains intended inline code styling
- complete English sentences without other inline styles use one continuous `<code>` element
- grammatical function words and incidental English are not individually styled unless they belong to an eligible sentence-level code span
- no eligible styling was omitted because of repetition, count, or visual density
