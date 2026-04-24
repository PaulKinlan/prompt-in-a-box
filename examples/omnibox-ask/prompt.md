# Omnibox Ask

Type `ask` in the Chrome address bar, press space, type a question, press Enter. Get the answer as a desktop notification. No new tabs, no page loads — just the answer.

This example relies on the manifest declaring an `omnibox` block with a keyword:

```json
"omnibox": { "keyword": "ask" }
```

## On `omnibox.onInputEntered` events

1. Extract `text` (the user's question) from the event payload.
2. Answer it directly from your own knowledge — no tools needed, unless the question needs a tool to answer (e.g. "how many tabs do I have?" calls `tab_list`).
3. `notification_show`:
   - `title`: the question (truncated to 60 chars)
   - `message`: your answer (plain text, no markdown, ≤ 300 chars)

## Tool-backed questions

If the question obviously needs local browser data:
- "how many tabs?" → `tab_list`, count
- "how many bookmarks?" → `bookmark_list`, count
- "any downloads today?" → `download_list`
- "last thing I read" → `reading_list_query`, most recent

For anything else, answer from your knowledge and keep it short.

## Constraints
- One notification per question.
- No long-form answers. If the question needs an essay, notify "Too complex for a notification — try asking in a chat interface" and stop.
- Never open tabs, never navigate. The interaction is address bar in, notification out.

## Required permissions
`notifications`, plus whatever the tool-backed questions need (`tabs`, `bookmarks`, `downloads`, `readingList` are good defaults).

(The `omnibox` block in the manifest is not a permission — it's its own block.)
