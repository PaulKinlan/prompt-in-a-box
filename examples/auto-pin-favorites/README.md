# auto-pin-favorites

Event-driven. Counts visits per URL; pins tabs to URLs the user visits 5+ times. Weekly prune decays old counts and drops unseen entries.

- **Trigger:** `tabs.onUpdated` + weekly scheduled prune
- **Required permissions:** `tabs`
- **State:** `chrome.storage.local` under `visits` key
- **Side effects:** pins tabs; respects manual unpins for 24h
