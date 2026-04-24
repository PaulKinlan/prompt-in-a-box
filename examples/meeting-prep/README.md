# meeting-prep

Event-driven. When a Google Calendar event page loads, scrapes attendees/time/agenda and writes a meeting notes template to OPFS.

- **Trigger:** `tabs.onUpdated` (filtered on calendar.google.com event URLs)
- **Required permissions:** `tabs`, `scripting`, `notifications`
- **Writes:** `OPFS://meetings/YYYY-MM-DD-<slug>.md`
- **Dedup:** per event ID via `chrome.storage.local`
