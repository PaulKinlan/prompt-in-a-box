# download-organizer

Event-driven with weekly rollup. Every download gets logged with an inferred category; weekly summaries roll up to a markdown file.

- **Trigger:** `downloads.onCreated` + weekly scheduled summary
- **Required permissions:** `downloads`
- **Writes:** `OPFS://downloads/YYYY-MM.jsonl` + `OPFS://downloads/summary-YYYY-MM.md`
- **Side effects:** none user-visible
