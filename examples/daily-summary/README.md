# daily-summary

Schedule-driven. Late evenings, once per day: pulls history + reading list additions, clusters into themes via LLM, writes a journal entry to OPFS.

- **Trigger:** alarm (time-of-day gate: 21:00+)
- **Required permissions:** `history`, `readingList`, `notifications`
- **Writes:** `OPFS://journal/YYYY-MM-DD.md`
- **Side effects:** one notification per day
