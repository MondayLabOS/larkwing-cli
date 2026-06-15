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

Use `<code>` in body text for:

- product/tool names: `AnyGen`, `YouMind`
- technical or format terms: `HTML`, `PDF`, `Excel`
- workflow abbreviations: `CRM`, `SOP`, `FAQ`, `SKU`
- interface or command-like labels: `Prompt`, `Agent`, `Showroom`, `Lookbook`

Avoid `<code>` in:

- document titles and headings
- Chinese body text
- prompt/code blocks that are already wrapped by `<pre><code>...</code></pre>`
- URLs and resource attributes

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
- no residual `<span background-color>` remains when the user asked to remove color blocks
- prompt/code blocks have no nested `<code>`
- resource tokens are still present
- body text still contains intended inline code styling
