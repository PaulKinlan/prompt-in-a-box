# download-nightly-summary

Schedule-driven. Evenings only (20:00-23:00), once per day, notifies how many files were downloaded and writes a daily summary to OPFS.

- **Trigger:** alarm (with time-of-day gate)
- **Required permissions:** `downloads`, `notifications`
- **Writes:** `OPFS://downloads/daily-YYYY-MM-DD.md`
