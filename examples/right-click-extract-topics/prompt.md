# Right-Click: Extract Topics

A right-click menu item that extracts the key topics from either the selected text or the whole page. Results go to a notification and accumulate in OPFS.

## Bootstrap

Create two context menu items (skip if they already exist per `context_menu_list`):

- `id: extract-topics-selection`, `title: Extract topics from selection`, `contexts: ["selection"]`
- `id: extract-topics-page`, `title: Extract topics from page`, `contexts: ["page"]`

## On click

- For `extract-topics-selection`: the selected text is in `info.selectionText` on the event payload. Use that.
- For `extract-topics-page`: use `tab_read` to get the page body.

Either way:

1. Extract 5-8 concise topic tags (lowercase, kebab-case, 1-3 words each).
2. Fire a `notification_show` with the topics joined by `, `.
3. Append a line to `OPFS://topics/YYYY-MM-DD.md`:

   ```
   - HH:MM [page title](url) — topic-1, topic-2, topic-3
   ```

## Constraints
- Topic tags are for indexing, not marketing copy. No "innovation" or "synergy".
- If the selection is under 20 words, skip it — not enough to work with. Notification: "Selection too short."

## Required permissions
`tabs`, `scripting`, `contextMenus`, `notifications`.
