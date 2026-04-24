# tab-screenshot-diary

Schedule-driven. Hourly during the day (08:00-22:00), screenshots the active tab of the focused window to OPFS. Ambient by default — no notifications.

- **Trigger:** alarm (hourly gate)
- **Required permissions:** `tabs`, `scripting`
- **Writes:** `OPFS://screenshots/<timestamp>.png` + `OPFS://diary-index.md`
- **Housekeeping:** weekly prune of screenshots older than 30 days
