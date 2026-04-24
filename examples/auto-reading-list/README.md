# auto-reading-list

Event-driven. Watches tab lifecycle; when an article tab closes after 30+ seconds open, silently adds to Chrome's reading list.

- **Trigger:** `tabs.onUpdated` + `tabs.onRemoved` (queued)
- **Required permissions:** `tabs`, `readingList`
- **Side effects:** silent additions to reading list, capped at 20/day
