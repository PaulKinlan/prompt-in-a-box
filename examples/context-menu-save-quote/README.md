# context-menu-save-quote

Event-driven with a weekly rollup. Right-click selected text → append to a monthly OPFS commonplace book. Weekly "best of" digest.

- **Trigger:** `contextMenus.onClicked` + weekly scheduled digest
- **Required permissions:** `contextMenus`, `notifications`
- **Writes:** `OPFS://quotes/YYYY-MM.md` + `OPFS://quotes/digest-YYYY-WW.md`
