# right-click-translate-selection

Event-driven. Right-click selected text → translate via the LLM → notification + clipboard.

- **Trigger:** `contextMenus.onClicked`
- **Required permissions:** `contextMenus`, `notifications`, `clipboardWrite`, `offscreen`
- **Side effects:** one notification per click; clipboard write (via offscreen document)

To change target language, edit the "Target language" line in `prompt.md`.
