# tab-hygiene

Schedule-driven. Every alarm tick (default 30 min), counts open tabs and fires a desktop notification if there are 20 or more.

- **Trigger:** alarm
- **Required permissions:** `tabs`, `notifications`
- **Writes:** `OPFS://tab-hygiene/YYYY-MM-DD.json`
- **Side effects:** at most one notification per run
