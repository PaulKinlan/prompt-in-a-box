# bookmark-dedupe

Schedule-driven. Finds duplicate bookmarks by normalised URL; produces an OPFS report. Never deletes.

- **Trigger:** alarm
- **Required permissions:** `bookmarks`, `notifications`
- **Writes:** `OPFS://bookmark-dupes.md`
- **Side effects:** one notification per run if duplicates found
