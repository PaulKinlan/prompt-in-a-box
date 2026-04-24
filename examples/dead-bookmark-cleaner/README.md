# dead-bookmark-cleaner

Schedule-driven. Every alarm tick, opens the next 5 bookmarks in a background tab, scrapes them, flags dead ones to an OPFS report. Never deletes.

- **Trigger:** alarm
- **Required permissions:** `bookmarks`, `tabs`, `scripting`, `notifications`
- **Writes:** `OPFS://dead-bookmarks.md`
- **Side effects:** opens and closes tabs; one summary notification per full pass
