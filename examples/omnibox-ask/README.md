# omnibox-ask

Event-driven. `ask <question>` in the address bar → desktop notification answer. No navigation, no new tab.

- **Trigger:** `omnibox.onInputEntered`
- **Required permissions:** `notifications` + optional: `tabs`, `bookmarks`, `downloads`, `readingList` (for tool-backed questions)
- **Manifest addition:** `"omnibox": { "keyword": "ask" }`
- **Side effects:** one notification per question
