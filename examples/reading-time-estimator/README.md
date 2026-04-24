# reading-time-estimator

Event-driven. Listens to `tabs.onUpdated`; for each completed navigation, scrapes the page and notifies if estimated read time ≥ 5 minutes.

- **Trigger:** `tabs.onUpdated` (queued)
- **Required permissions:** `tabs`, `scripting`, `notifications`
- **Deduplication:** per tab+URL via `chrome.storage.local`
