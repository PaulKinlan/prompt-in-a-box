# right-click-summarize

Event-driven. Creates a context menu entry on first run; on click, scrapes the active tab and notifies with a summary.

- **Trigger:** `contextMenus.onClicked` (immediate — runs the agent straight away)
- **Required permissions:** `tabs`, `scripting`, `contextMenus`, `notifications`
- **Side effects:** one notification per click; optional OPFS save
