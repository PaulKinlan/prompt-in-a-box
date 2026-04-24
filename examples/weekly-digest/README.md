# weekly-digest

Schedule-driven. Every Sunday 18:00+, summarises the week's bookmarks + reading list activity into an OPFS file.

- **Trigger:** alarm (with day-of-week + time gate)
- **Required permissions:** `bookmarks`, `readingList`, `notifications`
- **Writes:** `OPFS://digests/YYYY-MM-DD.md`
- **Side effects:** one notification per week
