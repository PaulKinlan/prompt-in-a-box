# right-click-extract-topics

Event-driven. Two context menu items — "Extract topics from selection" and "Extract topics from page". Click either, get 5-8 topic tags as a notification and appended to a daily index.

- **Trigger:** `contextMenus.onClicked`
- **Required permissions:** `tabs`, `scripting`, `contextMenus`, `notifications`
- **Writes:** `OPFS://topics/YYYY-MM-DD.md`
