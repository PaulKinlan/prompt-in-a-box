# dedupe-tabs

Schedule-driven. Closes duplicate tabs (same normalised URL), keeping the active or oldest copy. Preserves pinned, audible, and singleton-window tabs.

- **Trigger:** alarm
- **Required permissions:** `tabs`, `notifications`
- **Side effects:** closes tabs; one notification per run if anything closed
