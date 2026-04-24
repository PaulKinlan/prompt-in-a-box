# stale-tab-closer

Mixed. Watches activity events to record `lastTouch` per tab; on each alarm tick, closes tabs untouched for 24+ hours. Pinned, audible, and active tabs are protected; capped at 10 closures per run.

- **Trigger:** alarm + `tabs.onActivated` / `tabs.onUpdated` (queued)
- **Required permissions:** `tabs`
- **Side effects:** closes tabs aggressively; tune the threshold before running
