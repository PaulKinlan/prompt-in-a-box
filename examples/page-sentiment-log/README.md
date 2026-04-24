# page-sentiment-log

Event-driven with a daily scheduled rollup. Every visited page gets a sentiment label and one-line summary appended to a JSONL file; once a day, a human-readable summary is produced.

- **Trigger:** `tabs.onUpdated` + scheduled daily rollup
- **Required permissions:** `tabs`, `scripting`
- **Writes:** `OPFS://sentiment/YYYY-MM-DD.jsonl` + `OPFS://sentiment/summary-YYYY-MM-DD.md`
- **Side effects:** none user-visible
